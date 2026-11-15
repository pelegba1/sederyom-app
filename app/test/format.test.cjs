const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

function loadFormat() {
  const { code } = transformFileSync(path.join(__dirname, '../src/lib/format.ts'), {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

const f = loadFormat();
/** Thursday 8.10.2026, mid-morning, device-local like the app. */
const NOW = new Date('2026-10-08T10:00:00');

test('plural: "משימה אחת" for one, the count and the plural noun otherwise', () => {
  assert.equal(f.plural(1, 'משימה אחת', 'משימות'), 'משימה אחת');
  assert.equal(f.plural(2, 'משימה אחת', 'משימות'), '2 משימות');
  assert.equal(f.plural(0, 'משימה אחת', 'משימות'), '0 משימות');
  assert.equal(f.plural(11, 'שיעור אחד', 'שיעורים'), '11 שיעורים');
});

test('dueLabel: overdue only while open; a completed task is never "באיחור" (B2)', () => {
  assert.deepEqual(f.dueLabel('2026-10-06', { now: NOW }), { text: '6.10, באיחור', overdue: true });
  assert.deepEqual(f.dueLabel('2026-10-07', { now: NOW }), { text: 'אתמול, באיחור', overdue: true });
  assert.deepEqual(f.dueLabel('2026-10-06', { now: NOW, completed: true }), { text: '6.10', overdue: false });
  assert.deepEqual(f.dueLabel('2026-10-07', { now: NOW, completed: true }), { text: 'אתמול', overdue: false });
  assert.deepEqual(f.dueLabel('2026-10-08', { now: NOW }), { text: 'היום', overdue: false });
  assert.deepEqual(f.dueLabel('2026-10-09', { now: NOW, completed: false }), { text: 'מחר', overdue: false });
  assert.deepEqual(f.dueLabel('2026-10-20', { now: NOW }), { text: '20.10', overdue: false });
});

test('dayDateLabel: an exam\'s date in one form everywhere, "יום שלישי 20.10" (Wave 9 re-rate)', () => {
  assert.equal(f.dayDateLabel('2026-10-20'), 'יום שלישי 20.10');
  assert.equal(f.dayDateLabel('2026-10-18'), 'יום ראשון 18.10');
  assert.equal(f.dayDateLabel('2026-10-17'), 'שבת 17.10');
  assert.equal(f.dayDateLabel('2027-01-05'), 'יום שלישי 5.1');
  assert.deepEqual(f.dayDateParts('2026-10-20'), { weekday: 'יום שלישי', date: '20.10' });
  // Not "שלישי 20.10" (Today's strip) nor "יום ג׳ 20.10" (School's line), as they were.
  assert.doesNotMatch(f.dayDateLabel('2026-10-20'), /׳/);
});

test('dayTitle: weekday and full date, Saturday named as the server names it', () => {
  assert.equal(f.dayTitle('2026-10-20'), 'יום שלישי, 20.10.2026');
  assert.equal(f.dayTitle('2026-10-18'), 'יום ראשון, 18.10.2026');
  assert.equal(f.dayTitle('2026-10-24'), 'שבת, 24.10.2026');
  assert.equal(f.dayTitle('2027-01-01'), 'יום שישי, 1.1.2027');
});

test('weekRangeLabel: one month once, two months each', () => {
  assert.equal(f.weekRangeLabel('2026-10-18', '2026-10-23'), '18–23.10');
  assert.equal(f.weekRangeLabel('2026-11-29', '2026-12-04'), '29.11–4.12');
  assert.equal(f.weekRangeLabel('2026-12-27', '2027-01-01'), '27.12–1.1');
});

test('countdownLabel: today, tomorrow, the dual, then "עוד N ימים"; the past reads back', () => {
  assert.equal(f.countdownLabel(0), 'היום');
  assert.equal(f.countdownLabel(1), 'מחר');
  assert.equal(f.countdownLabel(2), 'עוד יומיים');
  assert.equal(f.countdownLabel(3), 'עוד 3 ימים');
  assert.equal(f.countdownLabel(12), 'עוד 12 ימים');
  assert.equal(f.countdownLabel(-1), 'אתמול');
  assert.equal(f.countdownLabel(-2), 'לפני יומיים');
  assert.equal(f.countdownLabel(-5), 'לפני 5 ימים');
});

test('stripGroup: the subject without its group or level', () => {
  assert.equal(f.stripGroup('אנגלית 5 יח״ל (יב2)'), 'אנגלית');
  assert.equal(f.stripGroup('אנגלית 5 יח"ל (יב2)'), 'אנגלית');
  assert.equal(f.stripGroup('מתמטיקה 3 יח"ל'), 'מתמטיקה');
  assert.equal(f.stripGroup('מתמטיקה 5 יחידות'), 'מתמטיקה');
  assert.equal(f.stripGroup('פיזיקה מורחב (מעבדת פיסיקה)'), 'פיזיקה');
  assert.equal(f.stripGroup('שרותי רשת (מעבדת מחשבים 1)'), 'שרותי רשת');
  assert.equal(f.stripGroup('עולם הערבים והאסלם (יא1)'), 'עולם הערבים והאסלם');
  assert.equal(f.stripGroup('היסטוריה'), 'היסטוריה');
  assert.equal(f.stripGroup('תנ"ך (יא1)'), 'תנ"ך');
  // Never an empty title.
  assert.equal(f.stripGroup('(יב2)'), '(יב2)');
});

test('groupOf: what the brackets held', () => {
  assert.equal(f.groupOf('אזרחות (יב2)'), 'יב2');
  assert.equal(f.groupOf('אנגלית 5 יח"ל (יב2)'), 'יב2');
  assert.equal(f.groupOf('היסטוריה'), null);
});

test('shortSubject: the real lesson names read as students say them', () => {
  const cases = {
    'שרותי רשת (מעבדת מחשבים 1)': 'רשתות',
    'שרותי רשת (מעבדת מחשבים 2)': 'רשתות',
    'פיזיקה מורחב (מעבדת פיסיקה)': 'פיז׳',
    'פיזיקה מורחב (יב3)': 'פיז׳',
    'מתמטיקה 5 יח"ל (יב2)': 'מתמ׳',
    'מתמטיקה 3 יח"ל (יא1)': 'מתמ׳',
    'אנגלית 5 יח"ל (יב2)': 'אנג׳',
    'אזרחות (יב2)': 'אזרחות',
    'היסטוריה (יב2)': 'היסט׳',
    'חינוך (יב2)': 'חינוך',
    'חינוך גופני': 'חנ״ג',
    'כימיה מורחב (מעבדת כימיה)': 'כימיה',
    'עולם הערבים והאסלם (יא1)': 'ערבים',
    'תנ"ך (יא1)': 'תנ״ך',
    'ספרות (יא1)': 'ספרות',
    'כישורי חיים': 'כישורים',
  };
  for (const [name, short] of Object.entries(cases)) assert.equal(f.shortSubject(name), short, name);
});

test('shortSubject: exam titles name their subject, or the block', () => {
  const cases = {
    'מתכונת באנגלית וויקה': 'אנג׳',
    'בגרות באנגלית - E - רק למשפרים': 'אנג׳',
    'בגרות במתמטיקה - רק למשפרים': 'מתמ׳',
    'מבחן באזרחות': 'אזרחות',
    'בגרות - שירותי רשת י"ב2': 'רשתות',
    'בגרות במדמ"ח 271- גוש': 'מדמ״ח',
    'גוש - בגרות במדעי המחשב 899271': 'מדמ״ח',
    "מבחן גוש ב'": 'גוש ב׳',
    'מבחן בגוש א': 'גוש א׳',
    'מבחן בגוש ב - פיזיקה, אמנות ומוזיקה': 'גוש ב׳',
    'מתכונת במוזיקה ובאמנות': 'מוזיקה',
    'בגרות בחנ"ג': 'חנ״ג',
    'תאריך הגשת ביו חקר': 'ביו׳',
    'י"ב6- מתכונת מערכות רפואיות': 'רפואה',
    'בגרות בעברית': 'עברית',
    'בע"פ ערבית': 'ערבית',
  };
  for (const [name, short] of Object.entries(cases)) assert.equal(f.shortSubject(name), short, name);
});

test('shownSubject and shortShownSubject: a name the student gave is shown as typed, any other as before (own names)', () => {
  // Their name, brackets and all: `originalSubject` says it is theirs.
  assert.equal(f.shownSubject({ subject: 'פיזיקה (מעבדה)', originalSubject: 'גוש ב׳' }), 'פיזיקה (מעבדה)');
  assert.equal(f.shortShownSubject({ subject: 'פיזיקה (מעבדה)', originalSubject: 'גוש ב׳' }), 'פיזיקה (מעבדה)');
  // An exam's title with their name in it is theirs too.
  assert.equal(f.shownSubject({ subject: 'מבחן פיזיקה 5 יח"ל', originalSubject: "מבחן גוש ב'" }), 'מבחן פיזיקה 5 יח"ל');
  // The school's name, as `stripGroup` and `shortSubject` write it.
  assert.equal(f.shownSubject({ subject: 'אנגלית 5 יח"ל (יב2)' }), f.stripGroup('אנגלית 5 יח"ל (יב2)'));
  assert.equal(f.shownSubject({ subject: 'אנגלית 5 יח"ל (יב2)' }), 'אנגלית');
  assert.equal(f.shortShownSubject({ subject: 'אנגלית 5 יח"ל (יב2)' }), 'אנג׳');
});

test('shortSubject: an unknown subject keeps its first whole word, never a cut one', () => {
  assert.equal(f.shortSubject('אקדמיזציה'), 'אקדמיזציה');
  assert.equal(f.shortSubject('3 אקדמיזציה'), 'אקדמיזציה');
  assert.equal(f.shortSubject("מבחן מועד ב'"), 'מועד');
  assert.equal(f.shortSubject('טורניר כספות'), 'טורניר');
  assert.equal(f.shortSubject('תקשורת (יב7)'), 'תקשורת');
});

test('isolateRanges pins numeric ranges left-to-right, joins the dash inside them, and leaves the rest', () => {
  const L = '⁦', P = '⁩', J = '⁠';
  assert.equal(f.WORD_JOINER, J);
  assert.equal(f.isolateRanges('שאלות 1–5 בעמוד 12'), `שאלות ${L}1${J}–${J}5${P} בעמוד 12`);
  assert.equal(f.isolateRanges('היום 08:00–10:30, 4 בוטלו'), `היום ${L}08:00${J}–${J}10:30${P}, 4 בוטלו`);
  // A dash with spaces round it is isolated with its range, but may still break at the spaces.
  assert.equal(f.isolateRanges('תרגילים 3-7, 9 - 11'), `תרגילים ${L}3${J}-${J}7${P}, ${L}9 - 11${P}`);
  assert.equal(f.isolateRanges('בלי טווח: 15.10'), 'בלי טווח: 15.10');
  const once = f.isolateRanges('1–5');
  assert.equal(f.isolateRanges(once), once);
});

test('isolateRanges: no line break at a dash between two words or numbers (the Wave 9 re-rate)', () => {
  const J = '⁠';
  // "מהירות–" at the end of one line and "זמן" on the next.
  assert.equal(f.isolateRanges('ולשרטט גרף מהירות–זמן'), `ולשרטט גרף מהירות${J}–${J}זמן`);
  assert.equal(f.isolateRanges('מבחן—אנגלית'), `מבחן${J}—${J}אנגלית`);
  assert.equal(f.isolateRanges('אנגלי-עברי'), `אנגלי${J}-${J}עברי`);
  assert.equal(f.isolateRanges('a-b-c'), `a${J}-${J}b${J}-${J}c`);
  // A sentence's dash has a space beside it: it may break there.
  assert.equal(f.isolateRanges('דף עבודה — שאלות'), 'דף עבודה — שאלות');
  assert.equal(f.isolateRanges('שאלה -5'), 'שאלה -5');
  assert.equal(f.isolateRanges('עד הסוף- ואז'), 'עד הסוף- ואז');
  // A link and an address keep their characters: they may be copied.
  assert.equal(f.isolateRanges('בקישור https://my-site.example/a-b'), 'בקישור https://my-site.example/a-b');
  assert.equal(f.isolateRanges('www.my-site.example'), 'www.my-site.example');
  assert.equal(f.isolateRanges('first-last@school.example'), 'first-last@school.example');
  // Twice is once, with or without a numeric range in the text.
  for (const text of ['מהירות–זמן', 'שאלות 1–6 ומהירות–זמן', 'שאלות 1–6']) {
    const once = f.isolateRanges(text);
    assert.equal(f.isolateRanges(once), once, text);
  }
});

test('relativeTime: whole words for minutes and hours (run 4)', () => {
  const at = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();
  assert.equal(f.relativeTime(at(0), NOW), 'עכשיו');
  assert.equal(f.relativeTime(at(1), NOW), 'לפני דקה');
  assert.equal(f.relativeTime(at(5), NOW), 'לפני 5 דקות');
  assert.equal(f.relativeTime(at(60), NOW), 'לפני שעה');
  assert.equal(f.relativeTime(at(120), NOW), 'לפני שעתיים');
  assert.equal(f.relativeTime(at(8 * 60), NOW), 'לפני 8 שעות');
  assert.equal(f.relativeTime(at(26 * 60), NOW), 'אתמול');
});
