const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

function load(file) {
  const { code } = transformFileSync(path.join(__dirname, '../src/lib', file), {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

const t = load('timeOfDay.ts');

test('isValidTime: exactly what PUT /settings accepts', () => {
  for (const ok of ['00:00', '07:00', '19:30', '23:59']) assert.equal(t.isValidTime(ok), true, ok);
  for (const bad of ['24:00', '7:00', '07:60', '07:5', '0700', '', ' 07:00', '07:00 ']) assert.equal(t.isValidTime(bad), false, bad);
});

test('normalizeTime: what people type becomes HH:mm, or null', () => {
  assert.equal(t.normalizeTime('7'), '07:00');
  assert.equal(t.normalizeTime('7:30'), '07:30');
  assert.equal(t.normalizeTime('07:30'), '07:30');
  assert.equal(t.normalizeTime('7.30'), '07:30');
  assert.equal(t.normalizeTime(' 19 30 '), '19:30');
  assert.equal(t.normalizeTime('730'), '07:30');
  assert.equal(t.normalizeTime('0730'), '07:30');
  assert.equal(t.normalizeTime('2359'), '23:59');
  for (const bad of ['24:00', '7:60', '2400', 'abc', '', '7:5', '123456']) assert.equal(t.normalizeTime(bad), null, bad);
  // Whatever it returns, the server accepts.
  for (const input of ['7', '7:30', '730', '23:59', '0:00']) assert.equal(t.isValidTime(t.normalizeTime(input)), true, input);
});

test('splitTime / joinTime round-trip, and refuse out-of-range values', () => {
  assert.deepEqual(t.splitTime('07:45'), { hour: 7, minute: 45 });
  assert.equal(t.splitTime('25:00'), null);
  assert.equal(t.joinTime(7, 5), '07:05');
  assert.equal(t.joinTime(23, 59), '23:59');
  assert.equal(t.joinTime(24, 0), null);
  assert.equal(t.joinTime(7, 60), null);
  assert.equal(t.joinTime(7.5, 0), null);
});

test('minuteOptions: five-minute steps, plus an off-step stored minute', () => {
  assert.deepEqual(t.minuteOptions(null), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  assert.deepEqual(t.minuteOptions(30), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  assert.deepEqual(t.minuteOptions(42, 15), [0, 15, 30, 42, 45]);
});

test('isWithinQuietHours: wraps past midnight, end exclusive, equal ends mean none', () => {
  assert.equal(t.isWithinQuietHours('23:30', '23:00', '06:30'), true);
  assert.equal(t.isWithinQuietHours('03:00', '23:00', '06:30'), true);
  assert.equal(t.isWithinQuietHours('06:30', '23:00', '06:30'), false);
  assert.equal(t.isWithinQuietHours('20:00', '23:00', '06:30'), false);
  assert.equal(t.isWithinQuietHours('20:00', '19:00', '21:00'), true);
  assert.equal(t.isWithinQuietHours('21:00', '19:00', '21:00'), false);
  assert.equal(t.isWithinQuietHours('12:00', '08:00', '08:00'), false);
});
