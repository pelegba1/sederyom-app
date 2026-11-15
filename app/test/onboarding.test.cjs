const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/** Compiles one app module to CommonJS; `deps` resolves its relative imports. */
function load(file, deps = {}) {
  const { code } = transformFileSync(path.join(__dirname, '../src/lib', file), {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  const localRequire = (id) => (id in deps ? deps[id] : require(id));
  new Function('module', 'exports', 'require', code)(module, module.exports, localRequire);
  return module.exports;
}

const format = load('format.ts');
const gradeWeights = load('gradeWeights.ts', { './format': format });
const school = load('school.ts', { './format': format, './gradeWeights': gradeWeights });
const o = load('onboarding.ts', { './format': format, './school': school, './className': load('className.ts') });

/** The school site's class list as server/fixtures/shahaf/root-classlist.html has it. */
const FIXTURE_CLASSES = [
  ['1', 'י1'], ['2', 'י2'], ['3', 'י3'], ['4', 'י3 מוסיקה'], ['5', 'י4'], ['6', 'י5'], ['54', 'י5 אומנות'],
  ['14', 'י6'], ['46', 'י7'], ['47', 'י8'], ['55', 'מרחב למידה'], ['17', 'יא2'], ['18', 'יא3'],
  ['19', 'יא3 מוסיקה'], ['20', 'יא4'], ['32', 'יא5'], ['45', 'יא6'], ['50', 'יא 7'], ['53', 'יא8'],
  ['34', 'יב1'], ['36', 'יב2'], ['39', 'יב3מוסיקה'], ['37', 'יב3'], ['40', 'יב4'], ['41', 'יב5'],
  ['42', 'יב5 אמנות'], ['48', 'יב6'], ['49', 'יב6 ביו רפואה'], ['51', 'יב7'],
].map(([id, name]) => ({ id, name }));

test('parseClassName: grade, number and track, whatever the spacing and quote marks', () => {
  assert.deepEqual(o.parseClassName('יב2'), { grade: 'יב', number: 2, rest: '' });
  assert.deepEqual(o.parseClassName('יא 7'), { grade: 'יא', number: 7, rest: '' });
  assert.deepEqual(o.parseClassName('יב3מוסיקה'), { grade: 'יב', number: 3, rest: 'מוסיקה' });
  assert.deepEqual(o.parseClassName('י 8  ערבית'), { grade: 'י', number: 8, rest: 'ערבית' });
  // Other schools' Shahaf sites (2026-10-19): a dash between grade and number, or before the track.
  assert.deepEqual(o.parseClassName('ז-1'), { grade: 'ז', number: 1, rest: '' });
  assert.deepEqual(o.parseClassName('ט\' - 1'), { grade: 'ט', number: 1, rest: '' });
  assert.deepEqual(o.parseClassName('יב\'- 6'), { grade: 'יב', number: 6, rest: '' });
  assert.deepEqual(o.parseClassName('י\' 2- טכנולוגי'), { grade: 'י', number: 2, rest: 'טכנולוגי' });
  // The technological colleges' 13th and 14th years.
  assert.deepEqual(o.parseClassName('יג\'- 3'), { grade: 'יג', number: 3, rest: '' });
  assert.equal(o.displayClassName('יד\'- 1'), 'י״ד 1');
  assert.deepEqual(o.parseClassName('י״א 3'), { grade: 'יא', number: 3, rest: '' });
  assert.deepEqual(o.parseClassName('י"ב4'), { grade: 'יב', number: 4, rest: '' });
  assert.deepEqual(o.parseClassName("י' 1"), { grade: 'י', number: 1, rest: '' });
  // A track that starts with א or ב is not grade י״א / י״ב.
  assert.deepEqual(o.parseClassName('י אומנות'), { grade: 'י', number: null, rest: 'אומנות' });
  // No grade: a word that merely starts with a grade letter, or no grade at all.
  assert.deepEqual(o.parseClassName('מרחב למידה'), { grade: null, number: null, rest: 'מרחב למידה' });
  assert.deepEqual(o.parseClassName('טיול שנתי'), { grade: null, number: null, rest: 'טיול שנתי' });
});

test('hasBagrut: middle school (ז–ט) sits none; high school, a gradeless class and no class yet do', () => {
  for (const name of ['ז-1', "ח' 3", "ט' - 1", 'ט3']) assert.equal(o.hasBagrut(name), false, name);
  for (const name of ['י1', 'יא 7', 'יב2', 'יב3מוסיקה', 'מרחב למידה', '', null, undefined]) assert.equal(o.hasBagrut(name), true, String(name));
});

test('classStepPage: the list when there is one; else through Mashov, or the site\'s address when no site is known', () => {
  // A list is the list, however it came and whatever else is so.
  assert.equal(o.classStepPage(29, false, { from: 'pasted' }), 'list');
  assert.equal(o.classStepPage(1, true, { from: 'none' }), 'list');
  // No list, no Mashov: it comes through Mashov.
  assert.equal(o.classStepPage(0, false, { from: 'unknown' }), 'connect');
  assert.equal(o.classStepPage(0, false, undefined), 'connect');
  // Mashov named no site, or could not say (a 404 or a 500 for a school without one): paste it, or go on without.
  assert.equal(o.classStepPage(0, true, { from: 'none' }), 'site');
  assert.equal(o.classStepPage(0, true, { from: 'unknown' }), 'site');
  // A site known whose list did not come: "not yet", not "no site".
  for (const from of ['class', 'pasted', 'mashov']) assert.equal(o.classStepPage(0, true, { from }), 'list', from);
  // Settings not loaded yet: no page flashes before they are.
  assert.equal(o.classStepPage(0, true, undefined), 'list');
});

test('displayClassName: one spacing, geresh and gershayim', () => {
  assert.equal(o.displayClassName('י1'), 'י׳ 1');
  assert.equal(o.displayClassName('יא 7'), 'י״א 7');
  assert.equal(o.displayClassName('יב3מוסיקה'), 'י״ב 3 מוסיקה');
  assert.equal(o.displayClassName('י 7 תקשורת'), 'י׳ 7 תקשורת');
  assert.equal(o.displayClassName('יא  8 ערבית'), 'י״א 8 ערבית');
  assert.equal(o.displayClassName('מרחב למידה'), 'מרחב למידה');
});

test('groupClasses: the fixture list by grade, low first, the gradeless last; ids untouched', () => {
  const groups = o.groupClasses(FIXTURE_CLASSES);
  assert.deepEqual(groups.map((g) => g.label), ['שכבה י׳', 'שכבה י״א', 'שכבה י״ב', 'אחר']);
  assert.deepEqual(groups.map((g) => g.items.length), [10, 8, 10, 1]);
  const yb = groups[2];
  // The plain class before its track; "יב3מוסיקה" came before "יב3" on the site.
  assert.deepEqual(yb.items.map((i) => i.short), ['1', '2', '3', '3 מוסיקה', '4', '5', '5 אמנות', '6', '6 ביו רפואה', '7']);
  const music = yb.items.find((i) => i.short === '3 מוסיקה');
  assert.deepEqual(music, { id: '39', name: 'יב3מוסיקה', display: 'י״ב 3 מוסיקה', short: '3 מוסיקה' });
  assert.deepEqual(groups[3].items, [{ id: '55', name: 'מרחב למידה', display: 'מרחב למידה', short: 'מרחב למידה' }]);
  // Every class appears exactly once.
  const ids = groups.flatMap((g) => g.items.map((i) => i.id)).sort();
  assert.deepEqual(ids, FIXTURE_CLASSES.map((c) => c.id).sort());
});

test('groupClasses: the review list (spaces inside, a class with a track and no number)', () => {
  const groups = o.groupClasses([
    { id: '20', name: 'י 7 תקשורת' }, { id: '34', name: 'י 9' }, { id: '1', name: 'י1' },
    { id: '49', name: 'יא 8 ערבית' }, { id: '48', name: 'יא8' }, { id: '9', name: 'י אומנות' },
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.short)]), [
    ['שכבה י׳', ['1', '7 תקשורת', '9', 'אומנות']],
    ['שכבה י״א', ['8', '8 ערבית']],
  ]);
  assert.deepEqual(o.groupClasses([]), []);
});

