const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Plan W5-14 and appendix א: the words on the setup screens — onboarding,
 * settings, connections, the Mashov login, calendars, help and the
 * notifications log. Every text there is read by a ninth grader (Maya), so
 * none of the words she stopped at, and nothing about how the app is built.
 *
 * Scans the source with its comments removed: a comment may name a word in
 * order to say it is gone.
 */
const SRC = path.join(__dirname, '..', 'src');
const FILES = [
  'screens/OnboardingScreen.tsx', 'screens/SettingsScreen.tsx', 'screens/ConnectionsScreen.tsx',
  'screens/settings/parts.tsx', 'screens/settings/permission.tsx', 'screens/settings/time.tsx', 'screens/settings/classes.tsx',
  'screens/settings/AbsenceRules.tsx', 'screens/settings/InviteRows.tsx', 'screens/settings/ExamsToCalendarSwitch.tsx',
  'screens/settings/NotificationSettingsScreen.tsx', 'screens/settings/MeSettingsScreen.tsx', 'screens/settings/GoogleSettingsScreen.tsx',
  'screens/settings/ShownSettingsScreen.tsx', 'screens/settings/AppearanceSettingsScreen.tsx',
  'screens/MashovLoginScreen.tsx', 'screens/CalendarsScreen.tsx', 'screens/HelpScreen.tsx',
  'screens/NotificationsScreen.tsx', 'lib/onboarding.ts', 'lib/settingsSummary.ts', 'lib/connections.ts', 'lib/notifications.ts',
  // The demo's words, shown on the welcome step, in Settings and on מצב חיבורים.
  'demo/mode.ts',
];

/** The source without `/* … *\/` blocks and `//` line comments (a `//` inside "https://" is kept). */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

/** Each forbidden word, and why. */
const WORDS = [
  [/סשן|שרת|סנכרון/, 'how the app is built (appendix א)'],
  [/הוחל/, '"ההמלצה לא הוחלה" read as an error Maya made'],
  [/יפוג/, '"יפוג" is a grown-up word; Mashov "ינתק"'],
  [/נקרא(?:ו)?\s+ממשוב|שכבר נקרא/, '"נקראו ממשוב": Maya asked who read what'],
  [/ווידג/, 'Maya did not know "ווידג׳ט"'],
  [/בענן|מוצפן/, '"בענן" and "מוצפן" sounded technical to Maya'],
  [/מחר מבחן באנגלית/, 'the text-size sample startled Maya'],
  [/ארבעה צעדים/, '"ארבעה צעדים" under "שלב 1 מתוך 5" (Itai)'],
];

test('the setup screens use none of the words the personas stopped at', () => {
  for (const file of FILES) {
    const code = withoutComments(fs.readFileSync(path.join(SRC, file), 'utf8'));
    for (const [word, why] of WORDS) {
      const hit = word.exec(code);
      assert.equal(hit, null, `${file}: ${hit?.[0]} — ${why}`);
    }
  }
});

test('the comment stripper keeps strings and drops comments', () => {
  assert.equal(withoutComments("const a = 'https://x'; // שרת"), "const a = 'https://x'; ");
  assert.equal(withoutComments('/** בענן */\nconst b = 1;'), '\nconst b = 1;');
  assert.match(withoutComments("const c = 'שכבר נקרא';"), /שכבר נקרא/);
});
