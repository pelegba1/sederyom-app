const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Tasks are kept on the phone until Google is connected, then in Google
 * (docs/superpowers/specs/2026-11-09-tasks-without-google-design.md). The
 * help answer to "where are the tasks kept?" says that, in these words.
 */
const HELP = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'HelpScreen.tsx'), 'utf8');

const ANSWER =
  'בטלפון הזה, עד שמחברים Google. אחרי החיבור הן עוברות לחשבון ה־Google שלך, בלי אפליקציה נוספת. ' +
  'מה שמוסיפים או מסמנים כאן נשמר שם, ואפשר לראות ולערוך את המשימות גם ביומן Google.';

test('the help answer says the tasks are on the phone until Google is connected', () => {
  const at = HELP.indexOf("q: 'איפה המשימות נשמרות?'");
  assert.notEqual(at, -1, 'the question is in the help');
  const answer = /a: '([^']*)'/.exec(HELP.slice(at));
  assert.equal(answer && answer[1], ANSWER);
});

test('the help does not call Google a list of tasks', () => {
  assert.doesNotMatch(HELP, /ברשימת המשימות של Google/);
});
