const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/** Loads a module of app/src through Babel, its relative imports the same way (as planning.test.cjs does). */
function loadSrc(file, cache) {
  if (cache.has(file)) return cache.get(file).exports;
  const { code } = transformFileSync(file, {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  cache.set(file, module);
  const requireSrc = (id) => (id.startsWith('.') ? loadSrc(path.resolve(path.dirname(file), `${id}.ts`), cache) : require(id));
  new Function('module', 'exports', 'require', code)(module, module.exports, requireSrc);
  return module.exports;
}

const cache = new Map();
const s = loadSrc(path.join(__dirname, '../src/lib/school.ts'), cache);
// The Assistant width table the week grid measures with, checked against the font files in planning.test.cjs.
const pl = loadSrc(path.join(__dirname, '../src/lib/planning.ts'), cache);
const theme = loadSrc(path.join(__dirname, '../src/theme.ts'), cache);

const MIN_TOUCH = 44;
/** The badge on "ציונים" while there are new grades: `tabBadge`'s least width and the gap before it. */
const BADGE = 20 + 6;

/**
 * The row as `UnderlineTabs` draws it, at `scale`: every label at `type.label` in `bodySemi`
 * (the chosen one differs by colour and its underline, not its width).
 */
function rowWidth(scale = 1, paddingEnd = s.SCHOOL_TAB_ROW.paddingEnd, badge = false, list = s.SCHOOL_TABS) {
  const g = s.SCHOOL_TAB_ROW;
  const tabs = list.map((t) => {
    const text = pl.textWidth(t.label, theme.type.label * scale, 'semi');
    return Math.max(MIN_TOUCH, text + 2 * (g.chipPadding + g.border) + (badge && t.key === 'grades' ? BADGE : 0));
  });
  return { tabs, total: g.paddingStart + tabs.reduce((a, b) => a + b, 0) + g.gap * (tabs.length - 1) + paddingEnd };
}

test('run 7: the first five School tabs fit a 360-point phone at the usual text size (Itai, Daniel; underlined since plan §16)', () => {
  assert.deepEqual(s.SCHOOL_TABS.map((t) => t.label), ['מבחנים', 'שיעורי בית', 'ציונים', 'בגרות', 'הודעות', 'חיסורים']);
  // "חיסורים" came sixth and last: the five before it keep their places and still fit, and the row
  // scrolls to it, its end faded with a chevron, as at a larger text size.
  const five = s.SCHOOL_TABS.slice(0, 5);
  const { total, tabs } = rowWidth(1, s.SCHOOL_TAB_ROW.paddingEnd, false, five);
  assert.ok(rowWidth().total > 360, 'all six overflow: the fade shows');
  assert.ok(total <= 360, `${total.toFixed(1)} points`);
  // Every tab is a full tap target on its own, before `minWidth` steps in.
  for (const [i, w] of rowWidth().tabs.entries()) assert.ok(w >= MIN_TOUCH, `${s.SCHOOL_TABS[i].label}: ${w.toFixed(1)}`);
  assert.equal(tabs.length, 5);
  // The old geometry — 16 points each side, 8 between, 20 at both ends — did not: "הודעות" was cut at the edge.
  const old = 40 + five.reduce((sum, t) => sum + pl.textWidth(t.label, theme.type.label) + 34, 0) + 8 * 4;
  assert.ok(old > 400, `the old row was ${old.toFixed(1)}`);
  // The first label lines up with the page under the row; underlined tabs have no outline.
  assert.equal(s.SCHOOL_TAB_ROW.paddingStart + s.SCHOOL_TAB_ROW.chipPadding, theme.space.xl);
  assert.equal(s.SCHOOL_TAB_ROW.border, 0);
});

test('run 7: at a larger size, or with a new-grades badge, the row scrolls — and its fade leaves room for the last tab', () => {
  const g = s.SCHOOL_TAB_ROW;
  for (const scale of [theme.TEXT_SCALES.large, theme.TEXT_SCALES.xlarge]) {
    assert.ok(rowWidth(scale).total > 360, `at ${scale} the row overflows: the fade and its chevron show`);
  }
  assert.ok(rowWidth(1, g.paddingEnd, true).total > 360, 'a badge makes it overflow too');
  // Overflowing, the end padding is the fade: scrolled to the end, the last tab ends clear of it.
  assert.equal(g.fade, MIN_TOUCH);
});

test('tabRowAtEnd: the end of a right-to-left row is its left edge — Android counts from it, a browser down to it', () => {
  // Android: offsets from the left edge; an RTL row opens at max (its start) and ends at 0.
  assert.equal(s.tabRowAtEnd(200, 360, 560), false);
  assert.equal(s.tabRowAtEnd(100, 360, 560), false);
  assert.equal(s.tabRowAtEnd(0, 360, 560), true);
  assert.equal(s.tabRowAtEnd(1, 360, 560), true);
  // A browser: 0 at the start, -max at the end.
  assert.equal(s.tabRowAtEnd(0, 360, 560, true), false);
  assert.equal(s.tabRowAtEnd(-200, 360, 560, true), true);
  // A row that fits is never "more this way".
  assert.equal(s.tabRowAtEnd(0, 360, 352), true);
  assert.equal(s.tabRowAtEnd(0, 360, 352, true), true);
  // The same convention `tabScrollOffset` scrolls with: revealing the last tab is reaching the end.
  const last = { x: 0, width: 80 };
  assert.equal(s.tabRowAtEnd(s.tabScrollOffset(last, 360, 560), 360, 560), true);
  assert.equal(s.tabRowAtEnd(s.tabScrollOffset(last, 360, 560, true), 360, 560, true), true);
});
