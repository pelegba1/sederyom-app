const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The demo answers every screen through one switch, `appApi` (`demo/api.ts`),
 * which asks `isDemo()` on each call. A screen that imports `phoneApi` itself
 * goes around it: Today did, and its empty phone task list was what the
 * demo's משימות tab showed. Only the hooks' switch may hold the phone's API.
 */
const SRC = path.join(__dirname, '..', 'src');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test('no screen or component asks the phone\'s API around the demo\'s switch', () => {
  const offenders = ['screens', 'components']
    .flatMap((dir) => sourceFiles(path.join(SRC, dir)))
    .filter((file) => /import\s*\{[^}]*\bphoneApi\b[^}]*\}\s*from\s*'[^']*local\/phoneApi'/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC, file));
  assert.deepEqual(offenders, []);
});

test('the switch itself is where the phone\'s API is chosen', () => {
  const api = fs.readFileSync(path.join(SRC, 'demo', 'api.ts'), 'utf8');
  assert.match(api, /const current = \(\): AppApi => \(isDemo\(\) \? demoApi : phoneApi\);/);
  const hooks = fs.readFileSync(path.join(SRC, 'api', 'hooks.ts'), 'utf8');
  assert.match(hooks, /import \{ appApi \} from '\.\.\/demo\/api';/);
});
