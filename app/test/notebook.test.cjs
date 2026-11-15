const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/**
 * Loads components/notebook.tsx for its pure helpers (plan §16.1). theme.ts
 * loads for real; React Native, the SVG library, the other components and
 * lib/school are stubbed, since nothing here renders.
 */
function load(file) {
  const { code } = transformFileSync(file, {
    configFile: false, babelrc: false,
    presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  const stubs = {
    'react-native': { StyleSheet: { create: (s) => s, absoluteFill: {} }, Platform: { OS: 'android' } },
    'react-native-svg': {},
    './ui': { MIN_TOUCH: 44 },
    './AppIcon': {},
    '../lib/school': { SCHOOL_TAB_ROW: { paddingStart: 9, paddingEnd: 8, gap: 0, chipPadding: 11, border: 0, fade: 44 } },
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
const nb = load(path.join(src, 'components/notebook.tsx'));
const theme = load(path.join(src, 'theme.ts'));
const PALETTES = [['light', theme.light], ['dark', theme.dark]];

test('the margin and the ruled row: 56 wide, a 1.5 line, rows at least 52 with 12 above and below (plan §16.1)', () => {
  assert.equal(nb.MARGIN_WIDTH, 56);
  assert.equal(nb.MARGIN_LINE, 1.5);
  assert.equal(nb.ROW_MIN_HEIGHT, 52);
  assert.equal(nb.ROW_PADDING, 12);
});

test('a row\'s lead slot is its first line with the row\'s padding: a 48-point checkbox control fits it exactly', () => {
  assert.equal(nb.LEAD_GAP, 12);
  assert.equal(nb.CHECKBOX_SIZE, 20);
  // 12 + 18 x 1.308 (23.5, so 24) + 12: the control's centre is the title's first line's.
  assert.equal(nb.leadSlotHeight(1), 48);
  assert.equal(nb.leadSlotHeight(1.15), 51);
  assert.equal(nb.leadSlotHeight(1.3), 55);
  // It grows with the text and never centres the box above the first line's middle.
  let last = 0;
  for (const scale of [0.85, 1, 1.15, 1.3, 1.3 * 1.3, 2]) {
    const h = nb.leadSlotHeight(scale);
    assert.ok(h > last, `scale ${scale}`);
    const line = theme.type.title * scale * nb.TITLE_LINE;
    assert.ok(Math.abs(h / 2 - (nb.ROW_PADDING + line / 2)) <= 0.5, `scale ${scale}: ${h}`);
    last = h;
  }
});

test('a mark is a highlighter: each kind its own soft fill, "mark" for this one', () => {
  for (const [name, p] of PALETTES) {
    assert.equal(nb.markFill('exam', p), p.mark, `${name}: an exam is the yellow highlighter`);
    assert.equal(nb.markFill('change', p), p.changeSoft, name);
    assert.equal(nb.markFill('ok', p), p.okSoft, name);
    assert.equal(nb.markFill('mark', p), p.mark, name);
  }
});

test('the ink on a mark: onMark on the "this one" yellow, text on the status highlighters', () => {
  for (const [name, p] of PALETTES) {
    assert.equal(nb.markInk('mark', p), p.onMark, name);
    assert.equal(nb.markInk('exam', p), p.onMark, `${name} exam`);
    for (const kind of ['change', 'ok']) assert.equal(nb.markInk(kind, p), p.text, `${name} ${kind}`);
  }
});

test('row tones: late writes the margin in red, cancelled strikes the title in red, now dashes the rule in blue', () => {
  for (const [name, p] of PALETTES) {
    const normal = nb.toneStyle('normal', p);
    assert.deepEqual(normal, { margin: p.textMuted, title: p.text, strike: false, rule: p.border, dashed: false }, name);
    assert.equal(nb.toneStyle('late', p).margin, p.cancel);
    assert.equal(nb.toneStyle('late', p).strike, false);
    // Android ignores textDecorationColor: the struck title itself is red, so the strike is too.
    const cancelled = nb.toneStyle('cancelled', p);
    assert.equal(cancelled.strike, true);
    assert.equal(cancelled.title, p.cancel);
    const now = nb.toneStyle('now', p);
    assert.equal(now.dashed, true);
    assert.equal(now.rule, p.accent);
    assert.equal(now.margin, p.accent);
  }
});

test('a filter chip: a button is selected, one choice of a group is a checked radio', () => {
  assert.deepEqual(nb.filterChipState('button', true, false), { selected: true, disabled: false });
  assert.deepEqual(nb.filterChipState('button', false, true), { selected: false, disabled: true });
  assert.deepEqual(nb.filterChipState('radio', true, false), { checked: true, disabled: false });
  assert.deepEqual(nb.filterChipState('radio', false, true), { checked: false, disabled: true });
});

test('a checkbox: off goes on, on goes off, mixed goes on', () => {
  assert.equal(nb.checkboxNext(false), true);
  assert.equal(nb.checkboxNext(true), false);
  assert.equal(nb.checkboxNext('mixed'), true);
});

test('the pen ring stretches to its box: the sketch at 58 x 52, twice as wide at 116', () => {
  const at = nb.penCirclePath(58, 52);
  assert.equal(at, 'M33 4C17 2 4 11 5 25c1 15 18 23 33 21c13 -2 19 -11 16 -23C51 11 41 4 27 5');
  const wide = nb.penCirclePath(116, 52);
  assert.ok(wide.startsWith('M66 4C34 2 8 11 10 25'), wide);
  // Every x and y stays inside the box, the 2-point stroke included, at any size.
  for (const [w, h] of [[58, 52], [52, 48], [70, 64]]) {
    const abs = absolutePoints(nb.penCirclePath(w, h));
    for (const [x, y] of abs) {
      assert.ok(x >= 1 && x <= w - 1 + 0.5 && y >= 1 && y <= h - 1, `${w}x${h}: ${x},${y}`);
    }
  }
  assert.deepEqual({ ...nb.PEN_OUTSET }, { x: 9, y: 6 });
});

/** The end points and control points of a path of M, C and c commands, made absolute. */
function absolutePoints(d) {
  const out = [];
  let cx = 0;
  let cy = 0;
  for (const [, cmd, args] of d.matchAll(/([MCc])([^MCc]+)/g)) {
    const n = args.trim().split(/\s+/).map(Number);
    if (cmd === 'M') {
      [cx, cy] = n;
      out.push([cx, cy]);
      continue;
    }
    for (let i = 0; i < n.length; i += 6) {
      const pts = [[n[i], n[i + 1]], [n[i + 2], n[i + 3]], [n[i + 4], n[i + 5]]]
        .map(([x, y]) => (cmd === 'c' ? [cx + x, cy + y] : [x, y]));
      out.push(...pts);
      [cx, cy] = pts[2];
    }
  }
  return out;
}

test('the "+" sits 16 from the end edge, 20 above the tab bar, 56 tall; a list under it clears it and a toast', () => {
  assert.equal(theme.FAB.inset, 16);
  assert.equal(theme.FAB.margin, 20);
  assert.equal(theme.FAB.size, 56);
  // The room every screen with the "+" leaves (W5-6): 148 at 1.0, 164 at 1.3.
  assert.equal(nb.fabListClearance(1), 148);
  assert.equal(nb.fabListClearance(1.3), 164);
  assert.equal(nb.fabListClearance(0.85), 148, 'never less than at the usual size');
  for (const scale of [1, 1.15, 1.3]) {
    const toastTop = theme.TOAST_CLEARANCE + theme.TOAST_MIN_HEIGHT * scale;
    assert.ok(nb.fabListClearance(scale) > toastTop, `scale ${scale}`);
    assert.ok(nb.fabListClearance(scale) > theme.FAB.margin + theme.FAB.size, `scale ${scale}`);
  }
});