const exam = (naturalKey, mine, subjectKey = 'אנגלית', reason = null, date = '2026-10-20') => ({
  naturalKey, date, subject: `מבחן ב${subjectKey}`, subjectKey, match: { mine, reason },
});

test('applyExamRecommendation: shows mine, hides not-mine, leaves the unsure and unknown keys alone', () => {
  const exams = [
    exam('a', true), exam('b', false, 'מתמטיקה', 'רק למשפרים'), exam('c', null, ''),
    exam('d', true, 'היסטוריה'), exam('e', false, 'כימיה', 'לא במערכת שלך'), exam('f', null, ''),
  ];
  // a was hidden (mine: show it), b already hidden (stays), c hidden and unsure (stays),
  // f shown and unsure (stays shown), x is not in the list (a past exam: stays).
  const next = o.applyExamRecommendation(exams, ['a', 'b', 'c', 'x']);
  assert.deepEqual(next, ['b', 'c', 'x', 'e']);
  assert.equal(next.includes('a'), false);
  assert.equal(next.includes('d'), false);
  assert.equal(next.includes('f'), false);
});

test('applyExamRecommendation: applying twice changes nothing, and sameKeys says so', () => {
  const exams = [exam('a', true), exam('b', false), exam('c', null)];
  const once = o.applyExamRecommendation(exams, []);
  assert.deepEqual(once, ['b']);
  const twice = o.applyExamRecommendation(exams, once);
  assert.deepEqual(twice, once);
  assert.equal(o.sameKeys(once, twice), true);
  assert.equal(o.sameKeys(['b', 'c'], ['c', 'b']), true);
  assert.equal(o.sameKeys(['b'], ['b', 'c']), false);
  // Nothing to recommend: the list is returned as it was.
  assert.deepEqual(o.applyExamRecommendation([exam('c', null)], ['c', 'z']), ['c', 'z']);
});

test('examStepOffer: what "המשך" saves — mine and every unsure one kept, not-mine hidden, unknown keys untouched', () => {
  const exams = [
    exam('1', true, 'אנגלית', null, '2026-10-20'),
    exam('2', false, 'מתמטיקה', 'רק למשפרים', '2026-10-22'),
    exam('8', null, '', null, '2026-10-23'),
    exam('3', true, 'היסטוריה', null, '2026-10-25'),
    exam('5', false, '', 'גוש א׳ — מקצוע אחר', '2026-11-03'),
    exam('9', null, 'אנגלית', null, '2026-11-04'),
    exam('7', false, 'פיזיקה', 'לא במערכת שלך', '2026-11-05'),
  ];
  // 1 hidden by mistake comes back; 8 hidden before the step is kept, with its "?"; "old" is a past exam.
  assert.deepEqual(o.examStepOffer(exams, ['1', '8', 'old']).sort(), ['2', '5', '7', 'old']);
  const view = o.examStepView(exams, ['1', '8', 'old'], false);
  assert.deepEqual([view.phase, view.total, view.unsure, view.mine], ['offer', 4, 2, 2]);
  // "לא שלי" on this step is the one way an unsure exam stays hidden.
  assert.deepEqual(o.examStepOffer(exams, ['8'], ['8']).sort(), ['2', '5', '7', '8']);
  assert.deepEqual(o.examStepOffer(exams, [], ['9']).sort(), ['2', '5', '7', '9']);
});

test('run 7: an unsure exam hidden before the step starts kept, with its "?" — the phase detector leaves it alone', () => {
  const exams = [exam('m', true), exam('n', false, 'כימיה', 'לא במערכת שלך'), exam('u1', null, ''), exam('u2', null, '')];
  const view = o.examStepView(exams, ['u2'], false);
  assert.equal(view.phase, 'offer');
  assert.deepEqual([view.total, view.unsure], [3, 2]);
  assert.equal(view.hidden.includes('u2'), false);
  // The recommendation alone leaves it as it was: a second run from Settings is not an offer again.
  assert.equal(o.applyExamRecommendation(exams, ['u2']).includes('u2'), true);
  assert.equal(o.examStepView(exams, ['n', 'u2'], false).phase, 'marked');
  // Run 6 (Noa): "המבחנים שלי" showed a "?" onboarding never listed. Every unsure exam is listed.
  assert.deepEqual(o.examStepUnsure(exams).flatMap((g) => g.exams).map((e) => e.naturalKey), ['u1', 'u2']);
});

test('TAB_GUIDE: the five tabs, in tab-bar order, each with an icon and a line', () => {
  assert.deepEqual(o.TAB_GUIDE.map((t) => t.title), ['היום שלי', 'שבוע', 'תכנון', 'משימות', 'בית ספר']);
  for (const tab of o.TAB_GUIDE) {
    assert.ok(tab.icon && tab.body.length > 10);
    assert.doesNotMatch(tab.body, /סשן|שרת|סנכרון/);
    // A product name read as one more app to install (Maya).
    assert.doesNotMatch(tab.body, /Google Tasks/);
  }
  // תכנון has its own icon now, not the week's calendar.
  assert.equal(o.TAB_GUIDE.find((t) => t.title === 'תכנון').icon, 'plan');
  // Tasks are kept on the phone alone until Google is connected: the tour does not say they live in the account.
  assert.doesNotMatch(o.TAB_GUIDE.find((t) => t.title === 'משימות').body, /נשמרות בחשבון/);
  // The bell's number and the gear's dot (Wave 5), said where the tour and help say the rest.
  assert.match(o.HEADER_GUIDE, /הפעמון/);
  assert.match(o.HEADER_GUIDE, /כמה מהן חדשות/);
  assert.match(o.HEADER_GUIDE, /נקודה עליו אומרת שחיבור צריך בדיקה/);
  assert.doesNotMatch(o.HEADER_GUIDE, /סשן|שרת|סנכרון/);
});

// --- R-22: the steps ---------------------------------------------------------

test('ONBOARDING_STEPS: five steps, Google and Mashov in one, no tour step', () => {
  assert.deepEqual([...o.ONBOARDING_STEPS], ['welcome', 'connect', 'class', 'exams', 'notifications']);
  assert.equal(o.ONBOARDING_STEPS.includes('tour'), false);
  assert.equal(o.stepLabel('welcome'), 'שלב 1 מתוך 5');
  assert.equal(o.stepLabel('notifications'), 'שלב 5 מתוך 5');
});

