const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/** Loads a TypeScript module of app/src under plain Node (its imports here are types only, or theme.ts). */
function load(file) {
  const { code } = transformFileSync(file, {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  const req = (spec) => (spec.startsWith('.') ? load(`${path.resolve(path.dirname(file), spec)}.ts`) : require(spec));
  new Function('module', 'exports', 'require', code)(module, module.exports, req);
  return module.exports;
}

const src = path.join(__dirname, '../src');
const { fieldLook, FIELD_RADIUS } = load(path.join(src, 'components/fieldLook.ts'));
const theme = load(path.join(src, 'theme.ts'));

for (const [name, p] of [['light', theme.light], ['dark', theme.dark]]) {
  test(`fieldLook (${name}): a field is filled, ruled under, radius 6, and nothing else (plan §16)`, () => {
    const f = fieldLook(p);
    assert.equal(FIELD_RADIUS, 6);
    assert.equal(f.backgroundColor, p.surfaceAlt);
    assert.equal(f.borderRadius, 6);
    assert.equal(f.borderWidth, 0);
    assert.equal(f.borderBottomWidth, 1);
    assert.equal(f.borderColor, p.border);
    // Back to solid after a dashed state: RN keeps the last border style otherwise.
    assert.equal(f.borderStyle, 'solid');
    assert.equal(fieldLook(p, { focused: true }).borderColor, p.accent);
  });

  test(`fieldLook (${name}): the owner's value is dashed on all four sides, so Android draws the dashes`, () => {
    const f = fieldLook(p, { dashed: true });
    assert.equal(f.borderStyle, 'dashed');
    assert.equal(f.borderWidth, 1.5);
    assert.equal(f.borderBottomWidth, undefined);
    assert.equal(f.borderColor, p.textMuted);
    assert.equal(f.backgroundColor, p.surfaceAlt);
    assert.equal(fieldLook(p, { dashed: true, focused: true }).borderColor, p.accent);
  });
}
