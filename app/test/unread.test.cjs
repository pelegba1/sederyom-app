const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

function loadUnread() {
  const { code } = transformFileSync(path.join(__dirname, '../src/lib/unread.ts'), {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

const u = loadUnread();
const log = [
  { sentAt: '2026-10-08T04:00:00.000Z' },
  { sentAt: '2026-10-08T13:06:00.000Z' },
  { sentAt: '2026-10-08T17:00:00.000Z' },
];

test('countUnread: only what was sent after the log was last opened (W5-F)', () => {
  assert.equal(u.countUnread(log, '2026-10-08T12:00:00.000Z'), 2);
  assert.equal(u.countUnread(log, '2026-10-08T17:00:00.000Z'), 0, 'sent at the very moment it was opened is seen');
  assert.equal(u.countUnread(log, '2026-10-01T00:00:00.000Z'), 3);
  assert.equal(u.countUnread([], '2026-10-01T00:00:00.000Z'), 0);
  assert.equal(u.countUnread(log, 'not a date'), 0, 'an unreadable time shows nothing rather than everything');
});

test('unreadBadge and bellLabel: a count up to nine, then "9+"; the label says it in words', () => {
  assert.equal(u.unreadBadge(0), null);
  assert.equal(u.unreadBadge(3), '3');
  assert.equal(u.unreadBadge(12), '9+');
  assert.equal(u.bellLabel(0), 'יומן התראות');
  assert.equal(u.bellLabel(1), 'יומן התראות, התראה חדשה אחת');
  assert.equal(u.bellLabel(4), 'יומן התראות, 4 התראות חדשות');
});
