/**
 * Own names for subjects (design 2026-11-05): the one resolver the phone and the
 * server both call. These run it on the class lines a real grid publishes —
 * a block, two physics groups, and the "חינוך" / "חינוך גופני" pair that must
 * never be confused.
 */
import { describe, expect, it } from 'vitest';
import { parseExamTitle } from '@sederyom/shared/logic/exam-match';
import {
  SUBJECT_NAMES_MAX, SUBJECT_NAME_MAX, blockNameKey, cleanSubjectName, examTitle, intersectNames, lessonName, lineBlock,
  mashovName, nameContext, siteLines, subjectNameKey, subjectNamesOf, withSubjectName, type NameContext,
} from '@sederyom/shared/logic/ownNames';

const lines = [
  { subject: 'גוש ב׳ (יב)', teacher: 'כהן דנה' },
  { subject: 'פיזיקה מורחב', teacher: 'לוי רון' },
  { subject: 'פיזיקה מורחב (מעבדת פיסיקה)', teacher: 'לוי רון' },
  { subject: 'חינוך', teacher: 'אבן רות' },
  { subject: 'חינוך גופני', teacher: 'בר טל' },
];

/** A context for names that the tests know are not empty. */
function contextOf(names: Record<string, string>, hidden: string[] = [], on = lines): NameContext {
  return nameContext(names, on, hidden)!;
}

describe('lessons and exams of a block', () => {
  it('names a block as a lesson and as an exam', () => {
    const ctx = contextOf({ "גוש ב' (יב)": 'פיזיקה' });
    expect(lessonName(ctx, { subject: 'גוש ב׳ (יב)', teacher: 'כהן דנה' })).toBe('פיזיקה');
    expect(examTitle(ctx, "מבחן גוש ב'")).toEqual({ title: 'מבחן פיזיקה', name: 'פיזיקה' });
  });

  it('names a block no line of the timetable has by the block key', () => {
    const ctx = contextOf({ 'block:א': 'כימיה' });
    expect(examTitle(ctx, 'מבחן בגוש א')).toEqual({ title: 'מבחן כימיה', name: 'כימיה' });
  });

  it('replaces a block the title writes with the Hebrew geresh', () => {
    const ctx = contextOf({ "גוש ב' (יב)": 'פיזיקה' });
    expect(examTitle(ctx, 'מבחן גוש ב׳')).toEqual({ title: 'מבחן פיזיקה', name: 'פיזיקה' });
  });

  it('replaces a block the title splits with a dash', () => {
    const ctx = contextOf({ "גוש ב' (יב)": 'פיזיקה' });
    expect(examTitle(ctx, "מבחן גוש - ב' בשעה 8")).toEqual({ title: 'מבחן פיזיקה בשעה 8', name: 'פיזיקה' });
  });

  it('leaves a block exam with no letter alone', () => {
    const ctx = contextOf({ 'subject:אנגלית': 'English', "גוש ב' (יב)": 'פיזיקה' });
    expect(examTitle(ctx, 'מבחן גוש')).toBeNull();
  });

  it('names a title that reads a block and a subject by its subject, never by its block', () => {
    const ctx = contextOf({ 'subject:אנגלית': 'English', 'block:א': 'פיזיקה' });
    expect(examTitle(ctx, 'מבחן באנגלית גוש א')).toEqual({ title: 'מבחן בEnglish גוש א', name: 'English' });
    // The block's name is not the subject's: a title that reads a subject with no name stays.
    expect(examTitle(ctx, 'מבחן במתמטיקה גוש א')).toBeNull();
  });

  it('gives a block lesson no name from the subject keys', () => {
    const ctx = contextOf({ 'subject:גוש ב': 'פיזיקה' });
    expect(lessonName(ctx, { subject: 'גוש ב׳ (יב)', teacher: 'כהן דנה' })).toBeNull();
  });

  it('names a block lesson by its block when the line has no name of its own', () => {
    const ctx = contextOf({ [blockNameKey('ב')]: 'פיזיקה' });
    expect(lessonName(ctx, { subject: 'כימיה- גוש ב', teacher: null })).toBe('פיזיקה');
  });
});

