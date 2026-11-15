const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The exam board's flow, where it cannot be run without a phone: what must stay true of how its two components are
 * built, read from their source. (What they decide is tested in server/test/exam-board-app.test.ts.)
 *
 * - One Modal for the whole flow after a link or a file is read. On iOS a Modal mounted while another is still being
 *   dismissed is not presented, and the student is left with a flow that has nothing on screen; the steps (which
 *   calendar, which column, the confirm screen) are therefore the title and the body of ONE sheet.
 * - The file picker is busy from the moment it opens: a second tap opened a second picker, which fails, and a file that
 *   was fine was reported as unreadable.
 * - A read of a link or a file puts the keyboard away first, so that it is not up under the sheet that opens after the wait.
 */
const components = path.join(__dirname, '..', 'src', 'components');
const board = fs.readFileSync(path.join(components, 'ExamBoard.tsx'), 'utf8');
const confirm = fs.readFileSync(path.join(components, 'ExamBoardConfirm.tsx'), 'utf8');

/** The source of the function that starts at `signature`, up to the first line that closes it at the same indent. */
function bodyOf(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} is there`);
  const indent = /^ */.exec(source.slice(source.lastIndexOf('\n', start) + 1))[0];
  const end = source.indexOf(`\n${indent}};\n`, start);
  assert.ok(end > start, `${signature} ends`);
  return source.slice(start, end);
}

test('the flow after a read is one sheet: ExamBoardConfirm mounts one Sheet, and ExamBoard none', () => {
  assert.equal((confirm.match(/<Sheet\b/g) ?? []).length, 1);
  assert.equal((board.match(/<Sheet\b/g) ?? []).length, 0);
  assert.doesNotMatch(board, /import[^;]*\bSheet\b[^;]*from/);
});

test('the sheet is mounted once per flow, and the steps are not a Modal each', () => {
  // ExamBoard opens it for a flow and keys it by that flow; the steps live in the one component's state.
  assert.match(board, /<ExamBoardConfirm\s[^>]*key=\{flow\.id\}/);
  assert.match(confirm, /useState<BoardStep>\(first\)/);
  assert.doesNotMatch(confirm, /<Modal\b/);
});

test('the file picker is busy before it opens, and a cancelled pick leaves no sentence behind', () => {
  const choose = bodyOf(board, 'const chooseFile = async');
  const busy = choose.indexOf("setBusy('pick')");
  const opens = choose.indexOf('await pickBoardFile()');
  assert.ok(busy >= 0 && opens >= 0 && busy < opens, 'busy is set before the picker opens');
  // After a cancel, busy is released and the problem is cleared.
  const cancelled = choose.slice(choose.indexOf('picked === null'));
  assert.match(cancelled.slice(0, cancelled.indexOf('return;')), /setBusy\(null\)[\s\S]*setProblem\(null\)/);
});

test('every control of the form is off while the picker is open or the file is read', () => {
  assert.match(board, /editable=\{busy === null\}/);
  assert.match(board, /title="לבדוק" disabled=\{busy !== null/);
  assert.match(board, /title="לבחור קובץ אקסל"[^>]*disabled=\{busy !== null\}/);
});

test('a read puts the keyboard away before it asks the server', () => {
  const preview = bodyOf(board, 'const runPreview = async');
  const keyboard = preview.indexOf('Keyboard.dismiss()');
  const asks = preview.indexOf('await previewExamBoard');
  assert.ok(keyboard >= 0 && asks >= 0 && keyboard < asks);
});

// ---- the phone's own board ("רק אצלי"): what must stay true of how it is wired ---------------------------------------------
//
// - It stays on the phone: nothing the block does with it asks the server (reading a public Google calendar is the one
//   request, from the phone to Google).
// - Whatever changes it changes everything that is made of the exams, once: the lists, the widget, the summaries and the
//   Google mirror (`afterOwnBoard`).
// - The demo keeps nothing.
const hooks = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'hooks.ts'), 'utf8');
const screens = path.join(__dirname, '..', 'src', 'screens');
const myExams = fs.readFileSync(path.join(screens, 'MyExamsScreen.tsx'), 'utf8');
const onboarding = fs.readFileSync(path.join(screens, 'OnboardingScreen.tsx'), 'utf8');

/** The source of the top-level function declaration that starts at `signature`, up to the line that closes it. */
function declarationOf(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} is there`);
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, `${signature} ends`);
  return source.slice(start, end);
}