test('stepBack / stepForward: back on every step but the first, forward on every step but the last', () => {
  assert.equal(o.stepBack('welcome'), null);
  assert.equal(o.stepBack('connect'), 'welcome');
  assert.equal(o.stepBack('class'), 'connect');
  assert.equal(o.stepBack('exams'), 'class');
  assert.equal(o.stepBack('notifications'), 'exams');
  assert.equal(o.stepForward('welcome'), 'connect');
  assert.equal(o.stepForward('exams'), 'notifications');
  assert.equal(o.stepForward('notifications'), null);
  // Walking back from the last step visits every step once and stops at the first.
  const walked = [];
  for (let s = 'notifications'; s; s = o.stepBack(s)) walked.push(s);
  assert.deepEqual(walked, [...o.ONBOARDING_STEPS].reverse());
  // Forward then back is where it started.
  for (const s of o.ONBOARDING_STEPS.slice(0, -1)) assert.equal(o.stepBack(o.stepForward(s)), s);
});

// --- R-23, W4-4: the exam step's count and words ----------------------------------

/** 3 recommended, 2 not mine, 3 unsure — the review's numbers, shrunk. */
function reviewExams() {
  return [
    exam('m1', true, 'אנגלית'), exam('m2', true, 'אנגלית'), exam('m3', true, 'היסטוריה'),
    exam('n1', false, 'מתמטיקה', 'רק למשפרים'), exam('n2', false, 'כימיה', 'מועד ב׳ — רק למי שניגש'),
    exam('u1', null, ''), exam('u2', null, 'אנגלית'), exam('u3', null, ''),
  ];
}

test('the step\'s count is the number "המבחנים שלי" shows after "המשך" — one examCounts, any prior hide-list', () => {
  const exams = reviewExams().map((e) => ({ ...e, details: null, source: 'school_site', hidden: false }));
  const priors = [
    [], // a first run
    ['m3', 'u3', 'old'], // a recommended one hidden by mistake, an unsure one on purpose, a past exam
    ['n1', 'u1', 'u2'], // not-mine already hidden, two unsure hidden
    exams.map((e) => e.naturalKey), // everything hidden
  ];
  for (const hiddenKeys of priors) {
    const view = o.examStepView(exams, hiddenKeys, false);
    const after = school.examCounts(exams, new Set(o.examStepOffer(exams, hiddenKeys)));
    const label = JSON.stringify(hiddenKeys);
    assert.equal(view.phase, 'offer', `hidden ${label}: offered`);
    assert.equal(view.total, after.chosen, `hidden ${label}: the step's total`);
    assert.equal(view.unsure, after.unsure, `hidden ${label}: the "?" count`);
    // No recommended exam is left off, every not-mine one is hidden, and every unsure one is kept.
    assert.deepEqual(after.recommendedOff, [], `hidden ${label}: recommended still off`);
    assert.equal(after.unsure, 3, `hidden ${label}: every unsure exam kept`);
  }
  // A first run: 3 that look like yours and 3 unsure.
  const first = o.examStepView(exams, [], false);
  assert.equal(o.examStepLine(first, exams.length), '6 מבחנים');
  assert.match(o.examStepLeaveLine(first.unsure), /^על 3 מבחנים /);
  assert.equal(o.examsMarkedLabel(first.total), '6 מבחנים מסומנים כשלך');
});

// --- W5-11: the step's total is the "המבחנים שלי" total, on every path ------------

/**
 * The review's exams as /settings sends them, with an account that already
 * had a hide-list — the run-4 gap: 11 + 4 on the step, 17 in "המבחנים שלי".
 */
function reviewOptions() {
  return reviewExams().map((e) => ({ ...e, details: null, source: 'school_site', hidden: false }));
}

/** What "המבחנים שלי" shows: its count, from lib/school's `examCounts`. */
function myExamsLine(exams, hiddenKeys) {
  const counts = school.examCounts(exams, new Set(hiddenKeys));
  return { total: counts.chosen, unsure: counts.unsure, line: school.examsCountLabel(counts.chosen, counts.unsure) };
}

test('W5-11: the step total === the "המבחנים שלי" total — "המשך", and back after changes there', () => {
  const exams = reviewOptions();
  const priors = [
    [], // a first run: nothing hidden, so "המבחנים שלי" would show every exam
    ['m3', 'u3', 'old'], // a recommended exam hidden by mistake, an unsure one on purpose, a past exam
    ['n1', 'u1', 'u2'],
  ];
  for (const before of priors) {
    const label = JSON.stringify(before);
    const offer = o.examStepView(exams, before, false);
    assert.equal(offer.phase, 'offer', `${label}: offered`);
    // What "המשך" saves.
    const applied = o.examStepOffer(exams, before);
    assert.deepEqual(offer.hidden, applied, `${label}: the rows read the list "המשך" saves`);

    // "המשך": the offer's number is what "המבחנים שלי" shows after it, and the
    // step, come back to, shows that same number marked — in the same line.
    assert.equal(offer.total, myExamsLine(exams, applied).total, `${label}: offer = after "המשך"`);
    assert.equal(offer.unsure, myExamsLine(exams, applied).unsure, `${label}: the "?" count`);
    const back1 = o.examStepView(exams, applied, true);
    assert.equal(back1.phase, 'marked');
    assert.deepEqual([back1.total, back1.unsure], [offer.total, offer.unsure], `${label}: the number does not jump`);
    assert.equal(o.examStepLine(back1, exams.length), o.examStepLine(offer, exams.length), `${label}: one line on the way back`);

    // Back from "המבחנים שלי" after changes there: every one of its controls.
    const all = exams.map((e) => e.naturalKey);
    const recommendedOff = (hidden) => school.examCounts(exams, new Set(hidden)).recommendedOff;
    const m2Off = school.setExamsShown(applied, ['m2'], false);
    const edits = {
      'hide a recommended exam': school.setExamsShown(applied, ['m1'], false),
      'mark a not-mine exam': school.setExamsShown(applied, ['n1'], true),
      'hide an unsure exam': school.setExamsShown(applied, ['u1'], false),
      'לסמן את המומלצים': school.setExamsShown(m2Off, recommendedOff(m2Off), true),
      'לסמן הכול': school.setExamsShown(applied, all, true),
      'להסתיר הכול': school.setExamsShown(applied, all, false),
    };
    for (const [edit, after] of Object.entries(edits)) {
      const back3 = o.examStepView(exams, after, true);
      assert.equal(back3.phase, 'marked', `${label}, ${edit}: still the marked count`);
      assert.deepEqual([back3.total, back3.unsure], [myExamsLine(exams, after).total, myExamsLine(exams, after).unsure], `${label}, ${edit}`);
    }
    // The run-4 bug: never the recommendation's numbers once changed — 'mark a not-mine exam' is one more.
    const changed = school.setExamsShown(applied, ['n1'], true);
    const rec = o.examStepView(exams, changed, false);
    assert.equal(rec.phase, 'offer');
    assert.notEqual(o.examStepView(exams, changed, true).total, rec.total, `${label}: not the recommendation`);
  }
});

// --- §14.7: one line, one button --------------------------------------------------