describe("a block's name never lands on another subject's exam", () => {
  // Block ב offers chemistry, physics and biology; this student takes physics and hides the other two.
  const BLOCK_LINES = [
    { subject: 'כימיה- גוש ב', teacher: 'לוי' },
    { subject: 'פיזיקה- גוש ב', teacher: 'כהן' },
    { subject: 'ביולוגיה- גוש ב', teacher: 'בר' },
    { subject: 'אנגלית', teacher: 'רון' },
  ];
  const HIDDEN = ['כימיה- גוש ב', 'ביולוגיה- גוש ב'];
  const OTHERS = ['כימיה- גוש ב', 'מבחן בכימיה גוש ב', 'מבחן גוש ב׳ - ביולוגיה'];

  it('a title that reads another subject of the block keeps the school\'s words', () => {
    const ctx = contextOf({ 'פיזיקה- גוש ב': 'פיזיקה שלי' }, HIDDEN, BLOCK_LINES);
    for (const title of OTHERS) expect(examTitle(ctx, title), title).toBeNull();
    // The block's own exam, which reads no subject, still takes the one kept line's name.
    expect(examTitle(ctx, 'מבחן גוש ב')).toEqual({ title: 'מבחן פיזיקה שלי', name: 'פיזיקה שלי' });
  });

  it('nor does a name stored under the block\'s key alone', () => {
    const ctx = contextOf({ [blockNameKey('ב')]: 'פיזיקה שלי' }, [...HIDDEN, 'פיזיקה- גוש ב'], BLOCK_LINES);
    for (const title of OTHERS) expect(examTitle(ctx, title), title).toBeNull();
    expect(examTitle(ctx, 'מבחן בגוש ב')).toEqual({ title: 'מבחן פיזיקה שלי', name: 'פיזיקה שלי' });
  });

  it('a kept line of that subject with a name: only the subject\'s words change', () => {
    const ctx = contextOf({ 'כימיה- גוש ב': 'כימיה שלי', 'פיזיקה- גוש ב': 'פיזיקה שלי' }, ['ביולוגיה- גוש ב'], BLOCK_LINES);
    expect(examTitle(ctx, 'כימיה- גוש ב')).toEqual({ title: 'כימיה שלי- גוש ב', name: 'כימיה שלי' });
    expect(examTitle(ctx, 'מבחן בכימיה גוש ב')).toEqual({ title: 'מבחן בכימיה שלי גוש ב', name: 'כימיה שלי' });
  });
});

describe('lessons', () => {
  it('prefers the key of the line with its teacher over the key of the subject alone', () => {
    const ctx = contextOf(
      { 'פיזיקה מורחב': 'פיזיקה', 'פיזיקה מורחב @ לוי רון': 'פיזיקה של רון' },
    );
    expect(lessonName(ctx, { subject: 'פיזיקה מורחב', teacher: 'לוי רון' })).toBe('פיזיקה של רון');
    expect(lessonName(ctx, { subject: 'פיזיקה מורחב', teacher: 'מישהו אחר' })).toBe('פיזיקה');
  });

  it('names a lesson by the subject key when the timetable has no such line', () => {
    const ctx = contextOf({ [subjectNameKey('מתמטיקה 5 יח"ל')]: 'חשבון' });
    expect(lessonName(ctx, { subject: 'מתמטיקה', teacher: null })).toBe('חשבון');
  });

  it('reads a lesson from Mashov as a Mashov item', () => {
    const ctx = contextOf({ 'פיזיקה מורחב': 'פיזיקה שלי' });
    expect(lessonName(ctx, { subject: 'פיזיקה', teacher: null, source: 'mashov' })).toBe('פיזיקה שלי');
    expect(lessonName(ctx, { subject: 'פיזיקה', teacher: null })).toBeNull();
  });

  it('never names a line it has no name for', () => {
    const ctx = contextOf({ 'פיזיקה מורחב': 'פיזיקה שלי' });
    expect(lessonName(ctx, { subject: 'חינוך', teacher: 'אבן רות' })).toBeNull();
  });
});

