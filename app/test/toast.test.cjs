const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/**
 * Loads Toast.tsx for its pure helpers. Its relative imports (theme, layout)
 * load for real; React Native and the safe-area library are stubbed, since
 * nothing here renders.
 */
function load(file) {
  const { code } = transformFileSync(file, {
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
    if (spec.startsWith('.')) return load(`${path.resolve(path.dirname(file), spec)}.ts`);
    return require(spec);
  };
  new Function('module', 'exports', 'require', code)(module, module.exports, req);
  return module.exports;
}

const src = path.join(__dirname, '../src');
const toast = load(path.join(src, 'components/Toast.tsx'));
const theme = load(path.join(src, 'theme.ts'));
const layout = load(path.join(src, 'lib/layout.ts'));

test('an undo reads "לבטל": not the noun "ביטול" (R-33), not "החזרה" (Maya, run 3)', () => {
  assert.equal(toast.UNDO_LABEL, 'לבטל');
  const undo = () => undefined;
  assert.deepEqual(toast.toastSpec({ onAction: undo }), { actionLabel: 'לבטל', durationMs: toast.TOAST_ACTION_MS });
  // A screen that names its action keeps the name.
  assert.deepEqual(toast.toastSpec({ actionLabel: 'לפתוח', onAction: undo }), { actionLabel: 'לפתוח', durationMs: toast.TOAST_ACTION_MS });
});

test('a toast without an action has no button and a shorter stay; durationMs overrides', () => {
  assert.deepEqual(toast.toastSpec(), { actionLabel: undefined, durationMs: toast.TOAST_PLAIN_MS });
  assert.deepEqual(toast.toastSpec({}), { actionLabel: undefined, durationMs: toast.TOAST_PLAIN_MS });
  assert.equal(toast.toastSpec({ onAction: () => undefined, durationMs: 8000 }).durationMs, 8000);
  assert.ok(toast.TOAST_ACTION_MS > toast.TOAST_PLAIN_MS);
});

test('the toast floats clear of the FAB and of a bottom button row, at any inset and font scale (R-33)', () => {
  const MIN_TOUCH = 44;
  for (const inset of [0, 24, 48, 80]) {
    for (const fontScale of [1, 1.3, 2]) {
      const bar = layout.bottomBarLayout(inset, fontScale).height;
      const above = toast.toastBottom(inset, fontScale) - bar;
      // The FAB's top edge is FAB.margin + FAB.size above the tab bar; leave a gap over it.
      assert.ok(above >= theme.FAB.margin + theme.FAB.size + theme.space.sm, `inset ${inset}, scale ${fontScale}: ${above}`);
      // A bottom row of buttons: a 44-point target on a 16-point margin.
      assert.ok(above >= theme.space.lg + MIN_TOUCH + theme.space.sm, `inset ${inset}, scale ${fontScale}: ${above}`);
      // With the in-app text size too, the toast rides on the bar TabBar.tsx draws at that size.
      for (const appScale of [1.15, 1.3]) {
        const drawn = layout.bottomBarLayout(inset, layout.tabBarScale(fontScale, appScale)).height;
        assert.equal(toast.toastBottom(inset, fontScale, appScale) - drawn, theme.TOAST_CLEARANCE);
      }
    }
  }
});

/** A screen as React Navigation hands it to the toast: focus, and its blur and beforeRemove events. */
function fakeScreen(focused = true) {
  const listeners = { blur: new Set(), beforeRemove: new Set() };
  return {
    focused,
    isFocused() { return this.focused; },
    addListener(type, callback) {
      listeners[type].add(callback);
      return () => listeners[type].delete(callback);
    },
    emit(type) {
      if (type === 'blur') this.focused = false;
      for (const callback of [...listeners[type]]) callback();
    },
    count: () => listeners.blur.size + listeners.beforeRemove.size,
  };
}

test('bindToOwner: a toast goes when its screen leaves the front — another tab, a screen over it, back (Wave 7, Itai, run 6)', () => {
  for (const event of ['blur', 'beforeRemove']) {
    const screen = fakeScreen();
    let gone = 0;
    const untie = toast.bindToOwner(screen, () => { gone += 1; });
    assert.equal(typeof untie, 'function');
    assert.equal(gone, 0);
    screen.emit(event);
    assert.equal(gone, 1, event);
  }
});

test('bindToOwner: within its own screen it stays; untied, the screen no longer reaches it', () => {
  const screen = fakeScreen();
  let gone = 0;
  const untie = toast.bindToOwner(screen, () => { gone += 1; });
  assert.equal(screen.count(), 2);
  // Replaced by the next toast, or its time is up: untied, nothing left listening.
  untie();
  assert.equal(screen.count(), 0);
  screen.emit('blur');
  assert.equal(gone, 0);
});

test('bindToOwner: raised for a screen no longer in front, it is not shown at all', () => {
  const screen = fakeScreen(false);
  assert.equal(toast.bindToOwner(screen, () => undefined), null);
  assert.equal(screen.count(), 0);
});

test('tieToast: one that outlives its screen is shown after the screen went ("יצאנו מההדגמה", "הנתונים נמחקו")', () => {
  // Settings is gone once navigation.reset has run: an ordinary toast for it is dropped…
  const settings = fakeScreen(false);
  assert.equal(toast.tieToast(settings, {}, () => undefined), null);
  // …and one that outlives it belongs to no screen and is shown on the welcome screen.
  let gone = 0;
  const untie = toast.tieToast(settings, { outlivesScreen: true }, () => { gone += 1; });
  assert.equal(typeof untie, 'function');
  assert.equal(settings.count(), 0);
  settings.emit('beforeRemove');
  assert.equal(gone, 0);
});

test('tieToast: without outlivesScreen a toast stays tied to its screen, as bindToOwner ties it', () => {
  const screen = fakeScreen();
  let gone = 0;
  const untie = toast.tieToast(screen, { outlivesScreen: false }, () => { gone += 1; });
  assert.equal(screen.count(), 2);
  screen.emit('blur');
  assert.equal(gone, 1);
  untie();
  assert.equal(screen.count(), 0);
});

test('bindToOwner: raised outside any screen (the Mashov renewal sheet), it belongs to none and stays', () => {
  const untie = toast.bindToOwner(null, () => assert.fail('nothing to leave'));
  assert.equal(typeof untie, 'function');
  untie();
  assert.equal(typeof toast.bindToOwner(undefined, () => undefined), 'function');
});