test('both screens that hold the block read the phone\'s own board once and hand it to the block', () => {
  for (const [name, source] of [['MyExamsScreen', myExams], ['OnboardingScreen', onboarding]]) {
    assert.match(source, /const ownBoard = useOwnBoard\(\);/, name);
    assert.match(source, /<ExamBoard\b[^>]*\bown=\{ownBoard\}/, name);
  }
});

test('the sheet is given the save that stays on the phone, and neither it nor the block\'s own changes ask the server', () => {
  assert.match(board, /<ExamBoardConfirm\s[\s\S]*?onSaveOwn=\{saveOwn\}/);
  const saveOwn = bodyOf(board, 'const saveOwn = async');
  const changeOwn = bodyOf(board, 'const changeOwn =');
  for (const [name, code] of [['saveOwn', saveOwn], ['changeOwn', changeOwn]]) {
    assert.doesNotMatch(code, /saveExamBoard|setExamCalendar|previewExamBoard|refreshFeed|fetch\(/, name);
  }
  // The class is read again after a save for the class only: `done` returns before it for a board kept on the phone.
  const done = bodyOf(board, 'const done = (');
  assert.ok(done.indexOf("saved === 'own'") >= 0 && done.indexOf("saved === 'own'") < done.indexOf('settle('));
});

test('the actions that keep a board on the phone use no call of the device module', () => {
  const actions = hooks.slice(hooks.indexOf('export function useOwnBoardActions'));
  const end = actions.indexOf('\n}\n');
  assert.ok(end > 0);
  assert.doesNotMatch(actions.slice(0, end), /saveExamBoard|setExamCalendar|previewExamBoard|refreshFeed|followClass/);
});

test('a change that stays on the phone keeps nothing in the demo, and checks before it writes', () => {
  const change = bodyOf(board, 'const changeOwn =');
  const demo = change.indexOf('isDemo()');
  const write = change.indexOf('change();');
  assert.ok(demo >= 0 && write > demo, 'the demo is asked before the write');
  assert.match(change.slice(demo, write), /DEMO_COPY\.notSaved/);
});

test('every change to the phone\'s own board tells the lists, the widget, the summaries and the Google mirror', () => {
  const after = declarationOf(hooks, 'function afterOwnBoard');
  assert.match(after, /qc\.setQueryData\(keys\.ownBoard, board\)/);
  assert.match(after, /markMirrorDue\(storage\)/);
  assert.match(after, /afterManualExams\(qc\)/);
  // What `afterManualExams` does: the summaries, every list of exams and the days made of them, the widget.
  const manual = declarationOf(hooks, 'function afterManualExams');
  assert.match(manual, /afterPhoneDaysChange\(\)/);
  assert.match(manual, /keys\.settings, keys\.school, \['day'\], \['week'\], \['agenda'\]/);
  assert.match(manual, /refreshWidgetSoon\(\)/);
  // And each of the four ways to change the board ends there.
  const actions = hooks.slice(hooks.indexOf('export function useOwnBoardActions'));
  const body = actions.slice(0, actions.indexOf('\n}\n'));
  assert.equal((body.match(/afterOwnBoard\(qc, /g) ?? []).length, 4);
});

test('a board that could not be written is an OwnBoardError, and a calendar whose first read fails is not kept (A-I2)', () => {
  assert.match(declarationOf(hooks, 'function kept'), /catch \{\s*throw new OwnBoardError\(\);/);
  const from = hooks.indexOf('keepCalendar: async');
  const calendar = hooks.slice(from, hooks.indexOf('hideClassBoard: () =>', from));
  // Kept and read at once by `keepOwnCalendarRead`, which puts the board before back when the first read fails and
  // throws `OwnCalendarUnreadError`: that goes on to the sheet as it is; anything else the phone threw is an OwnBoardError.
  assert.match(calendar, /await keepOwnCalendarRead\(/);
  assert.match(calendar, /if \(err instanceof OwnCalendarUnreadError\) throw err;\s*throw new OwnBoardError\(\);/);
  assert.doesNotMatch(calendar, /readFailed/);
  // The block's own save waits for it, so a failure leaves the sheet open, and its toast says one thing.
  const saveOwn = bodyOf(board, 'const saveOwn = async');
  assert.match(saveOwn, /await ownActions\.keepCalendar\(/);
  assert.doesNotMatch(board, /readFailed|savedOwnToast/);
  assert.match(bodyOf(board, 'const done = ('), /toast\.show\(ownSavedToast\(\)\)/);
});

test('the own board is read again when a screen mounts and when the settings are saved (a new class drops it)', () => {
  const read = declarationOf(hooks, 'export function useOwnBoard');
  assert.match(read, /refetchOnMount: 'always'/);
  const settingsSaved = declarationOf(hooks, 'function afterSettingsChange');
  assert.match(settingsSaved, /invalidateQueries\(\{ queryKey: keys\.ownBoard \}\)/);
});

// ---- a save for the class by someone who holds a board of their own ---------------------------------------------------------
//
// The own board hides the class's board on the person's phone, so a class save ends it (after the save went through),
// and the sheet and the toast say so. What decides it is tested in server/test/exam-board-app.test.ts.

test('the own board is removed only once the class feed was read again after the save, by `afterClassSave` (A-I4)', () => {
  // What it does in what order is `afterClassSave`'s, tested in server/test/exam-board-app.test.ts; here, that the block uses it.
  const done = bodyOf(board, 'const done = (');
  const own = done.indexOf("if (saved === 'own') {");
  const settles = done.indexOf('settle(device?.class ?? null, own)');
  assert.ok(own >= 0 && settles > own, 'a board kept on the phone returns first; a class save settles, told the own board as it was (R1)');
  assert.doesNotMatch(done, /ownActions\.removeOwn\(\)|classSavedToast\(/);
  const settle = bodyOf(board, 'const settle = async');
  assert.match(settle, /await afterClassSave\(ownBefore, \{/);
  assert.match(settle, /readFeed: \(\) => readClassAgain\(answer\),/);
  assert.match(settle, /removeOwn: ownActions\.removeOwn,/);
  assert.match(settle, /toast: toast\.show,/);
  assert.ok(settle.indexOf('invalidateQueries') > settle.indexOf('await afterClassSave('), 'every query is read again after');
  assert.match(bodyOf(board, 'const readClassAgain = async'), /await refreshFeed\(storage\)\.catch\(\(\) => null\);[\s\S]*return fresh !== null;/);
  // a removal says its own toast, and only reads the class again
  assert.match(bodyOf(board, 'const remove = async'), /void readClassAgain\(device\.class\)\.then\(\(\) => qc\.invalidateQueries\(\)\);/);
});

test('a removal the lock refused says the board was replaced, closes its question and reads the class again (R2)', () => {
  const remove = bodyOf(board, 'const remove = async');
  const caught = remove.slice(remove.indexOf('} catch (err) {'));
  assert.match(caught, /const failed = removalFailed\(err, mePage\(\)\);\s*setProblem\(failed\.problem\);/);
  assert.match(caught, /if \(failed\.readAgain\) \{\s*setAsking\(null\);\s*void readClassAgain\(null\)\.then\(\(\) => qc\.invalidateQueries\(\)\);\s*\}/);
  // the refused save's sentence is not the removal's
  assert.doesNotMatch(caught, /boardProblem\(/);
});

test('the block reads the class again whenever the settings are read again (A-I3)', () => {
  assert.match(board, /const settings = useSettings\(\);/);
  assert.match(board, /useMemo\(\(\) => storedFeed\(storage\)\?\.class \?\? null, \[version, settings\.dataUpdatedAt\]\)/);
});

test('a class save the lock refused becomes one for the person alone in the sheet, by `saveFailed` (A-I3), and the sheet keeps that the class has a board (V-8)', () => {
  const save = bodyOf(confirm, 'const save = async');
  assert.match(
    save,
    /const failed = saveFailed\(selection, err, mePage\(\)\);\s*setSelection\(failed\.selection\);\s*setProblem\(\{ text: failed\.problem, refusal: failed\.refused \}\);\s*if \(failed\.refused\) setRefused\(true\);/,
  );
  // and nothing takes it back while the sheet is open
  assert.equal((confirm.match(/setRefused\(/g) ?? []).length, 1);
});

test('the footer is `confirmFooter`\'s: the chips, the target line and the problem each only when it says so (V-8)', () => {
  assert.match(confirm, /const facts = \{ target: selection\.target, choice: target\.choice, classHasBoard, holdsOwn: holdsOwnBoard, refused, problem \};\s*const shown = confirmFooter\(facts\);/);
  assert.match(confirm, /\{shown\.chips \? \(\s*<View accessibilityRole="radiogroup"/);
  assert.match(confirm, /: shown\.targetLine \? <Text style=\{line\}>\{shown\.targetLine\}<\/Text> : null\}/);
  assert.match(confirm, /\{shown\.problem \? <Text accessibilityRole="alert"[^>]*>\{shown\.problem\}<\/Text> : null\}/);
  assert.doesNotMatch(confirm, /\{target\.choice \? \(/);
});

test('while the two places are offered, the footer keeps room for the longer line, and only the one that is true is read (V-17)', () => {
  assert.match(confirm, /const spare = spareTargetLine\(facts\);/);
  // the line said, then the other one beside it, out of view and out of the screen reader's way
  assert.match(
    confirm,
    /\{shown\.targetLine && spare \? \([\s\S]*?<View style=\{styles\.reserve\}>\s*<Text style=\{\[line, styles\.reserveLine\]\}>\{shown\.targetLine\}<\/Text>\s*<View style=\{styles\.reserveLine\} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">\s*<Text style=\{\[line, styles\.spare\]\}>\{spare\}<\/Text>/,
  );
  const styles = confirm.slice(confirm.indexOf('const styles = StyleSheet.create('));
  assert.match(styles, /reserve: \{ flexDirection: 'row', overflow: 'hidden' \},/);
  assert.match(styles, /reserveLine: \{ width: '100%', flexShrink: 0 \},/);
  assert.match(styles, /spare: \{ opacity: 0 \},/);
});

test('every handler that changes the selection takes the problem away; opening a calendar does not (V-8)', () => {
  for (const name of ['toggle', 'pickRowDate', 'resetRowDate', 'pickSkippedDate', 'clearSkipped', 'clearAll', 'markAllExams']) {
    const start = confirm.indexOf(`const ${name} = useCallback(`);
    assert.ok(start >= 0, name);
    const body = confirm.slice(start, confirm.indexOf('}, [', start));
    assert.match(body, /setProblem\(null\);/, name);
  }
  assert.doesNotMatch(confirm.slice(confirm.indexOf('const openDate = useCallback('), confirm.indexOf('const closeDate = useCallback(')), /setProblem/);
});

test('a calendar opened under a row is scrolled into view above the footer once it is laid out, by `revealOffset` (V-3)', () => {
  // The picker tells the list on its first layout only, and both measured views are kept (not flattened on Android).
  const picker = declarationOf(confirm, 'function DatePicker(');
  assert.match(picker, /<View ref=\{self\} collapsable=\{false\} style=\{styles\.picker\} onLayout=\{laidOut\}>/);
  assert.match(picker, /if \(shown\.current \|\| !self\.current\) return;\s*shown\.current = true;\s*onShown\(self\.current\);/);
  assert.match(confirm, /<View ref=\{frameRef\} collapsable=\{false\} style=\{styles\.list\}/);
  // The list measures both in the window, asks the pure function, and scrolls only when it says to.
  const list = declarationOf(confirm, 'function RowsList(');
  assert.match(list, /const reveal = useCallback\(\(picker: View\) => \{[\s\S]*?frameRef\.current\?\.measureInWindow\([\s\S]*?picker\.measureInWindow\([\s\S]*?revealOffset\([\s\S]*?scrolled\.current, space\.sm\);\s*revealed\.current = to === null \? null : \{ before: scrolled\.current, to \};\s*if \(to !== null\) listRef\.current\?\.scrollToOffset\(\{ offset: to, animated: true \}\);[\s\S]*?\}, \[\]\);/);
  assert.match(list, /onScroll=\{onScroll\}\s*scrollEventThrottle=\{16\}/);
  // Both kinds of row hand the list's one stable callback to their calendar, so a row that did not change is not drawn again.
  assert.equal((list.match(/onShown=\{reveal\}/g) ?? []).length, 2);
  assert.equal((confirm.match(/onShown=\{onShown\}/g) ?? []).length, 2);
});

test('a calendar that closes puts the list back where it was before it opened, by `closeOffset` (V-17)', () => {
  const list = declarationOf(confirm, 'function RowsList(');
  const effect = list.slice(list.indexOf('const lastOpen = useRef(openKey);'), list.indexOf('}, [openKey]);'));
  assert.ok(effect.length > 0, 'the effect on the open calendar is there');
  // only when the calendar closes, and only as far as the pure function says
  assert.match(effect, /if \(openKey === null\) \{\s*const back = closeOffset\(revealed\.current\?\.before \?\? null, revealed\.current\?\.to \?\? null, scrolled\.current\);\s*if \(back !== null\) listRef\.current\?\.scrollToOffset\(\{ offset: back, animated: true \}\);/);
  // what one calendar's opening scrolled is never put back for another
  assert.match(effect, /revealed\.current = null;\s*lastOpen\.current = openKey;/);
});

test('the way back from the check step goes to the choice as it was, and asks the server nothing it has asked (V-13)', () => {
  // shown on the check step only, in the choice's own words, and off while a save or a read is under way, and while a
  // question is asked (round 4)
  assert.match(confirm, /const backTitle = choice \? backLabel\(back\) : null;/);
  assert.match(confirm, /<Button title=\{backTitle\} variant="ghost" disabled=\{busy \|\| asking !== null\} onPress=\{goBack\} \/>/);
  const leave = bodyOf(confirm, 'const backToChoice = (');
  assert.match(leave, /if \(back === null \|\| saving \|\| checking\) return;/);
  assert.match(leave, /setAsking\(null\);/);
  assert.match(leave, /setStep\(back\);/);
  assert.doesNotMatch(leave, /previewExamBoard|setRefused|setSelection/);
  // the check step remembers the choice it came through, and starts where the board can go: the person alone after a refusal
  const enter = bodyOf(confirm, 'const enterConfirm = (');
  assert.match(enter, /initialSelection\(nextRows, nextSkipped, startTarget\(target\.target, refused\), todayStr\(\)\)/);
  assert.match(enter, /setBack\(from\);/);
  assert.match(confirm, /enterConfirm\(\{ kind: 'calendar', calendar \}, step\)/);
  // a column read once is not read again
  const pick = bodyOf(confirm, 'const pickColumn = async');
  assert.ok(pick.indexOf('columnReads.current.get(column)') >= 0);
  assert.ok(pick.indexOf('columnReads.current.get(column)') < pick.indexOf('await previewExamBoard('));
  assert.match(pick, /columnReads\.current\.set\(column, next\);/);
});

test('the way back asks before it drops what was changed, by the rule closing goes by, and goes at once when nothing was (round 4)', () => {
  // the same `changed` and the same rule as closing; the question is the way back's own
  const goBack = bodyOf(confirm, 'const goBack = (');
  assert.match(goBack, /if \(back === null \|\| asking !== null\) return;/);
  assert.match(goBack, /const action = closeAction\(changed, busy\);\s*if \(action === 'ask'\) setAsking\('back'\);\s*else if \(action === 'close'\) backToChoice\(\);/);
  assert.match(bodyOf(confirm, 'const requestClose = ('), /if \(action === 'ask'\) setAsking\('close'\);/);
  // one footer for both questions, in `leaveQuestion`'s words, its yes leaving the way that was asked about
  assert.match(confirm, /const question = choice && asking \? leaveQuestion\(asking\) : null;/);
  assert.match(confirm, /<Button title=\{question\.confirm\} variant="danger" onPress=\{asking === 'back' \? backToChoice : onClose\} \/>\s*<Button title="להמשיך לערוך" variant="ghost" onPress=\{\(\) => setAsking\(null\)\} \/>/);
  // nothing on the list can be touched while either is asked
  assert.match(confirm, /locked=\{saving \|\| asking !== null\}/);
});

test('the picked file\'s name shows while it is read and on every step of the sheet, on one line, isolated (V-18)', () => {
  assert.match(bodyOf(board, 'const runPreview = async'), /setReadingFile\(boardSourceName\(source\)\);/);
  assert.match(board, /\{checking \? <Checking file=\{readingFile\} \/> : null\}/);
  const checking = declarationOf(confirm, 'export function Checking(');
  assert.match(checking, /<Text numberOfLines=\{1\} ellipsizeMode="middle"[^>]*>\s*\{fileNameLine\(file\)\}/);
  assert.match(confirm, /const fileName = boardSourceName\(source\);/);
  assert.match(confirm, /<Text numberOfLines=\{1\} ellipsizeMode="middle"[^>]*>\s*\{fileNameLine\(fileName\)\}/);
  assert.match(confirm, /subheader=\{subheader\}/);
});

test('the bulk tick and the line over a board of past exams are the rows\' own (round 3)', () => {
  const list = declarationOf(confirm, 'function RowsList(');
  // by the dates the person corrected, as the bulk tick and the save go by (round 4)
  assert.match(list, /const head = useMemo\(\(\) => \(\{ mark: markExamsLabel\(rows, dates, todayStr\(\)\), allPast: pastExamsLine\(rows, dates, todayStr\(\)\) \}\), \[rows, dates\]\);/);
  assert.match(list, /<Button title=\{head\.mark\} variant="ghost" onPress=\{onMarkExams\} \/>/);
  assert.match(list, /\{head\.allPast \? \(/);
  // the header is drawn again when the rows say something else
  assert.match(list, /\), \[p\.text, p\.textMuted, head, onClearMarks, onMarkExams\]\);/);
});

test('the filled "לבדוק" lines up with the link field: its row is not pulled back as a row of text buttons is (V-4)', () => {
  const form = board.slice(board.indexOf('{showForm ? ('), board.indexOf('{checking ? <Checking file={readingFile} />'));
  assert.ok(form.length > 0 && !form.includes('StyleSheet.create'), 'the form alone');
  assert.match(form, /<View style=\{styles\.formActions\}>\s*<Button title="לבדוק"/);
  assert.doesNotMatch(form, /styles\.actions\b/);
  const styles = board.slice(board.indexOf('const styles = StyleSheet.create('));
  assert.match(styles, /formActions: \{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space\.sm \},/);
  // the rows of text buttons keep their optical alignment
  assert.match(styles, /actions: \{[^}]*marginStart: -space\.md \},/);
});

test('a preview that failed is said by what was read: a link to a file that cannot be read is not a picked file (V-12)', () => {
  assert.match(bodyOf(board, 'const runPreview = async'), /setProblem\(previewProblem\(err, source, mePage\(\)\)\);/);
  assert.match(bodyOf(confirm, 'const pickColumn = async'), /setProblem\(\{ text: previewProblem\(err, source, mePage\(\)\), refusal: false \}\);/);
});

test('a calendar of the choice with no exams says so in words, as the confirm step does (V-14)', () => {
  const option = declarationOf(confirm, 'function CalendarOption(');
  assert.match(option, /const count = calendarExamCount\(calendar\.count\);/);
  assert.doesNotMatch(option, /plural\(/);
});

test('the exam sheet names whose board an exam of the exam schedule comes from (V-2)', () => {
  const sheet = fs.readFileSync(path.join(components, 'ExamSheet.tsx'), 'utf8');
  assert.match(sheet, /const ownBoard = useOwnBoard\(\);\s*const fromOwnBoard = isOwnBoardExam\(exam, ownBoard\);/);
  assert.match(sheet, /<DetailRow label="מקור" value=\{examSource\(exam\.kind === 'manual' \? 'manual' : exam\.source, fromOwnBoard\)\.full\} \/>/);
});

test('the confirm step starts and ticks the exams again as of today: a past exam is not ticked (V-11)', () => {
  assert.match(confirm, /useState\(\(\) => initialSelection\(rows, skipped, target\.target, todayStr\(\)\)\)/);
  assert.match(bodyOf(confirm, 'const enterConfirm = ('), /initialSelection\(nextRows, nextSkipped, startTarget\(target\.target, refused\), todayStr\(\)\)/);
  assert.match(confirm, /markExams\(s, rows, todayStr\(\)\)/);
});

test('the sheet takes the save that stays on the phone always: there is no "soon" for it (strings, row 19)', () => {
  assert.match(confirm, /onSaveOwn: \(chosen: ChosenBoard\) => Promise<void>;/);
  assert.doesNotMatch(confirm, /onSaveOwn\?/);
  assert.match(confirm, /saveVerdict\(count\)/);
});

test('Android\'s picker is asked for the kinds of file a real .xlsx may be reported as (A-I7)', () => {
  const picker = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'pickBoardFile.ts'), 'utf8');
  assert.match(picker, /const type = \[XLSX_MIME, 'application\/vnd\.ms-excel', 'application\/octet-stream'\];/);
  assert.match(picker, /getDocumentAsync\(\{ type, copyToCacheDirectory: true, multiple: false \}\)/);
  // and the name and the size are still what decides, after the pick
  assert.match(picker, /const problem = boardFileProblem\(asset\.name, size\);/);
});

test('VoiceOver is told what Android\'s live regions say: the move, the questions in the sheet, and "לסגור בלי לשמור?" (A-M7)', () => {
  const announce = fs.readFileSync(path.join(components, 'announce.ts'), 'utf8');
  assert.match(announce, /Platform\.OS === 'ios'/);
  assert.match(announce, /AccessibilityInfo\.announceForAccessibility\(/);
  const controls = fs.readFileSync(path.join(components, 'ExamDateControls.tsx'), 'utf8');
  assert.match(controls, /useAnnounceOnIos\(asking\?\.text \?\? null\);/);
  assert.match(controls, /useAnnounceOnIos\(movedLine\);/);
  // before the component can return early: a hook is called every time
  assert.ok(controls.indexOf('useAnnounceOnIos(') < controls.indexOf('if (!area.canMove) return null;'));
  // the sheet's two questions, "לסגור בלי לשמור?" and "לחזור בלי לשמור את השינויים?" (`leaveQuestion`)
  assert.match(confirm, /useAnnounceOnIos\(question\?\.line \?\? null\);/);
  assert.match(confirm, /accessibilityLiveRegion="polite"[^>]*>\{question\.line\}</);
});

test('the block and the sheet say it in the final review\'s words (strings, rows 1, 2, 9, 13, 15, 16)', () => {
  // 1: the heading names the thing, not the grade
  assert.match(board, /accessibilityRole="header"[^>]*>\s*לוח המבחנים\s*<\/Text>/);
  assert.doesNotMatch(board, /לוח המבחנים של השכבה\s*<\/Text>/);
  // 2: the intro
  assert.match(board, /const INTRO = 'יש לך את לוח המבחנים\? אפשר להדביק קישור אליו, גם לדף באתר בית הספר, או לבחור קובץ אקסל\. כל הכיתה תראה אותו\.';/);
  // 9: the chip beside "רק אצלי"
  assert.match(confirm, /label="לכל הכיתה" selected=\{forClass\}/);
  // 13: the muted line before the action that has one
  assert.match(board, /const lead = main\.find\(\(a\) => a\.lead\)\?\.lead \?\? null;/);
  assert.match(board, /\{lead \? <Text style=\{\[line, \{ color: p\.textMuted \}\]\}>\{lead\}<\/Text> : null\}/);
  // 15: a grid's column, for a sheet as for a file, and for a parent
  assert.match(confirm, /בלוח יש עמודה לכל כיתה, ולא מצאנו בו את הכיתה\. איזו עמודה לבחור\?/);
  // 16: the way back to the date the board had
  assert.match(confirm, /resetLabel=\{corrected \? 'להחזיר את התאריך מהלוח' : null\}/);
  // the board's own sentence is told whether the class has a board (row 8)
  assert.match(board, /const whose = sourceLine\(owner, hasBoard\);/);
  assert.match(onboarding, /sourceLine\(classOwner, classHasBoard\(boardClass\)\)/);
});

test('Connections and Calendars name the board as it is now: from a link or a file, the class\'s or the person\'s own, not the grade\'s (round 4)', () => {
  const connections = fs.readFileSync(path.join(screens, 'ConnectionsScreen.tsx'), 'utf8');
  assert.match(connections, /return \{ line: 'המבחנים, מקישור או מקובץ', actions: null, off: null \};/);
  assert.doesNotMatch(connections, /לוח המבחנים של כל השכבה|מאתר בית הספר'/);
  // the exam board's calendar there is the class's or the person's own (`calendarOptions`): no "של השכבה"
  const calendars = fs.readFileSync(path.join(screens, 'CalendarsScreen.tsx'), 'utf8');
  assert.match(calendars, /: 'לוח המבחנים\. מה שסימנת ב״המבחנים שלי״ כבר מופיע באפליקציה\.'\}/);
  assert.doesNotMatch(calendars, /של השכבה/);
});

test('the School screen\'s exams tab says where the board came from, once, at its top (A-I6)', () => {
  const school = fs.readFileSync(path.join(screens, 'SchoolScreen.tsx'), 'utf8');
  assert.match(school, /examsTabSourceLine\(storedFeed\(storage\)\?\.class \?\? null, ownBoard\)/);
  assert.match(school, /const ownBoard = useOwnBoard\(\);/);
  assert.match(school, /\[ownBoard, settings\.dataUpdatedAt\]/);
  // one line, at the top of the tab whatever it shows below
  assert.match(school, /const whose = boardLine \? \(/);
  assert.equal((school.match(/\{whose\}/g) ?? []).length, 2);
  assert.match(school, /<ExamList\s+boardLine=\{boardLine\}/);
});

test('a class save that failed never reaches the code that removes the own board', () => {
  // `onDone` is called once, after the catch that returns: ExamBoard's `done` (which removes the board) is only reached by a save that went through.
  const save = bodyOf(confirm, 'const save = async');
  assert.equal((save.match(/onDone\(/g) ?? []).length, 1);
  const catches = save.indexOf('} catch (err) {');
  assert.ok(catches >= 0 && save.indexOf('return;', catches) > catches && save.indexOf('return;', catches) < save.indexOf('onDone('));
});

test('the sheet is told that the person holds a board of their own, and the line above the button says what a class save does to it', () => {
  assert.match(board, /holdsOwnBoard=\{holdsOwnBoard\(own\)\}/);
  // through `confirmFooter`, which says it with `targetLine`
  assert.match(confirm, /const facts = \{[^}]*holdsOwn: holdsOwnBoard[^}]*\};\s*const shown = confirmFooter\(facts\);/);
});