describe('items from Mashov', () => {
  it('takes the one name of the matching lines, an unnamed sibling not blocking it', () => {
    const ctx = contextOf({ 'פיזיקה מורחב': 'פיזיקה שלי' });
    expect(mashovName(ctx, { subject: 'פיזיקה' })).toBe('פיזיקה שלי');
  });

  it('keeps the name of Mashov when two matching lines name the subject differently', () => {
    const ctx = contextOf({ 'פיזיקה מורחב': 'א', 'פיזיקה מורחב (מעבדת פיסיקה)': 'ב' });
    expect(mashovName(ctx, { subject: 'פיזיקה' })).toBeNull();
  });

  it('counts two lines with one name once', () => {
    const ctx = contextOf({ 'פיזיקה מורחב': 'פיזיקה שלי', 'פיזיקה מורחב (מעבדת פיסיקה)': 'פיזיקה שלי' });
    expect(mashovName(ctx, { subject: 'פיזיקה' })).toBe('פיזיקה שלי');
  });

  it('does not let a teacher it rules out lend a name', () => {
    const ctx = contextOf({ 'פיזיקה מורחב': 'פיזיקה שלי' });
    expect(mashovName(ctx, { subject: 'פיזיקה', teacher: 'לוי רון' })).toBe('פיזיקה שלי');
    expect(mashovName(ctx, { subject: 'פיזיקה', teacher: 'שפירא יעל' })).toBeNull();
  });

  it('falls to the subject key when no kept line has a name', () => {
    const ctx = contextOf({ [subjectNameKey('היסטוריה')]: 'תולדות' });
    expect(mashovName(ctx, { subject: 'היסטוריה (יא1)' })).toBe('תולדות');
  });

  it('never lets "חינוך" name "חינוך גופני"', () => {
    const ctx = contextOf({ 'חינוך': 'שעת מחנך' });
    expect(lessonName(ctx, { subject: 'חינוך גופני', teacher: 'בר טל' })).toBeNull();
    expect(mashovName(ctx, { subject: 'חינוך גופני' })).toBeNull();
    expect(mashovName(ctx, { subject: 'חינוך' })).toBe('שעת מחנך');
  });

  it('does not take a name from a hidden line', () => {
    const ctx = contextOf({ 'פיזיקה מורחב': 'פיזיקה שלי' }, ['פיזיקה מורחב', 'פיזיקה מורחב (מעבדת פיסיקה)']);
    expect(mashovName(ctx, { subject: 'פיזיקה' })).toBeNull();
  });
});