test('examStepCheckingLine: says what the person did - picked a class, or saved a board - and speaks to them', () => {
  assert.equal(o.examStepCheckingLine('class'), 'בודקים אילו מבחנים מתאימים לכיתה שבחרת…');
  assert.equal(o.examStepCheckingLine('board'), 'בודקים אילו מבחנים מהלוח מתאימים לך…');
  // A saved board is not a class that was chosen.
  assert.doesNotMatch(o.examStepCheckingLine('board'), /שבחרת/);
  for (const reason of ['class', 'board']) {
    const line = o.examStepCheckingLine(reason);
    assert.ok(line.length <= 50, line);
    assert.doesNotMatch(line, /להצטרף|סשן|שרת|סנכרון/, line);
  }
});

test('§14.7, §16.2 examStepLine: the count alone while some are "?" — no chain after a "·" (Itai, Maya)', () => {
  assert.equal(o.examStepLine({ phase: 'offer', total: 15, unsure: 6 }, 30), '15 מבחנים');
  assert.equal(o.examStepLine({ phase: 'marked', total: 15, unsure: 6 }, 30), '15 מבחנים');
  assert.equal(o.examStepLine({ phase: 'offer', total: 15, unsure: 1 }, 30), '15 מבחנים');
  assert.equal(o.examStepLine({ phase: 'offer', total: 1, unsure: 1 }, 3), 'מבחן אחד');
  // Nothing unsure: what they are, in "המבחנים שלי"'s words once marked.
  assert.equal(o.examStepLine({ phase: 'offer', total: 11, unsure: 0 }, 30), '11 מבחנים נראים שלך');
  assert.equal(o.examStepLine({ phase: 'offer', total: 1, unsure: 0 }, 30), 'מבחן אחד נראה שלך');
  assert.equal(o.examStepLine({ phase: 'marked', total: 11, unsure: 0 }, 30), '11 מבחנים מסומנים כשלך');
  // Nothing marked, or nothing published.
  assert.equal(o.examStepLine({ phase: 'none', total: 0, unsure: 0 }, 30), 'אין מבחנים שסומנו כשלך, ואפשר לסמן אחר כך');
  assert.equal(o.examStepLine({ phase: 'none', total: 0, unsure: 0 }, 0), 'עוד אין מבחנים בלוח של השכבה');
  for (const view of [{ phase: 'offer', total: 15, unsure: 4 }, { phase: 'none', total: 0, unsure: 0 }]) {
    const line = o.examStepLine(view, 30);
    assert.ok(line.length <= 50, line);
    assert.doesNotMatch(line, /סשן|שרת|סנכרון|הוחל/);
  }
  // The words of the old step are gone with it.
  for (const gone of [
    'examStepCountLine', 'examStepLead', 'UNSURE_HINT', 'BLOCK_EXAMS_GROUP', 'examRowDetail', 'choseMyselfLine', 'examStepState', 'examStepList',
  ]) {
    assert.equal(o[gone], undefined, gone);
  }
});

// --- Run 7: one state per row, a count that matches them, and "המשך" says what it keeps ---

/** What "לבדוק עכשיו" draws: every row and its one state, read off the list the step will leave. */
function drawnRows(exams, view) {
  const hidden = new Set(view.hidden);
  return o.examStepUnsure(exams).flatMap((g) => g.exams).map((e) => ({ key: e.naturalKey, state: o.examStepRowState(e, hidden) }));
}

/** Run 7's step, shrunk: two mine, one not-mine, and unsure exams with the same reason. */
function runSevenExams() {
  return [
    exam('m1', true, 'אנגלית'), exam('m2', true, 'היסטוריה'), exam('n1', false, 'מתמטיקה', 'רק למשפרים'),
    { ...exam('gA1', null, ''), subject: "מבחן גוש א'" }, { ...exam('gA2', null, ''), subject: "מבחן גוש א'", date: '2026-12-01' },
    { ...exam('gB1', null, ''), subject: "מבחן גוש ב'" }, { ...exam('gB2', null, ''), subject: "גוש ב'", date: '2026-12-16' },
    { ...exam('mock', null, 'אנגלית'), subject: 'מתכונת באנגלית וויקה' }, { ...exam('other', null, ''), subject: "מועד ב'" },
  ];
}

test('run 7: the count is exactly the "?" rows shown — on every prior hide-list and after every answer (Maya, Noa)', () => {
  const raw = runSevenExams();
  const priors = [
    [], // a first run
    ['gA1', 'gA2'], // the review's account: gush א׳ hidden before the step, gush ב׳ not
    ['gA1', 'gA2', 'n1'], // …with not-mine already hidden: nothing to offer, the marks as they are
    raw.map((e) => e.naturalKey), // everything hidden
  ];
  // Answers on the step: none; "לא שלי" on the mock exam; "שלי" on a block exam; both.
  const answers = [
    { here: [], mine: [] }, { here: ['mock'], mine: [] }, { here: [], mine: ['gB1'] }, { here: ['mock', 'gA1'], mine: ['gB1'] },
  ];
  for (const prior of priors) {
    for (const { here, mine } of answers) {
      const label = `hidden ${JSON.stringify(prior)}, "לא שלי" ${JSON.stringify(here)}, "שלי" ${JSON.stringify(mine)}`;
      const exams = school.withConfirmed(raw, new Set(mine));
      // Both answers save at once, as the screen does: "לא שלי" hides, "שלי" shows.
      const hiddenKeys = school.setExamsShown(school.setExamsShown(prior, here, false), mine, true);
      for (const appliedHere of [false, true]) {
        const view = o.examStepView(exams, hiddenKeys, appliedHere, here);
        const rows = drawnRows(exams, view);
        const open = rows.filter((r) => r.state === 'open').length;
        assert.equal(view.unsure, open, `${label}${appliedHere ? ', after "המשך"' : ''}: "לבדוק" = the "?" rows`);
        // The line under the count says how many are "?": exactly those rows.
        const line = o.examStepLine(view, raw.length);
        const leave = o.examStepLeaveLine(view.unsure);
        if (open > 0) assert.match(leave, new RegExp(`^על ${open === 1 ? 'מבחן אחד' : `${open} מבחנים`} אנחנו לא בטוחים`), label);
        else assert.equal(leave, null, label);
        assert.doesNotMatch(line, /·|לבדוק|לא בטוחים/, label);
        // Every row has one state, and an answered one is never "?".
        for (const key of here) assert.equal(rows.find((r) => r.key === key).state, 'hidden', `${label}: ${key}`);
        for (const key of mine) assert.equal(rows.find((r) => r.key === key).state, 'mine', `${label}: ${key}`);
      }
    }
  }
});

test('run 7: the same reason gets the same start — every undecided unsure exam is kept, with "?" (Noa)', () => {
  const exams = runSevenExams();
  const view = o.examStepView(exams, ['gA1', 'gA2'], false);
  assert.equal(view.phase, 'offer');
  const rows = drawnRows(exams, view);
  // Gush א׳ (hidden before) and gush ב׳ (shown before), one reason, one state.
  assert.equal(school.unsureReason(exams[3]), school.unsureReason(exams[5]));
  for (const key of ['gA1', 'gA2', 'gB1', 'gB2']) assert.equal(rows.find((r) => r.key === key).state, 'open', key);
  assert.deepEqual([view.total, view.unsure], [8, 6]);
  assert.equal(o.examStepLine(view, exams.length), '8 מבחנים');
  assert.match(o.examStepLeaveLine(view.unsure), /^על 6 מבחנים /);
  // "המשך" saves exactly that, and "המבחנים שלי" counts it the same.
  const after = school.examCounts(exams, new Set(o.examStepOffer(exams, ['gA1', 'gA2'])), new Set());
  assert.deepEqual([after.chosen, after.unsure], [8, 6]);
});

