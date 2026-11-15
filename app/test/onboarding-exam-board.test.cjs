const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Onboarding's exams step and the exam board, where the step cannot be run without a phone: what must stay true of how
 * the screen is wired, read from its source. (What the step decides - when it offers a board, whose it says it is - is
 * tested in server/test/exam-board-app.test.ts.)
 *
 * - The block that brings a board is on the step only while `examStepOffersBoard` says so, and is shown without its own
 *   heading (the step's line above it says the same).
 * - A saved board makes the step check again, through the same `examsStale` the class pick uses.
 * - The class's feed is read before /settings, or the exams and the board the step shows are the ones from before the class.
 * - "המשך" is never held by the offer: bringing a board is a choice, and the step goes on without it.
 */
const screen = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'OnboardingScreen.tsx'), 'utf8');
const board = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ExamBoard.tsx'), 'utf8');

test('the step mounts ExamBoard only when it offers one, without the block\'s heading', () => {
  assert.equal((screen.match(/<ExamBoard\b/g) ?? []).length, 1);
  assert.match(screen, /const offersBoard = !examsStale && Boolean\(s\?\.classId\) && examStepOffersBoard\(exams\.length, classOwner\);/);
  assert.match(screen, /\{offersBoard \? \([\s\S]{0,200}<ExamBoard showHeading=\{false\} own=\{ownBoard\} onSaved=\{\(\) => setExamsStale\('board'\)\} \/>/);
});

test('a phone that follows no class is not offered a board: every try would end in no_class', () => {
  // `examStepOffersBoard` cannot tell "no class" from "class chosen, feed not read yet" (both: no exams, owner none),
  // so the screen asks the settings for the class itself, before it asks the function.
  const gate = screen.indexOf('const offersBoard =');
  assert.ok(gate >= 0, 'the step decides the offer in one place');
  const line = screen.slice(gate, screen.indexOf(';', gate));
  assert.ok(line.indexOf('Boolean(s?.classId)') > 0, 'the class is asked for');
  assert.ok(line.indexOf('Boolean(s?.classId)') < line.indexOf('examStepOffersBoard('), 'before the function is');
  // And nothing else mounts the block.
  assert.equal((screen.match(/<ExamBoard\b/g) ?? []).length, 1);
});

test('the step says why it is checking: a class was picked, or a board was saved', () => {
  assert.match(screen, /useState<false \| 'class' \| 'board'>\(false\)/);
  assert.match(screen, /patch\(\{ classId: option\.id, className: option\.name \}\);\s*setExamsStale\('class'\);/);
  assert.match(screen, /const countLine = examsStale\s*\? examStepCheckingLine\(examsStale\)/);
});

test('a board saved for the class tells the screen around it, and a board kept on the phone does not', () => {
  assert.match(board, /showHeading = true/);
  // A board kept on the phone returns before the screen is told; the one saved for the class tells it, and only that one.
  assert.equal((board.match(/onSaved\?\.\(\)/g) ?? []).length, 1);
  const done = board.slice(board.indexOf('const done = ('));
  const keptOnPhone = done.indexOf("if (saved === 'own') {");
  assert.ok(keptOnPhone >= 0 && keptOnPhone < done.indexOf('return;') && done.indexOf('return;') < done.indexOf('onSaved?.()'));
});

test('the owner is read from the class and from the phone\'s own board, which the step reads once for itself and for the block', () => {
  assert.match(screen, /const ownBoard = useOwnBoard\(\);/);
  assert.match(screen, /const classOwner = boardOwner\(boardClass, ownBoard\);/);
  assert.match(screen, /const boardLine = examsStale \? null : sourceLine\(classOwner, /);
});

test('the class\'s feed is read before /settings is read again, and a failed read does not stop the step', () => {
  const start = screen.indexOf('void refreshFeed(storage)');
  assert.ok(start >= 0, 'the effect reads the feed');
  const effect = screen.slice(start, screen.indexOf('return () => {', start));
  const feed = effect.indexOf('refreshFeed(storage)');
  const catches = effect.indexOf('.catch(() => null)');
  const settings = effect.indexOf('refetchSettings.current()');
  assert.ok(feed >= 0 && catches > feed && settings > catches, 'feed, then the catch, then /settings');
  assert.match(effect, /\.finally\(\(\) => \{\s*if \(live\) setExamsStale\(false\);/);
});

test('the count line is not shown above the offer to bring a board: the block\'s own words say there is none yet (V-19)', () => {
  // decided in one place, after the offer is, and with nothing drawn when there is no line
  const decided = screen.indexOf('const countLine =');
  assert.ok(decided > screen.indexOf('const offersBoard ='), 'after the offer is decided');
  assert.match(screen, /const countLine = examsStale\s*\? examStepCheckingLine\(examsStale\)\s*: settings\.isFetching && exams\.length === 0\s*\? 'טוען את לוח המבחנים…'\s*: offersBoard\s*\? null\s*: examStepLine\(view, exams\.length\);/);
  assert.match(screen, /\{countLine \? \(\s*<Text style=\{\{ fontFamily: font\.bodySemi, fontSize: type\.title, color: p\.text, marginTop: space\.md \}\}>\{countLine\}<\/Text>\s*\) : null\}/);
  // the step's line itself is as it was: it still says it where no board is offered
  assert.doesNotMatch(screen, /: examStepLine\(view, exams\.length\)\}/);
});

test('"המשך" on the step is held by the check and the save, never by the offer of a board', () => {
  assert.match(screen, /disabled=\{examsStale !== false \|\| \(view\.phase === 'offer' && saving\)\}/);
  assert.doesNotMatch(screen, /disabled=\{[^}]*offersBoard/);
});