describe('exam titles', () => {
  const english = nameContext({ 'subject:אנגלית': 'English' }, [], [])!;

  it('changes only the words that read the subject', () => {
    expect(examTitle(english, 'מתכונת באנגלית וויקה')!.title).toBe('מתכונת בEnglish וויקה');
    expect(examTitle(english, 'מבחן באנגלית')).toEqual({ title: 'מבחן בEnglish', name: 'English' });
  });

  it('leaves a title that reads no subject', () => {
    expect(examTitle(english, 'תאריך הגשה')).toBeNull();
  });

  it('leaves a title whose subject has no name', () => {
    expect(examTitle(english, 'מבחן במתמטיקה')).toBeNull();
  });

  it('leaves a title the name would not change', () => {
    expect(examTitle(nameContext({ 'subject:אנגלית': 'אנגלית' }, [], [])!, 'מבחן אנגלית')).toBeNull();
  });

  it('finds words the title joins with other separators', () => {
    const ctx = nameContext({ 'subject:מדעי המחשב': 'מחשבים' }, [], [])!;
    expect(examTitle(ctx, 'מבחן במדעי-המחשב')).toEqual({ title: 'מבחן במחשבים', name: 'מחשבים' });
  });

  it('finds an abbreviation written with the Hebrew gershayim', () => {
    const ctx = nameContext({ 'subject:תנך': 'מקרא' }, [], [])!;
    expect(parseExamTitle('בגרות תנ״ך', []).subjectWords).toBe('תנ"ך');
    expect(examTitle(ctx, 'בגרות תנ״ך')).toEqual({ title: 'בגרות מקרא', name: 'מקרא' });
  });

  it('returns null, never a mangled title, when the words are not in the title as one run', () => {
    // No known subject and no kind word: both open words read as the subject,
    // but "חקר" sits between them in the title.
    const title = 'כימיה חקר אזרחות';
    expect(parseExamTitle(title, []).subjectWords).toBe('כימיה אזרחות');
    const ctx = nameContext({ [subjectNameKey('כימיה אזרחות')]: 'מדע' }, [], [])!;
    expect(examTitle(ctx, title)).toBeNull();
  });

  it('does not find the subject inside another word', () => {
    const ctx = nameContext({ 'subject:פיזיקה': 'פיז' }, [], [])!;
    // "אפיזיקה" holds the word "פיזיקה" but is another word: the second is the subject.
    expect(parseExamTitle('מבחן אפיזיקה פיזיקה', []).subjectWords).toBe('פיזיקה');
    expect(examTitle(ctx, 'מבחן אפיזיקה פיזיקה')).toEqual({ title: 'מבחן אפיזיקה פיז', name: 'פיז' });
  });

  it('keeps a pair of quote marks around the words, whole', () => {
    expect(examTitle(english, 'מבחן ב"אנגלית"')).toEqual({ title: 'מבחן ב"English"', name: 'English' });
    expect(examTitle(english, 'מבחן "אנגלית"')).toEqual({ title: 'מבחן "English"', name: 'English' });
    expect(examTitle(english, 'מבחן “באנגלית”')).toEqual({ title: 'מבחן “בEnglish”', name: 'English' });
  });

  it('drops a quote mark that has no mate, so none is left behind', () => {
    const ctx = contextOf({ "גוש ב' (יב)": 'פיזיקה' });
    // ״ typed where the geresh was meant.
    expect(examTitle(ctx, 'מבחן גוש ב״')).toEqual({ title: 'מבחן פיזיקה', name: 'פיזיקה' });
    expect(examTitle(english, 'מבחן "אנגלית')).toEqual({ title: 'מבחן English', name: 'English' });
    expect(examTitle(english, 'מבחן אנגלית"')).toEqual({ title: 'מבחן English', name: 'English' });
    expect(examTitle(english, 'מבחן "באנגלית')).toEqual({ title: 'מבחן בEnglish', name: 'English' });
  });

  it('puts a name in as typed, replaces the first place only, and finds no word inside another', () => {
    const dollars = nameContext({ 'subject:אנגלית': '$& $1' }, [], [])!;
    expect(examTitle(dollars, 'מבחן באנגלית')).toEqual({ title: 'מבחן ב$& $1', name: '$& $1' });
    expect(examTitle(english, 'מבחן אנגלית - אנגלית')).toEqual({ title: 'מבחן English - אנגלית', name: 'English' });
    expect(examTitle(english, 'מבחן לאנגלית')).toBeNull();
  });

  it('takes the name of the one kept line that matches the subject', () => {
    const ctx = contextOf({ 'פיזיקה מורחב': 'פיזיקה שלי' });
    expect(examTitle(ctx, 'מבחן בפיזיקה')).toEqual({ title: 'מבחן בפיזיקה שלי', name: 'פיזיקה שלי' });
  });

  it('keeps the title when two matching lines name the subject differently', () => {
    const ctx = contextOf({ 'פיזיקה מורחב': 'א', 'פיזיקה מורחב (מעבדת פיסיקה)': 'ב', 'subject:פיזיקה': 'ג' });
    expect(examTitle(ctx, 'מבחן פיזיקה')).toBeNull();
  });
});