test('run 7: "המשך" does not decide silently — the line before it and the toast after it say what keeps its "?"', () => {
  // Plan §16.2's words, in place of "6 יישארו אצלך עם ״?״ — אפשר לבדוק אחר כך בבית ספר".
  assert.equal(o.examStepLeaveLine(6), 'על 6 מבחנים אנחנו לא בטוחים. אפשר לעבור עליהם עכשיו או אחר כך.');
  assert.equal(o.examStepLeaveLine(1), 'על מבחן אחד אנחנו לא בטוחים. אפשר לעבור עליו עכשיו או אחר כך.');
  assert.equal(o.examStepLeaveLine(0), null);
  // Wave 9 re-rate: in words, not "6 עם ״?״".
  assert.equal(o.examStepDoneToast({ total: 19, unsure: 6 }), 'סימנו 19 מבחנים שלך. על 6 כדאי להציץ.');
  assert.equal(o.examStepDoneToast({ total: 15, unsure: 1 }), 'סימנו 15 מבחנים שלך. על אחד כדאי להציץ.');
  assert.equal(o.examStepDoneToast({ total: 15, unsure: 0 }), 'סימנו 15 מבחנים שלך.');
  assert.equal(o.examStepDoneToast({ total: 1, unsure: 0 }), 'סימנו מבחן אחד שלך.');
  assert.equal(o.examStepDoneToast({ total: 0, unsure: 0 }), 'אין מבחנים שסומנו כשלך');
  // Run 8 (Noa): its action says what it undoes.
  assert.equal(o.EXAM_STEP_UNDO, 'לבטל את הסימון');
  // The toast counts what "המשך" saved: the offer's numbers.
  const exams = runSevenExams();
  const view = o.examStepView(exams, [], false);
  const after = school.examCounts(exams, new Set(o.examStepOffer(exams, [])), new Set());
  assert.equal(o.examStepDoneToast(view), o.examStepDoneToast({ total: after.chosen, unsure: after.unsure }));
  // The words that confused the step are gone from it. "לא בטוחים" is back on
  // purpose: it is plan §16.2's sentence, said of us, not of a mark.
  for (const text of [o.examStepLeaveLine(6), o.examStepDoneToast(view), ...Object.values(o.EXAM_ROW_LABELS), o.examsMarkedLabel(0),
    o.examStepLine({ phase: 'none', total: 0, unsure: 0 }, 30)]) {
    assert.doesNotMatch(text, /לא מסומן|סשן|שרת|סנכרון/, text);
    // Plan §16.2: no tick, no long dash, at most one "·".
    assert.doesNotMatch(text, /[✓✔]|\s—\s|·.*·/, text);
  }
  assert.deepEqual(o.EXAM_ROW_LABELS, { mine: 'שלי', hidden: 'הוסתר', open: '?' });
});

test('examStepTerms: "מה זה גוש?" and "מה זה מתכונת?" only while the list holds the word (Maya)', () => {
  const block = { ...exam('b', null, 'גוש ב׳: פיזיקה, ביולוגיה'), subject: 'י"ב- מבחן בגוש ב' };
  const bareBlock = { ...exam('b2', null, ''), subject: "גוש ב'" };
  const mock = { ...exam('m', null, 'אנגלית'), subject: 'מתכונת באנגלית וויקה' };
  const plain = exam('p', null, 'היסטוריה');
  assert.deepEqual(o.examStepTerms([block, mock, plain]).map((t) => t.question), ['מה זה גוש?', 'מה זה מתכונת?']);
  assert.deepEqual(o.examStepTerms([bareBlock]).map((t) => t.question), ['מה זה גוש?']);
  assert.deepEqual(o.examStepTerms([mock]).map((t) => t.question), ['מה זה מתכונת?']);
  assert.deepEqual(o.examStepTerms([plain]), []);
  assert.deepEqual(o.examStepTerms([]), []);
  const [blockTerm, mockTerm] = o.examStepTerms([block, mock]);
  assert.equal(blockTerm.answer, school.BLOCK_EXPLAINER);
  assert.equal(mockTerm.answer, school.MOCK_EXAM_EXPLAINER);
  // Each answer explains the word without leaning on it.
  assert.doesNotMatch(school.MOCK_EXAM_EXPLAINER.replace(/^מתכונת/, ''), /מתכונת/);
});

// --- W6-2: "שלי" clears the "?", and every count follows ----------------------

test('W6-2: after "שלי" the step, "המבחנים שלי" and School show one number and one "?" count, on every path', () => {
  const raw = reviewOptions();
  const priors = [[], ['m3', 'u3', 'old'], ['n1', 'u1', 'u2'], ['u2']];
  // Answers: none; one; every unsure one; and keys for exams the server did place (ignored).
  const answers = [[], ['u2'], ['u1', 'u2', 'u3'], ['u2', 'm1', 'n1']];
  for (const before of priors) {
    for (const keys of answers) {
      const label = `hidden ${JSON.stringify(before)}, "שלי" on ${JSON.stringify(keys)}`;
      const confirmed = new Set(keys);
      // Every screen reads the exams through `withConfirmed`, and passes the same set to `examCounts`.
      const exams = school.withConfirmed(raw, confirmed);
      const applied = o.examStepOffer(exams, before);
      const mine = school.examCounts(exams, new Set(applied), confirmed); // "המבחנים שלי"
      const schoolTab = school.examCounts(raw, new Set(applied), confirmed); // School, from /settings as sent
      assert.deepEqual([schoolTab.chosen, schoolTab.unsure], [mine.chosen, mine.unsure], `${label}: School = המבחנים שלי`);

      const offer = o.examStepView(exams, before, false);
      if (offer.phase === 'offer') {
        assert.equal(offer.total, mine.chosen, `${label}: the offer's total`);
        assert.equal(offer.unsure, mine.unsure, `${label}: the offer's "?" count`);
      }
      const marked = o.examStepView(exams, applied, true);
      assert.deepEqual([marked.total, marked.unsure], [mine.chosen, mine.unsure], `${label}: marked`);
      // "לבדוק עכשיו" lists every exam the server could not place, answered or not (run 7)…
      const rows = drawnRows(exams, marked);
      const unsureKeys = raw.filter((e) => e.match.mine === null).map((e) => e.naturalKey).sort();
      assert.deepEqual(rows.map((r) => r.key).sort(), unsureKeys, `${label}: every unsure exam listed`);
      // …and its "?" rows are the ones nobody answered, as "המבחנים שלי" draws a "?", and as many as the line says.
      const open = rows.filter((r) => r.state === 'open').map((r) => r.key).sort();
      const drawn = exams.filter((e) => school.examStatus(e) === 'unsure').map((e) => e.naturalKey).sort();
      assert.deepEqual(open, drawn, `${label}: the same "?" as "המבחנים שלי"`);
      assert.equal(open.length, marked.unsure, `${label}: the line counts the "?" rows`);
    }
  }
});

