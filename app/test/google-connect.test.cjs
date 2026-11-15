const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/**
 * `google/connect.ts` with its two steps stubbed: Google's sign-in and the
 * first read. Every step is recorded in order. `readResult` is what the read
 * answers when it finishes: nothing, for a phone that never signed in.
 */
const steps = [];
let signIn = async () => ({ kind: 'ok', email: 'a@b.c' });
let readResult = null;
let finishRead = () => {};

function load() {
  const { code } = transformFileSync(path.join(__dirname, '../src/google/connect.ts'), {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const stubs = {
    './phone': { signInToGoogle: async () => { steps.push('sign-in'); return signIn(); } },
    './run': {
      syncGoogleNow: (opts) => {
        steps.push(`read ${JSON.stringify(opts)}`);
        return new Promise((resolve) => { finishRead = () => { steps.push('read done'); resolve(readResult); }; });
      },
    },
  };
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, (spec) => stubs[spec]);
  return module.exports;
}

const { connectGoogle } = load();

test('connectGoogle: says it is signed in before the first read, not after it', async () => {
  steps.length = 0;
  signIn = async () => ({ kind: 'ok', email: 'a@b.c' });
  const done = connectGoogle(() => steps.push('signed in'));
  await new Promise((r) => setImmediate(r));
  // The read is still running, and the screens were already told.
  assert.deepEqual(steps, ['sign-in', 'signed in', 'read {"force":true}']);
  finishRead();
  assert.equal(await done, true);
  assert.deepEqual(steps.slice(-1), ['read done']);
});

test('connectGoogle: backing out of Google tells no one and reads nothing', async () => {
  steps.length = 0;
  signIn = async () => ({ kind: 'cancelled' });
  assert.equal(await connectGoogle(() => steps.push('signed in')), false);
  assert.deepEqual(steps, ['sign-in']);
});

test('connectGoogle: works without anyone to tell', async () => {
  steps.length = 0;
  signIn = async () => ({ kind: 'ok', email: 'a@b.c' });
  const done = connectGoogle();
  await new Promise((r) => setImmediate(r));
  finishRead();
  assert.equal(await done, true);
  assert.deepEqual(steps, ['sign-in', 'read {"force":true}', 'read done']);
});

/** A sign-in and a first read that answers `result`, with someone listening for the tasks that moved. */
async function connectWithRead(result) {
  steps.length = 0;
  signIn = async () => ({ kind: 'ok', email: 'a@b.c' });
  readResult = result;
  try {
    const done = connectGoogle(() => steps.push('signed in'), (count) => steps.push(`moved ${count}`));
    await new Promise((r) => setImmediate(r));
    // Nothing is said while the read is still running.
    assert.deepEqual(steps, ['sign-in', 'signed in', 'read {"force":true}']);
    finishRead();
    assert.equal(await done, true);
  } finally {
    readResult = null;
  }
  return steps.slice(3);
}

test('connectGoogle: says how many tasks moved, after the read and before it resolves', async () => {
  assert.deepEqual(await connectWithRead({ kind: 'ok', counts: {}, moved: 2 }), ['read done', 'moved 2']);
});

test('connectGoogle: says nothing when no task moved, or the read gave nothing to go by', async () => {
  assert.deepEqual(await connectWithRead({ kind: 'ok', counts: {}, moved: 0 }), ['read done']);
  assert.deepEqual(await connectWithRead({ kind: 'ok', counts: {} }), ['read done']);
  assert.deepEqual(await connectWithRead({ kind: 'failed', error: 'Google 500' }), ['read done']);
  assert.deepEqual(await connectWithRead(null), ['read done']);
});
