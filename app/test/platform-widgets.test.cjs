const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * `react-native-android-widget` is Android-only and must never reach the iOS
 * bundle. A `Platform.OS` check would still bundle the import, so the split is
 * by file: `update.android.ts` / `register.android.ts` next to plain `update.ts`
 * / `register.ts`, which Metro resolves for every other platform.
 *
 * This walks the import graph from `index.js` the way Metro resolves it for a
 * platform (`.<platform>.ts` before `.ts`) and reports every package it reaches.
 * Type-only imports are erased by the compiler, so they are not followed.
 */
const ROOT = path.join(__dirname, '..');
const LIBRARY = 'react-native-android-widget';
const CODE = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** The specifiers a file imports at runtime. */
function runtimeImports(source) {
  const found = [];
  for (const match of source.matchAll(/^[ \t]*(import|export)\b([^'"`;]*?)\bfrom\s*['"]([^'"]+)['"]/gm)) {
    const clause = match[2].trim();
    if (match[1] === 'import' && clause.startsWith('type ')) continue;
    // `import { type A, type B } from 'x'` is erased whole.
    const named = /^\{([^}]*)\}$/.exec(clause);
    if (match[1] === 'import' && named && named[1].split(',').map((s) => s.trim()).filter(Boolean)
      .every((s) => s.startsWith('type '))) continue;
    if (match[1] === 'export' && clause.startsWith('type ')) continue;
    found.push(match[3]);
  }
  for (const match of source.matchAll(/^[ \t]*import\s*['"]([^'"]+)['"]/gm)) found.push(match[1]);
  for (const match of source.matchAll(/\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(match[1]);
  return found;
}

/** A relative specifier as the bundler finds it for `platform`, or null. */
function resolveFile(from, spec, platform) {
  const base = path.resolve(path.dirname(from), spec);
  const exts = [`.${platform}.ts`, `.${platform}.tsx`, `.${platform}.js`, '.ts', '.tsx', '.js', '.jsx'];
  const candidates = [base, ...exts.map((ext) => base + ext), ...exts.map((ext) => path.join(base, `index${ext}`))];
  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) ?? null;
}

/** Every file and package the app's entry point reaches on `platform`. */
function reach(platform) {
  const files = new Set();
  const packages = new Set();
  const visit = (file) => {
    if (files.has(file)) return;
    files.add(file);
    if (!CODE.has(path.extname(file))) return;
    for (const spec of runtimeImports(fs.readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) {
        const target = resolveFile(file, spec, platform);
        assert.ok(target, `${path.relative(ROOT, file)} imports '${spec}', which resolves to nothing on ${platform}`);
        visit(target);
      } else {
        packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
      }
    }
  };
  visit(path.join(ROOT, 'index.js'));
  const rel = [...files].map((file) => path.relative(ROOT, file).split(path.sep).join('/'));
  return { files: rel, packages };
}

test('the iOS bundle never reaches react-native-android-widget', () => {
  const { files, packages } = reach('ios');
  // The walk really went through the app, and stopped at the plain files.
  assert.ok(files.includes('App.tsx'));
  assert.ok(files.includes('src/widget/update.ios.ts'));
  assert.ok(files.includes('src/widget/register.ios.ts'));
  assert.ok(!packages.has(LIBRARY), `${LIBRARY} is reachable from index.js on iOS`);
  const android = files.filter((file) => /(^|\/)(widget-task\.tsx|widgets\.tsx|[\w-]+\.android\.\w+)$/.test(file));
  assert.deepEqual(android, []);
});

test('iOS draws its widgets with expo-widgets, which Android never reaches', () => {
  const ios = reach('ios');
  assert.ok(ios.packages.has('expo-widgets'));
  assert.ok(ios.files.includes('src/widget/ios/props.ts'));
  const android = reach('android');
  assert.ok(!android.packages.has('expo-widgets'), 'expo-widgets is reachable from index.js on Android');
  assert.ok(!android.packages.has('@expo/ui'), '@expo/ui is reachable from index.js on Android');
  assert.ok(!android.files.some((file) => file.startsWith('src/widget/ios/')));
  // And it is kept out of the Android build's native modules as well.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.expo.autolinking.android.exclude, ['expo-widgets', '@expo/ui']);
});

test('the web bundle still reaches neither widget library', () => {
  const { files, packages } = reach('web');
  assert.ok(files.includes('src/widget/update.ts'));
  assert.ok(files.includes('src/widget/register.ts'));
  assert.ok(!packages.has(LIBRARY));
  assert.ok(!packages.has('expo-widgets'));
});

test('Android still registers the widgets and updates them through the library', () => {
  const { files, packages } = reach('android');
  assert.ok(files.includes('src/widget/register.android.ts'));
  assert.ok(files.includes('src/widget/update.android.ts'));
  assert.ok(files.includes('widget-task.tsx'));
  assert.ok(files.includes('src/widget/widgets.tsx'));
  assert.ok(packages.has(LIBRARY));
});

test('the plain widget modules keep the Android signatures and import nothing from the library', () => {
  const dir = path.join(ROOT, 'src', 'widget');
  for (const name of ['update.ts', 'register.ts', 'names.ts']) {
    const specs = runtimeImports(fs.readFileSync(path.join(dir, name), 'utf8'));
    assert.ok(!specs.some((spec) => spec.includes(LIBRARY) || spec.includes('widget-task')), name);
  }
  const exportsOf = (name) => [...fs.readFileSync(path.join(dir, name), 'utf8')
    .matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exportsOf('register.ts'), exportsOf('register.android.ts'));
  assert.deepEqual(exportsOf('names.ts'), ['WIDGET_NAMES']);
  assert.deepEqual(exportsOf('update.ts'), ['requestWidgetUpdate']);
  assert.deepEqual(exportsOf('update.android.ts'), ['requestWidgetUpdate']);
  assert.deepEqual(exportsOf('register.ios.ts'), exportsOf('register.android.ts'));
  assert.deepEqual(exportsOf('update.ios.ts'), ['requestWidgetUpdate']);
  for (const name of ['update.ts', 'update.android.ts', 'update.ios.ts']) {
    assert.match(fs.readFileSync(path.join(dir, name), 'utf8'), /export \{ WIDGET_NAMES \}/, name);
  }
});