test('W6-2: Noa\'s "שלי" moves one exam from "?" to the owner\'s; unconfirming moves it back', () => {
  const raw = reviewOptions();
  const first = o.examStepView(school.withConfirmed(raw, new Set()), [], false);
  assert.deepEqual([first.total, first.unsure, first.mine], [6, 3, 3]);
  const answered = school.withConfirmed(raw, new Set(['u2']));
  const after = o.examStepView(answered, [], false);
  assert.deepEqual([after.total, after.unsure, after.mine], [6, 2, 4]);
  assert.equal(o.examStepLine(after, raw.length), '6 מבחנים');
  assert.match(o.examStepLeaveLine(after.unsure), /^על 2 מבחנים /);
  const u2 = answered.find((e) => e.naturalKey === 'u2');
  assert.equal(o.isUnsureExam(u2), false);
  assert.equal(o.looksMine(u2), true);
  // Run 7: the row stays, reading "שלי ✓" — no longer a "?".
  assert.deepEqual(drawnRows(answered, after).find((r) => r.key === 'u2'), { key: 'u2', state: 'mine' });
  // Unconfirmed again ("לבטל" on the toast): the "?" and the count are back.
  const undone = school.withConfirmed(answered, new Set());
  assert.deepEqual(o.examStepView(undone, [], false), first);
  assert.deepEqual(drawnRows(undone, first).find((r) => r.key === 'u2'), { key: 'u2', state: 'open' });
  // "שלי" on an exam that was hidden: the recommendation shows it, like a matched one.
  assert.equal(o.applyExamRecommendation(school.withConfirmed(raw, new Set(['u1'])), ['u1']).includes('u1'), false);
  assert.equal(o.applyExamRecommendation(raw, ['u1']).includes('u1'), true);
  // The offer keeps an unsure exam hidden before the step; only "לא שלי" on the step hides it.
  assert.equal(o.examStepOffer(raw, ['u1']).includes('u1'), false);
  assert.equal(o.examStepOffer(raw, ['u1'], ['u1']).includes('u1'), true);
  // Only unsure exams can be confirmed: a not-mine one stays hidden by the recommendation.
  assert.equal(o.applyExamRecommendation(school.withConfirmed(raw, new Set(['n1'])), []).includes('n1'), true);
  // Confirmed exams alone are something to offer, as matched ones are.
  const unsureOnly = [exam('a', null, ''), exam('b', null, 'כימיה')];
  assert.equal(o.examStepView(unsureOnly, [], false).phase, 'none');
  assert.equal(o.examStepView(school.withConfirmed(unsureOnly, new Set(['a'])), [], false).phase, 'marked');
});

test('examStepView: the offer only until applied; already applied is marked; nothing recommended is "none"', () => {
  const exams = reviewOptions();
  const applied = o.applyExamRecommendation(exams, []);
  // Applied before this onboarding (a second run from Settings): the count, not an offer.
  assert.equal(o.examStepView(exams, applied, false).phase, 'marked');
  // "לא שלי" on an unsure exam during the offer: it leaves the number, and stays listed — as "הוסתר".
  const offer = o.examStepView(exams, [], false);
  const hidden = school.setExamsShown([], ['u1'], false);
  const notMine = o.examStepView(exams, hidden, false, ['u1']);
  assert.equal(notMine.phase, 'offer');
  assert.equal(notMine.total, offer.total - 1);
  assert.equal(notMine.unsure, offer.unsure - 1);
  assert.equal(notMine.total, myExamsLine(exams, o.examStepOffer(exams, hidden, ['u1'])).total);
  assert.deepEqual(drawnRows(exams, notMine).find((r) => r.key === 'u1'), { key: 'u1', state: 'hidden' });
  // The same exam hidden before the step, not on it: kept by the offer, with its "?".
  const before = o.examStepView(exams, hidden, false);
  assert.deepEqual([before.total, before.unsure], [offer.total, offer.unsure]);
  assert.deepEqual(drawnRows(exams, before).find((r) => r.key === 'u1'), { key: 'u1', state: 'open' });
  // No exam looks like the owner's: nothing to offer, and the count is what is marked now.
  const unsureOnly = [exam('a', null, ''), exam('b', false, 'כימיה'), exam('c', null, '')];
  for (const appliedHere of [false, true]) {
    const none = o.examStepView(unsureOnly, ['b'], appliedHere);
    assert.equal(none.phase, 'none');
    assert.deepEqual([none.total, none.unsure], [2, 2]);
  }
});

test('§14.9 the step counts a bagrut exam as the owner\'s, whatever the server\'s match', () => {
  const bagrut = { ...exam('bg', null, 'אנגלית'), subject: 'אנגלית ז׳ - G', kind: 'bagrut' };
  const notMine = { ...bagrut, naturalKey: 'bg2', match: { mine: false, reason: 'לא במערכת שלך' } };
  assert.equal(o.looksMine(bagrut), true);
  assert.equal(o.isUnsureExam(bagrut), false);
  // Marked by "המשך", even from hidden; never hidden by it.
  assert.deepEqual(o.applyExamRecommendation([bagrut, notMine], ['bg', 'bg2']), []);
  assert.deepEqual(o.examStepView([bagrut, notMine], [], false), { phase: 'marked', total: 2, unsure: 0, mine: 0, hidden: [] });
  assert.deepEqual(o.examStepOffer([bagrut, notMine], ['bg', 'bg2']), []);
  assert.deepEqual(o.examStepUnsure([bagrut, notMine]), []);
});

// --- §14.7: block exams grouped as "המבחנים שלי" groups them ------------------------

test('§14.7 examStepUnsure: "גוש ב׳" is one group with or without its subjects, as in "המבחנים שלי" (Noa)', () => {
  const exams = [
    exam('1', true, 'פיזיקה', null, '2026-10-20'),
    { ...exam('2', null, 'גוש ב׳: פיזיקה, ביולוגיה', null, '2026-11-04'), subject: "מבחן גוש ב'" },
    { ...exam('3', null, '', null, '2026-12-16'), subject: "גוש ב'" },
    { ...exam('4', null, '', null, '2027-02-03'), subject: "מבחן גוש ב'" },
    { ...exam('5', null, '', null, '2026-11-15'), subject: "מבחן גוש א'" },
    { ...exam('6', null, 'אנגלית', null, '2026-11-01'), subject: 'מתכונת באנגלית וויקה' },
    { ...exam('7', null, '', null, '2026-12-03'), subject: "מועד ב'" },
    exam('8', false, 'כימיה', 'לא במערכת שלך', '2026-10-21'),
  ];
  const groups = o.examStepUnsure(exams);
  assert.deepEqual(groups.map((g) => [g.key, g.exams.map((e) => e.naturalKey)]), [
    ['אנגלית', ['6']],
    ['גוש ב׳', ['2', '3', '4']],
    ['גוש א׳', ['5']],
    ['אחר', ['7']],
  ]);
  // The same groups, by the same function, as "המבחנים שלי" shows these exams.
  const myExams = school.groupExamsBySubject(exams).map((g) => [g.key, g.exams.filter(school.isUnsure).map((e) => e.naturalKey)])
    .filter(([, keys]) => keys.length > 0);
  assert.deepEqual(groups.map((g) => [g.key, g.exams.map((e) => e.naturalKey)]), myExams);
  assert.equal(groups.some((g) => g.key === 'מבחני גוש'), false);
});

// --- Wave 4: the footer stays under the toast (Daniel) -----------------------------

