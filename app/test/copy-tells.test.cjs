const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The copy rules of plan §16.2 over the whole app: no string in a `.ts` or
 * `.tsx` file under app/src has a ✓, a long dash in a Hebrew sentence, a
 * "·" (none at all since the Wave 9 re-rate), or quotes other than ״…״
 * (app/scripts/copy-tells.cjs, whose own test is copy-tells-script.test.cjs).
 * Text that comes from a source (a school event's title, Mashov's words) is
 * not in the code, so it never counts.
 */
const tells = require('../scripts/copy-tells.cjs');

const app = path.join(__dirname, '..');
const src = path.join(app, 'src');

/** Every `.ts` and `.tsx` file under `dir`, at any depth. */
function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test('no string under app/src breaks a copy rule of plan §16.2', () => {
  const files = sources(src);
  // The walk reached every corner of the app, not one folder of it.
  for (const known of ['screens/TodayScreen.tsx', 'components/notebook.tsx', 'lib/today.ts', 'widget/model.ts', 'navigation/Root.tsx']) {
    assert.ok(files.includes(path.join(src, known)), known);
  }
  const findings = files.flatMap((file) => tells.scan(fs.readFileSync(file, 'utf8'), path.relative(app, file).split(path.sep).join('/')));
  assert.deepEqual(findings.map(tells.format), []);
});
