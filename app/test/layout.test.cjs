const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transformFileSync } = require('@babel/core');
const fs = require('node:fs');
const path = require('node:path');

function load(file) {
  const { code } = transformFileSync(path.join(__dirname, '../src', file), {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

const result = load('lib/layout.ts');
const theme = load('theme.ts');

test('Android navigation buttons never consume the app tab touch targets', () => {
  for (const inset of [48, 24, 0, 80]) {
    const bar = result.bottomBarLayout(inset, 1);
    assert.ok(bar.height - bar.paddingBottom - bar.paddingTop >= 56, `insufficient tab space at inset ${inset}`);
    assert.ok(bar.paddingBottom >= inset);
  }
});

test('larger accessibility text gets additional tab content space', () => {
  const regular = result.bottomBarLayout(48, 1);
  const large = result.bottomBarLayout(48, 2);
  assert.ok(large.height > regular.height);
  assert.equal(regular.paddingBottom, large.paddingBottom);
});

/**
 * What a tab draws, top to bottom, at the phone's `fontScale` and the app's
 * `appScale`: the tab button's padding, the highlighter pill, the gap, the
 * label's line (Android scales it with the phone; the app's size reaches it
 * up to 1.15), the button padding again. Counted here on its own, not
 * through `tabContentHeight`, so the test fails if the bar is sized short.
 */
function drawnTab(fontScale, appScale) {
  const label = 18 * fontScale * Math.min(appScale, 1.15);
  return 5 + 30 + 4 + label + 5;
}

test('plan §16.1 tab bar: the pill, the gap and the whole label line fit, at every text size and inset', () => {
  for (const inset of [0, 24, 48, 80]) {
    for (const fontScale of [0.85, 1, 1.15, 1.3, 2]) {
      for (const appScale of [1, 1.15, 1.3]) {
        const bar = result.bottomBarLayout(inset, result.tabBarScale(fontScale, appScale));
        const content = bar.height - bar.paddingTop - bar.paddingBottom;
        const drawn = drawnTab(fontScale, appScale);
        assert.ok(drawn <= content, `inset ${inset}, phone ${fontScale}, app ${appScale}: ${drawn.toFixed(1)} in ${content}`);
        assert.ok(bar.paddingBottom >= inset);
      }
    }
  }
  // The bar F first shipped (64 tall with 8 above: 56 for the content) cut the label in half at the usual size.
  assert.ok(drawnTab(1, 1) > 56);
});

test('the tab bar measures what TabBar.tsx draws: the label is the caption size, the in-app size capped at 1.15', () => {
  const t = result.TAB_BAR;
  assert.equal(t.labelSize, theme.type.caption);
  assert.ok(t.labelLine >= t.labelSize * 1.25, 'a line tall enough for Assistant at the label size');
  assert.deepEqual({ ...t.pill }, { width: 56, height: 30 });
  assert.equal(result.tabBarScale(1, 1.3), 1.15);
  assert.equal(result.tabBarScale(1.3, 1), 1.3);
  assert.ok(Math.abs(result.tabBarScale(1.3, 1.15) - 1.3 * 1.15) < 1e-9);
  // The bar pads every tab button by `itemPadding` on each side.
  const bar = fs.readFileSync(path.join(__dirname, '../src/navigation/TabBar.tsx'), 'utf8');
  assert.match(bar, /padding:\s*TAB_BAR\.itemPadding/);
});

test('the highlighter slides from the start edge: right to left in RTL', () => {
  // 400 wide, five 80-wide tabs, the 56 pill centred: 12 in from each tab's start.
  assert.equal(result.tabPillShift(0, 400, 5, 'rtl'), -12);
  assert.equal(result.tabPillShift(4, 400, 5, 'rtl'), -332);
  assert.equal(result.tabPillShift(0, 400, 5, 'ltr'), 12);
  // A parent's three tabs.
  assert.equal(result.tabPillShift(2, 390, 3, 'rtl'), -(260 + 37));
  // Before the bar is measured.
  assert.equal(result.tabPillShift(1, 0, 5, 'rtl'), 0);
});

test('a finger on the bar is over the tab counted from the start edge, between tabs in fractions', () => {
  // 400 wide, five 80-wide tabs. In RTL the first tab is on the right: its middle is at x 360.
  assert.equal(result.tabAtPoint(360, 400, 5, 'rtl'), 0);
  assert.equal(result.tabAtPoint(40, 400, 5, 'rtl'), 4);
  assert.equal(result.tabAtPoint(320, 400, 5, 'rtl'), 0.5);
  assert.equal(result.tabAtPoint(40, 400, 5, 'ltr'), 0);
  assert.ok(Math.abs(result.tabAtPoint(200, 390, 3, 'rtl') - (1 - 5 / 130)) < 1e-9);
  // Past the middle of the end tabs, and off the bar, the pill stops at the end tab.
  assert.equal(result.tabAtPoint(395, 400, 5, 'rtl'), 0);
  assert.equal(result.tabAtPoint(-30, 400, 5, 'rtl'), 4);
  assert.equal(result.tabAtPoint(900, 400, 5, 'ltr'), 4);
  // Before the bar is measured, or with one tab.
  assert.equal(result.tabAtPoint(100, 0, 5, 'rtl'), 0);
  assert.equal(result.tabAtPoint(100, 400, 1, 'rtl'), 0);
});