/** Toast.tsx for its pure `toastBottom`, React Native and safe-area stubbed (as toast.test.cjs does). */
function loadToast() {
  const file = path.join(__dirname, '../src/components/Toast.tsx');
  const loadAny = (f) => {
    const { code } = transformFileSync(f, {
      configFile: false, babelrc: false,
      presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
      plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'],
    });
    const module = { exports: {} };
    const stubs = {
      'react-native': { StyleSheet: { create: (s) => s, absoluteFill: {} } },
      'react-native-safe-area-context': {},
      './ui': { MIN_TOUCH: 44, usePalette: () => ({}) },
    };
    const req = (spec) => {
      if (spec in stubs) return stubs[spec];
      if (spec.startsWith('.')) return loadAny(`${path.resolve(path.dirname(f), spec)}.ts`);
      return require(spec);
    };
    new Function('module', 'exports', 'require', code)(module, module.exports, req);
    return module.exports;
  };
  return loadAny(file);
}

test('the onboarding footer fits under the toast at every inset and font scale, dots included', () => {
  const toast = loadToast();
  const MIN_TOUCH = 44;
  for (const inset of [0, 24, 48, 80]) {
    // A button row at the phone's font scale, with the in-app "גדול מאוד" on top (1.3): 14pt text, 11pt padding.
    for (const fontScale of [1, 1.3, 2]) {
      const row = Math.max(MIN_TOUCH, 22 + Math.ceil(14 * fontScale * 1.3 * 1.4));
      const line = toast.toastBottom(inset, fontScale);
      assert.ok(o.footerHeight(row, inset) <= line, `inset ${inset}, scale ${fontScale}: ${o.footerHeight(row, inset)} > ${line}`);
      assert.equal(o.stepDotsFit(row, inset, line), true);
    }
  }
  // The old footer — two rows of buttons and 44-point dots — reached into the toast.
  const old = 12 + MIN_TOUCH + 8 + MIN_TOUCH + 8 + MIN_TOUCH + 20;
  assert.ok(old > toast.toastBottom(0, 1));
  // A row too tall for the dots (very large fonts): they give way, the buttons stay.
  assert.equal(o.stepDotsFit(200, 0, toast.toastBottom(0, 1)), false);
  assert.ok(o.footerHeight(100, 0, false) <= toast.toastBottom(0, 1));
});

// --- R-25: the counts' words ---------------------------------------------------

test('settings counts: subjects (not lessons), exams marked as "המבחנים שלי" counts them, calendars explained', () => {
  assert.equal(o.subjectsShownLabel(10), '10 מקצועות שלך מוצגים');
  assert.equal(o.subjectsShownLabel(1), 'מקצוע אחד שלך מוצג');
  assert.equal(o.subjectsShownLabel(0), 'אף מקצוע לא מוצג');
  assert.doesNotMatch(o.subjectsShownLabel(10), /שיעור/);
  assert.equal(o.calendarsShownLabel(7), '7 יומנים מוצגים');
  assert.equal(o.calendarsShownLabel(1), 'יומן אחד מוצג');
  assert.equal(o.calendarsShownLabel(0), 'אף יומן לא מוצג');
  assert.equal(o.CALENDARS_HINT, 'יומנים מחשבון ה־Google שלך (אישי, משפחה, חוגים…)');
  assert.equal(o.examsMarkedLabel(15), '15 מבחנים מסומנים כשלך');

  const counts = o.settingsCounts({
    // Two published names for one subject and teacher are one row, as in "השיעורים שלי" (run 5).
    subjects: [
      { key: 'a', name: 'אזרחות', teacher: 'אבי לוי', inMashov: true, count: 4 },
      { key: 'a2', name: 'אזרחות (יב2)', teacher: 'אבי לוי', inMashov: true, count: 6 },
      { key: 'b', name: 'היסטוריה', teacher: 'נועם דרור', inMashov: true, count: 4 },
      { key: 'c', name: 'מתמטיקה', teacher: 'רון', inMashov: true, count: 5 },
    ],
    exams: [{ naturalKey: 'x' }, { naturalKey: 'y' }],
    calendars: [
      { id: 'me' }, { id: 'family' }, { id: 'hidden' },
      { id: 'school', isSchoolCalendar: true }, { id: 'grade', isExamCalendar: true },
    ],
    settings: {
      lessons: { hiddenSubjects: ['b'] },
      exams: { hiddenKeys: ['y', 'gone'] },
      calendars: { hiddenCalendarIds: ['hidden'] },
    },
  });
  assert.deepEqual(counts, { subjects: 2, exams: 1, calendars: 2 });
});

// --- R-26: appearance -----------------------------------------------------------

test('W5-12: the text-size sample is calm — no exam, no change, nothing to take for real news', () => {
  assert.equal(o.TEXT_SIZE_SAMPLE, 'מחר יום ראשון');
  assert.doesNotMatch(o.TEXT_SIZE_SAMPLE, /מבחן|בוטל|שינוי|להגיש|בגרות/);
});

test('W5-14: the welcome sentence counts no steps against "שלב 1 מתוך 5"; the class sentence explains "מגמה"', () => {
  const COUNTED_STEPS = /(\d+|שניים|שני|שלושה|שלושת|ארבעה|ארבעת|חמישה|חמשת|שישה)\s+(צעדים|שלבים)/;
  assert.doesNotMatch(o.WELCOME_LEAD, COUNTED_STEPS);
  // What the app gives, in a student's words (Wave 9 re-rate).
  assert.equal(o.WELCOME_LEAD, 'מה יש מחר, מה בוטל ומה צריך להגיש, בלי להיכנס למשוב.');
  // Maya did not know "מגמה": the step explains it in "השיעורים שלי"'s words (U3's termExplainer).
  assert.match(o.CLASS_LEAD, /מגמה/);
  assert.equal(school.termExplainer(o.CLASS_LEAD), school.MAJOR_EXPLAINER);
  // Itai did not read a hint and a paragraph saying the same: one line now.
  assert.match(o.QUIET_HOURS_HINT, /סיכום הבוקר יגיע בכל מקרה/);
  for (const line of [o.WELCOME_LEAD, o.CLASS_LEAD, o.QUIET_HOURS_HINT]) {
    assert.equal(line.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length, 1, `${line}: one sentence`);
    assert.doesNotMatch(line, /סשן|שרת|סנכרון|הוחל|יפוג|נקרא/);
  }
});

test('THEME_LABELS: a Hebrew label for each preference; the text-size note names the phone, not widgets', () => {
  assert.deepEqual(['light', 'dark', 'system'].map((k) => o.THEME_LABELS[k]), ['בהיר', 'כהה', 'לפי הטלפון']);
  // W4-2: the app has its own size now, and the phone's still applies on top of it.
  assert.match(o.TEXT_SIZE_NOTE, /^גם גודל הגופן שבהגדרות הטלפון חל כאן/);
  assert.doesNotMatch(o.TEXT_SIZE_NOTE, /וידג/);
});

test('TEXT_SCALE_ORDER: every in-app text size once, smallest first, each with its label', () => {
  const theme = load('../theme.ts');
  assert.deepEqual([...o.TEXT_SCALE_ORDER], ['normal', 'large', 'xlarge']);
  assert.deepEqual(o.TEXT_SCALE_ORDER.map((k) => theme.TEXT_SCALE_LABELS[k]), ['רגיל', 'גדול', 'גדול מאוד']);
  assert.deepEqual(new Set(o.TEXT_SCALE_ORDER), new Set(Object.keys(theme.TEXT_SCALES)));
  const factors = o.TEXT_SCALE_ORDER.map((k) => theme.TEXT_SCALES[k]);
  assert.deepEqual([...factors].sort((a, b) => a - b), factors);
});

