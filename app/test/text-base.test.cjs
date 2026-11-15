const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/**
 * The iPhone's right-to-left text (2026-11-05: a tester's "היום שלי" had
 * "הפסקה", "אין שינויים היום" and the teacher lines on the left). iOS gives a
 * paragraph with no direction the direction of the phone's language, not the
 * app's forced RTL, so on a phone in English every full-width line sat on the
 * left. `components/ui`'s `Text` and `TextInput` put an iOS-only base first in
 * their style, which every style of the caller's overrides.
 */
function loadTextBase() {
  const { code } = transformFileSync(path.join(__dirname, '../src/lib/textBase.ts'), {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

const t = loadTextBase();

test('iOS text: a right-to-left paragraph, and "left", which React Native swaps to the right under RTL', () => {
  assert.deepEqual(t.textBase('ios', 'text'), { writingDirection: 'rtl', textAlign: 'left' });
});

test('iOS input: right-to-left and physically right (an input gets no RTL swap)', () => {
  assert.deepEqual(t.textBase('ios', 'input'), { writingDirection: 'rtl', textAlign: 'right' });
});

test('Android and the web preview get no base: Android reads a paragraph by its first letter already', () => {
  for (const os of ['android', 'web']) {
    assert.equal(t.textBase(os, 'text'), null);
    assert.equal(t.textBase(os, 'input'), null);
  }
});

test('the base comes first, so a caller\'s textAlign or writingDirection wins', () => {
  const base = t.textBase('ios', 'text');
  const own = { textAlign: 'center' };
  assert.deepEqual(t.withTextBase(base, own), [base, own]);
  assert.equal(t.withTextBase(null, own), own);
  assert.equal(t.withTextBase(base, undefined), base);
});

test('ui.tsx draws Text and TextInput over the base', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../src/components/ui.tsx'), 'utf8');
  assert.match(ui, /<RNText ref=\{ref\} \{\.\.\.rest\} style=\{withTextBase\(TEXT_BASE, scaleTextStyle\(style, factor, maxScale\)\)\}/);
  assert.match(ui, /<RNTextInput ref=\{ref\} \{\.\.\.rest\} style=\{withTextBase\(INPUT_BASE, scaleTextStyle\(style, factor, maxScale\)\)\}/);
});
