const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

function loadTheme() {
  const { code } = transformFileSync(path.join(__dirname, '../src/theme.ts'), {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

/** `#RRGGBB` or `rgba(r,g,b,a)` → channels 0–255 and alpha. */
function parse(color) {
  if (color.startsWith('#')) {
    const n = color.slice(1);
    return { r: parseInt(n.slice(0, 2), 16), g: parseInt(n.slice(2, 4), 16), b: parseInt(n.slice(4, 6), 16), a: 1 };
  }
  const m = /^rgba\(([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)$/.exec(color.replace(/\s/g, ''));
  assert.ok(m, `unparseable colour ${color}`);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Number(m[4]) };
}

/** `fg` (possibly translucent) painted over the opaque `bg`, as `#RRGGBB`. */
function over(fg, bg) {
  const f = parse(fg);
  const b = parse(bg);
  const mix = (x, y) => Math.round(x * f.a + y * (1 - f.a)).toString(16).padStart(2, '0');
  return `#${mix(f.r, b.r)}${mix(f.g, b.g)}${mix(f.b, b.b)}`;
}

/** WCAG 2.x relative luminance of an opaque colour. */
function luminance(color) {
  const { r, g, b } = parse(color);
  const [R, G, B] = [r, g, b]
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const t = loadTheme();
const PALETTES = [['dark', t.dark], ['light', t.light]];
const BACKGROUNDS = ['bg', 'surface', 'surfaceAlt'];

function assertRatio(ratio, min, what) {
  assert.ok(ratio >= min, `${what} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
}

test('every text token meets WCAG AA (4.5:1) on every background, in both palettes', () => {
  for (const [name, p] of PALETTES) {
    for (const fg of ['text', 'textStrong', 'textMuted', 'textFaint']) {
      for (const bg of BACKGROUNDS) assertRatio(contrast(p[fg], p[bg]), 4.5, `${name}.${fg} on ${name}.${bg}`);
    }
  }
});

test('faint text is at least 5.5:1 on bg and surface, in both palettes (R-31)', () => {
  for (const [name, p] of PALETTES) {
    for (const bg of ['bg', 'surface']) assertRatio(contrast(p.textFaint, p[bg]), 5.5, `${name}.textFaint on ${name}.${bg}`);
  }
});

test('faint stays a visible step quieter than muted, so the hierarchy survives', () => {
  for (const [name, p] of PALETTES) {
    for (const bg of BACKGROUNDS) {
      const muted = contrast(p.textMuted, p[bg]);
      const faint = contrast(p.textFaint, p[bg]);
      assert.ok(muted / faint >= 1.1, `${name} on ${bg}: muted ${muted.toFixed(2)} vs faint ${faint.toFixed(2)}`);
    }
  }
});

test('a cancelled lesson stays readable: struck text and its badge meet AA on cancelSoft (R-31)', () => {
  for (const [name, p] of PALETTES) {
    for (const base of BACKGROUNDS) {
      // The row is tinted `cancelSoft` over the screen or card behind it.
      const row = over(p.cancelSoft, p[base]);
      // Struck subject: textFaint in the day list (timeline), textMuted in the week grid.
      for (const fg of ['textFaint', 'textMuted', 'cancel']) {
        assertRatio(contrast(p[fg], row), 4.5, `${name}.${fg} on cancelSoft over ${base}`);
      }
      // The "בוטל" badge is tinted `cancelSoft` again, on top of the tinted row.
      assertRatio(contrast(p.cancel, over(p.cancelSoft, row)), 4.5, `${name}.cancel on doubled cancelSoft over ${base}`);
    }
  }
});

test('status colours used as text meet AA on bg and on their own soft tint', () => {
  for (const [name, p] of PALETTES) {
    for (const status of ['accent', 'change', 'cancel', 'exam', 'ok']) {
      const soft = p[`${status}Soft`];
      for (const base of ['bg', 'surface']) {
        assertRatio(contrast(p[status], p[base]), 4.5, `${name}.${status} on ${name}.${base}`);
        assertRatio(contrast(p[status], over(soft, p[base])), 4.5, `${name}.${status} on ${status}Soft over ${base}`);
      }
    }
  }
});

test('resolveScheme: a chosen scheme wins; "system" follows the phone, and light when it says nothing (plan §16)', () => {
  for (const device of ['light', 'dark', null, undefined, 'unspecified']) {
    assert.equal(t.resolveScheme('light', device), 'light', `light on a ${device} phone`);
    assert.equal(t.resolveScheme('dark', device), 'dark', `dark on a ${device} phone`);
  }
  assert.equal(t.resolveScheme('system', 'light'), 'light');
  assert.equal(t.resolveScheme('system', 'dark'), 'dark');
  assert.equal(t.resolveScheme('system', null), 'light');
  assert.equal(t.resolveScheme('system', undefined), 'light');
  assert.equal(t.resolveScheme('system', 'unspecified'), 'light');
});

test('paletteFor and the stored preference values', () => {
  assert.equal(t.paletteFor('light'), t.light);
  assert.equal(t.paletteFor('dark'), t.dark);
  assert.deepEqual([...t.THEME_PREFERENCES].sort(), ['dark', 'light', 'system']);
  for (const v of t.THEME_PREFERENCES) assert.ok(t.isThemePreference(v), v);
  for (const v of [undefined, null, '', 'auto', 'Dark', 1, true]) assert.ok(!t.isThemePreference(v), String(v));
});

test('focus is the accent colour', () => {
  assert.equal(t.dark.focus, t.dark.accent);
  assert.equal(t.light.focus, t.light.accent);
});

test('the type scale: one step above Heebo\'s for Assistant (plan §16), never below the 12px floor (R-31)', () => {
  assert.equal(t.MIN_FONT_SIZE, 12);
  assert.deepEqual({ ...t.type }, { caption: 14, small: 15, label: 15, body: 16, title: 18, heading: 21, display: 30 });
  for (const [k, v] of Object.entries(t.type)) assert.ok(v >= t.MIN_FONT_SIZE, `type.${k} = ${v}`);
  // Ascending, so a "smaller" token never reads larger.
  const sizes = Object.values(t.type);
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] >= sizes[i - 1], `type scale out of order at ${i}`);
  // The smallest step is the caption.
  assert.equal(Math.min(...sizes), t.type.caption);
});

test('text scale: three steps, each with a label; sizes round to the half point and honour a cap', () => {
  assert.deepEqual(Object.keys(t.TEXT_SCALES), ['normal', 'large', 'xlarge']);
  assert.deepEqual(Object.keys(t.TEXT_SCALE_LABELS), Object.keys(t.TEXT_SCALES));
  assert.equal(t.TEXT_SCALES.normal, 1);
  assert.equal(t.scaledSize(14, 1), 14);
  assert.equal(t.scaledSize(14, 1.3), 18);
  assert.equal(t.scaledSize(13, 1.3, 1.15), 15);
  assert.equal(t.scaledSize(13, 1.15, 1.3), 15);
  assert.ok(t.isTextScale('large'));
  assert.ok(!t.isTextScale('huge'));
  assert.ok(!t.isTextScale(undefined));
});

test('the notebook fills exist in both palettes: the margin line is translucent, the highlighter translucent on the white page (plan §16)', () => {
  for (const [name, p] of PALETTES) {
    for (const k of ['margin', 'mark', 'onMark', 'accentFill', 'onAccentFill']) assert.ok(typeof p[k] === 'string', `${name}.${k}`);
    assert.ok(parse(p.margin).a < 1, `${name}.margin is translucent`);
  }
  assert.ok(parse(t.light.mark).a < 1, 'light.mark is translucent');
});

test('the highlighter stays yellow on the ink page: dark mark over bg is light, not olive (Wave 9 re-rate)', () => {
  const p = t.dark;
  for (const base of ['bg', 'surface', 'surfaceAlt']) {
    const seen = over(p.mark, p[base]);
    assert.ok(luminance(seen) >= 0.4, `dark.mark over ${base} is ${seen}, luminance ${luminance(seen).toFixed(3)}`);
    // Yellow: red and green well above blue.
    const { r, g, b } = parse(seen);
    assert.ok(r - b >= 100 && g - b >= 80, `dark.mark over ${base} is ${seen}, not yellow`);
  }
});

test('onMark on mark is AA over the page and the raised surface, in both palettes', () => {
  for (const [name, p] of PALETTES) {
    for (const base of BACKGROUNDS) {
      assertRatio(contrast(p.onMark, over(p.mark, p[base])), 4.5, `${name}.onMark on mark over ${base}`);
    }
  }
});

test('a filled control: onAccentFill on accentFill is AA, and the fill stands 3:1 off the page', () => {
  for (const [name, p] of PALETTES) {
    assert.equal(parse(p.accentFill).a, 1, `${name}.accentFill is opaque`);
    assertRatio(contrast(p.onAccentFill, p.accentFill), 4.5, `${name}.onAccentFill on accentFill`);
    for (const base of BACKGROUNDS) assertRatio(contrast(p.accentFill, p[base]), 3, `${name}.accentFill on ${base}`);
  }
  // On the white page the fill is the pen itself.
  assert.equal(t.light.accentFill, t.light.accent);
  assert.equal(t.light.onAccentFill, t.light.onAccent);
});

test('text on the exam and change highlighters stays AA, in both palettes (a Mark draws `text` by default)', () => {
  for (const [name, p] of PALETTES) {
    for (const soft of ['examSoft', 'changeSoft', 'okSoft']) {
      for (const base of ['bg', 'surface', 'surfaceAlt']) {
        for (const fg of ['text', 'textMuted']) {
          assertRatio(contrast(p[fg], over(p[soft], p[base])), 4.5, `${name}.${fg} on ${soft} over ${base}`);
        }
      }
    }
  }
});

test('Secular One is the display face, and every other role is Assistant (plan §16)', () => {
  assert.equal(t.font.display, 'SecularOne_400Regular');
  for (const [k, v] of Object.entries(t.font)) if (k !== 'display') assert.match(v, /^Assistant_/, `font.${k}`);
});

test('run 8: the month key\'s marks stand off the page: a task\'s ring and homework\'s square 3:1, an exam on the yellow', () => {
  for (const [name, p] of PALETTES) {
    for (const base of BACKGROUNDS) {
      // A shape needs 3:1 (WCAG 1.4.11): the task's ring is `ok`, the homework square `homeworkMark`.
      assertRatio(contrast(p.ok, p[base]), 3, `${name}.ok (a task's ring) on ${base}`);
      assertRatio(contrast(p.homeworkMark, p[base]), 3, `${name}.homeworkMark on ${base}`);
      // An exam day's number and the key's exam swatch are the yellow highlighter, read in onMark.
      assertRatio(contrast(p.onMark, over(p.mark, p[base])), 4.5, `${name}.onMark on mark over ${base}`);
    }
  }
});
