const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transformFileSync } = require('@babel/core');
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

const { swipeStep, SWIPE_IDLE } = load('lib/tabSwipe.ts');

const start = (index, at) => ({ type: 'start', index, at });
const end = (at) => ({ type: 'end', at });
const index = (i, at) => ({ type: 'index', index: i, at });

/** How many ticks a run of the pager's events makes. */
function ticks(events) {
  let track = SWIPE_IDLE;
  let count = 0;
  for (const event of events) {
    const step = swipeStep(track, event);
    track = step.track;
    if (step.tick) count += 1;
  }
  return count;
}

test('a swipe that lands on the next page ticks once', () => {
  assert.equal(ticks([start(0, 0), index(1, 300), end(400)]), 1);
});

test('iOS order, idle before the selection, still ticks', () => {
  assert.equal(ticks([start(0, 0), end(300), index(1, 350)]), 1);
});

test('a repeated start or end still makes one tick', () => {
  const starts = Array.from({ length: 5 }, () => start(0, 0));
  const ends = Array.from({ length: 5 }, () => end(400));
  assert.equal(ticks([...starts, index(1, 300), ...ends]), 1);
});

test('a tap or a deep link never ticks', () => {
  assert.equal(ticks([index(2, 0), index(4, 1000)]), 0);
});

test('a swipe that springs back does not tick, nor a deep link after it', () => {
  assert.equal(ticks([start(1, 0), end(300), index(4, 2300)]), 0);
});

test('a second swipe after the first ticks again', () => {
  assert.equal(ticks([start(0, 0), index(1, 300), end(350), start(1, 1000), index(2, 1300), end(1350)]), 2);
});

test('a tap soon after a swipe that sprang back does not tick', () => {
  assert.equal(ticks([start(1, 0), end(300), { type: 'tap', at: 450 }, index(4, 500)]), 0);
});