test('NOTIFICATION_SWITCH_LABELS: the evening reminder does not promise "מחר" (it looks at the next school day)', () => {
  for (const label of Object.values(o.NOTIFICATION_SWITCH_LABELS)) {
    assert.doesNotMatch(label, /מחר|סנכרון|שרת|סשן/);
  }
  assert.match(o.NOTIFICATION_SWITCH_LABELS.evening_homework, /^תזכורת ערב/);
});

// ── Parents mode (docs/parents-plan.md) ─────────────────────────────────────

test('onboardingSteps: a parent connects Mashov first, and the class step shows the children it brought', () => {
  assert.deepEqual([...o.onboardingSteps('parent')], ['welcome', 'connect', 'class', 'exams', 'notifications']);
  assert.deepEqual([...o.onboardingSteps('student')], ['welcome', 'connect', 'class', 'exams', 'notifications']);
  assert.equal(o.stepForward('welcome', 'parent'), 'connect');
  assert.equal(o.stepForward('connect', 'parent'), 'class');
  assert.equal(o.stepForward('class', 'parent'), 'exams');
  assert.equal(o.stepBack('exams', 'parent'), 'class');
  assert.equal(o.stepBack('class', 'parent'), 'connect');
  assert.equal(o.stepBack('connect', 'parent'), 'welcome');
  assert.equal(o.stepForward('welcome', 'student'), 'connect');
  assert.equal(o.stepForward('notifications', 'parent'), null);
  assert.equal(o.stepBack('welcome', 'parent'), null);
  assert.equal(o.stepLabel('connect', 'parent'), 'שלב 2 מתוך 5');
  assert.equal(o.stepLabel('class', 'parent'), 'שלב 3 מתוך 5');
  assert.equal(o.stepLabel('class', 'student'), 'שלב 3 מתוך 5');
  // Walked forward and back, a parent's steps come out in their own order.
  const walked = [];
  for (let s = 'welcome'; s; s = o.stepForward(s, 'parent')) walked.push(s);
  assert.deepEqual(walked, [...o.onboardingSteps('parent')]);
  for (const s of o.onboardingSteps('parent').slice(0, -1)) assert.equal(o.stepBack(o.stepForward(s, 'parent'), 'parent'), s);
  // The parent's line on the welcome step says the children come from Mashov, not from a class picked first.
  assert.match(o.AUDIENCE_COPY.parentLine, /משוב/);
  assert.doesNotMatch(o.AUDIENCE_COPY.parentLine, /בהגדרות|אחרי הכיתה/);
});

test('classStepPage: a parent with no list gets the invite and the address, never Mashov', () => {
  assert.equal(o.classStepPage(0, false, undefined, 'parent'), 'parent');
  assert.equal(o.classStepPage(0, true, { from: 'none' }, 'parent'), 'parent');
  assert.equal(o.classStepPage(12, false, { from: 'pasted' }, 'parent'), 'list');
  assert.equal(o.classStepPage(0, false, undefined, 'student'), 'connect');
});

test('classStepPage: a parent whose Mashov brought children sees them', () => {
  assert.equal(o.classStepPage(0, true, undefined, 'parent', 2), 'children');
  assert.equal(o.classStepPage(5, true, undefined, 'parent', 1), 'children');
  // Before any other rule, whether or not a site or a class list is known.
  assert.equal(o.classStepPage(0, false, { from: 'none' }, 'parent', 1), 'children');
  // Without children from Mashov: the old results.
  assert.equal(o.classStepPage(0, true, undefined, 'parent', 0), 'parent');
  assert.equal(o.classStepPage(5, true, undefined, 'parent', 0), 'list');
  assert.equal(o.classStepPage(0, true, { from: 'none' }, 'parent'), 'parent');
  // Only a parent's phone has the page.
  assert.equal(o.classStepPage(0, true, { from: 'none' }, 'student', 2), 'site');
  assert.equal(o.classStepPage(5, true, undefined, 'student', 2), 'list');
});

test('tabGuide and todayTabTitle: a parent has the class\'s day, its week and its school', () => {
  assert.deepEqual(o.tabGuide('parent').map((t) => t.title), ['היום בכיתה', 'שבוע', 'בית ספר']);
  assert.equal(o.tabGuide('student').length, 5);
  assert.equal(o.todayTabTitle('parent'), 'היום בכיתה');
  assert.equal(o.todayTabTitle('student'), 'היום שלי');
});

test('AUDIENCE_COPY and INVITE_COPY keep the copy rules', () => {
  // switchBody takes the current class's name; classGone takes `parent`, and a student's phone is the one the rules are about.
  const invite = Object.entries(o.INVITE_COPY).map(([k, v]) => (typeof v !== 'function' ? v : k === 'classGone' ? v(false) : v('י״א 2')));
  const site = Object.values(o.SCHOOL_SITE_COPY).map((v) => (typeof v === 'function' ? v(false) : v));
  for (const line of [...Object.values(o.AUDIENCE_COPY), ...invite, ...site]) {
    assert.doesNotMatch(line, /·| — /);
  }
});

test('a row without a site reads the same in onboarding and in Settings', () => {
  assert.equal(o.SCHOOL_SITE_COPY.withoutRow, o.AUDIENCE_COPY.withoutSite);
});

test("a student's invite is about the people and their timetable, never a class to join", () => {
  const c = o.INVITE_COPY;
  for (const line of [c.row, c.rowHint, c.joining, c.joinedYours, c.already, c.demo, c.switchTitle, c.switchBody('י״א 2'), c.parentRowHint, c.classGone(false)]) {
    assert.doesNotMatch(line, /לכיתה|הכיתה|להצטרף|מצטרפים/);
  }
  assert.equal(c.row, 'לשלוח את סדר יום לחברים');
  assert.equal(c.rowHint, 'למי שעוד אין לו: הקישור פותח אצלו את סדר יום מוכנה');
});

test('the lines that point into Settings name the page the setting is on, "אני והילדים" on a parent\'s phone', () => {
  assert.match(o.INVITE_COPY.classGone(true), /אני והילדים/);
  assert.match(o.INVITE_COPY.classGone(false), /אני ובית הספר/);
  assert.match(o.SCHOOL_SITE_COPY.noSiteToFollow(true), /אני והילדים/);
  assert.match(o.SCHOOL_SITE_COPY.noSiteToFollow(false), /אני ובית הספר/);
  // The invite lives on the friends screen, not in Settings.
  assert.match(o.AUDIENCE_COPY.classLead, /במסך החברים, ב״להזמין הורה״/);
  assert.doesNotMatch(o.AUDIENCE_COPY.classLead, /בהגדרות/);
  // The class step's list of the children Mashov brought points into Settings by the parent's page.
  assert.match(o.AUDIENCE_COPY.childrenLead, /אני והילדים/);
  for (const line of [o.AUDIENCE_COPY.childrenTitle, o.AUDIENCE_COPY.childrenLead, o.AUDIENCE_COPY.noneFromMashov]) assert.doesNotMatch(line, /להצטרף|לכיתה/);
});