describe('the store of names', () => {
  it('writes a cleaned name under every key', () => {
    expect(withSubjectName({}, ['a', 'b'], '  פיזיקה \n ', ['גוש ב'])).toEqual({ a: 'פיזיקה', b: 'פיזיקה' });
  });

  it('deletes every key for an empty name or one equal to an original', () => {
    expect(withSubjectName({ a: 'x', c: 'y' }, ['a'], 'גוש ב', ['גוש ב'])).toEqual({ c: 'y' });
    expect(withSubjectName({ a: 'x', b: 'x', c: 'y' }, ['a', 'b'], '  ', [])).toEqual({ c: 'y' });
    expect(withSubjectName({ a: 'x', c: 'y' }, ['a'], null, [])).toEqual({ c: 'y' });
    expect(withSubjectName({ a: 'x' }, ['a'], ' גוש  ב ', ['x', 'גוש ב'])).toEqual({});
  });

  it('never changes the map it was given', () => {
    const names = Object.freeze({ a: 'x' });
    expect(withSubjectName(names, ['a', 'b'], 'y', [])).toEqual({ a: 'y', b: 'y' });
    expect(withSubjectName(names, ['a'], null, [])).toEqual({});
    expect(names).toEqual({ a: 'x' });
  });

  it('adds no new key beyond the cap, and still renames and deletes the ones it has', () => {
    const nearlyFull = Object.fromEntries(Array.from({ length: SUBJECT_NAMES_MAX - 1 }, (_, i) => [`k${i}`, 'x']));
    // Room for one: the first new key gets it, the second does not.
    const full = withSubjectName(nearlyFull, ['k0', 'new1', 'new2'], 'y', []);
    expect(Object.keys(full)).toHaveLength(SUBJECT_NAMES_MAX);
    expect(full.k0).toBe('y');
    expect(full.new1).toBe('y');
    expect(full.new2).toBeUndefined();
    // Full: a key it has still changes; a new one does not come in.
    const same = withSubjectName(full, ['k3', 'new2'], 'z', []);
    expect(Object.keys(same)).toHaveLength(SUBJECT_NAMES_MAX);
    expect(same.k3).toBe('z');
    expect(same.new2).toBeUndefined();
    expect(Object.keys(withSubjectName(full, ['k3'], null, []))).toHaveLength(SUBJECT_NAMES_MAX - 1);
  });

  it('keeps a key of __proto__ an ordinary key', () => {
    const named = withSubjectName({}, ['__proto__'], 'y', []);
    expect(Object.keys(named)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(named)).toBe(Object.prototype);
  });

  it('cleans a name to one line of at most 40 characters', () => {
    expect(cleanSubjectName('x'.repeat(50))).toHaveLength(SUBJECT_NAME_MAX);
    expect(cleanSubjectName('  a \t\n b  ')).toBe('a b');
    expect(cleanSubjectName(null)).toBe('');
    expect(cleanSubjectName(undefined)).toBe('');
    // The cut never leaves a trailing space, or half of an emoji.
    expect(cleanSubjectName(`${'x'.repeat(39)} y`)).toBe('x'.repeat(39));
    expect(cleanSubjectName(`${'x'.repeat(39)}😀`)).toBe('x'.repeat(39));
  });

  it('has no context for no names', () => {
    expect(nameContext({}, lines, [])).toBeNull();
    expect(nameContext(undefined, lines, [])).toBeNull();
  });

  it('keeps the names two maps agree on', () => {
    expect(intersectNames({ a: '1', b: '2' }, { a: '1', b: '3' })).toEqual({ a: '1' });
    expect(intersectNames({ a: '1' }, {})).toEqual({});
  });

  it('reads whatever a device sent, strings only, within the caps', () => {
    expect(subjectNamesOf({ a: 'x', b: 3, c: '' })).toEqual({ a: 'x' });
    expect(subjectNamesOf({ a: '  x \n y ', b: '   ' })).toEqual({ a: 'x y' });
    expect(subjectNamesOf({ ['k'.repeat(201)]: 'x', ['k'.repeat(200)]: 'y', '': 'z' })).toEqual({ ['k'.repeat(200)]: 'y' });
    expect(subjectNamesOf('x')).toEqual({});
    expect(subjectNamesOf(null)).toEqual({});
    expect(subjectNamesOf(['x'])).toEqual({});
    const many = Object.fromEntries(Array.from({ length: SUBJECT_NAMES_MAX + 20 }, (_, i) => [`k${i}`, 'x']));
    expect(Object.keys(subjectNamesOf(many))).toHaveLength(SUBJECT_NAMES_MAX);
  });
});

describe('the class lines', () => {
  it('are the site\'s lines, once each, exams left out', () => {
    expect(siteLines([
      { subject: 'פיזיקה', teacher: 'לוי רון', status: 'regular' },
      { subject: 'פיזיקה', teacher: 'לוי רון', status: 'cancelled' },
      { subject: 'פיזיקה', teacher: null },
      { subject: 'מבחן במתמטיקה', teacher: null, status: 'exam' },
    ])).toEqual([
      { subject: 'פיזיקה', teacher: 'לוי רון' },
      { subject: 'פיזיקה', teacher: null },
    ]);
  });

  it('read a block out of a line', () => {
    expect(lineBlock('גוש ב׳ (יב)')).toBe('ב');
    expect(lineBlock('כימיה- גוש ב')).toBe('ב');
    expect(lineBlock('ביולוגיה 5 יח- גוש א')).toBe('א');
    expect(lineBlock('עיצוב-גוש א')).toBe('א');
    expect(lineBlock('פיזיקה מורחב')).toBeNull();
    expect(lineBlock('גוש')).toBeNull();
  });

  it('write block and subject keys the resolver reads', () => {
    expect(blockNameKey('ב')).toBe('block:ב');
    expect(blockNameKey("ב'")).toBe('block:ב');
    expect(subjectNameKey('פיזיקה מורחב (מעבדת פיסיקה)')).toBe('subject:פיזיקה');
    expect(subjectNameKey('חנ"ג')).toBe('subject:חינוך גופני');
  });
});
