/**
 * The app's friends crypto and link (app/src/buddies/crypto.ts, link.ts): box
 * ids and keys derived from a pairing secret, secretbox and box sealing of what
 * goes in a box, and the invite link. Both modules are pure; the tests run them
 * in node with tweetnacl's own random source (`random.ts`, which gives the
 * phone one, is never imported).
 */
import { describe, expect, it } from 'vitest';

const {
  b64u, boxIdOf, contentHash, fromB64u, isPairingSecret, keyOf, newKeyPair, newSecret, openFrom, openSealed, seal, sealTo,
} = await import('../../app/src/buddies/crypto');
const { buddyOf, buddyUrl } = await import('../../app/src/buddies/link');

const BOX_ID = /^[A-Za-z0-9_-]{22}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const LABELS = ['invite', 'reply', 'a2b', 'b2a'] as const;

describe('base64url', () => {
  it('round-trips bytes of every length, with no padding', () => {
    for (let n = 0; n <= 70; n += 1) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      const text = b64u(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(text).toBe(Buffer.from(bytes).toString('base64url'));
      expect(fromB64u(text)).toEqual(bytes);
    }
  });

  it('reads nothing that is not exactly what it writes', () => {
    expect(fromB64u('ab+/')).toBeNull();
    expect(fromB64u('ab=')).toBeNull();
    expect(fromB64u('a')).toBeNull();
    expect(fromB64u('אבגד')).toBeNull();
    // 43 characters carry 32 bytes and two spare bits, which must be zero.
    expect(fromB64u('A'.repeat(42) + 'A')).toHaveLength(32);
    expect(fromB64u('A'.repeat(42) + 'B')).toBeNull();
  });
});

describe('the pairing secret', () => {
  it('is 32 random bytes in 43 base64url characters, a new one each time', () => {
    const a = newSecret();
    expect(a).toMatch(SECRET);
    expect(fromB64u(a)).toHaveLength(32);
    expect(newSecret()).not.toBe(a);
  });

  it('derives the same ids and key from the same secret, and different ones per label', () => {
    const s = newSecret();
    const other = newSecret();
    const ids = LABELS.map((label) => boxIdOf(s, label));
    for (const id of ids) expect(id).toMatch(BOX_ID);
    expect(LABELS.map((label) => boxIdOf(s, label))).toEqual(ids);
    expect(new Set(ids).size).toBe(LABELS.length);
    expect(LABELS.map((label) => boxIdOf(other, label))).not.toEqual(ids);

    const key = keyOf(s);
    expect(key).toHaveLength(32);
    expect(keyOf(s)).toEqual(key);
    expect(keyOf(other)).not.toEqual(key);
  });

  it('derives from the bytes, as the formula in the spec says, so another implementation agrees', () => {
    // 'sy-buddy-box|a2b|' + 32 zero bytes, SHA-512, first 16 bytes; and the key from 'sy-buddy-key|'.
    const zero = 'A'.repeat(43);
    expect(boxIdOf(zero, 'a2b')).toBe('JwvsxbjKfq48QGF_Gg82iw');
    expect(b64u(keyOf(zero))).toBe('zDMU0L6GftvP5lY7XHfdv7vtSCJyk49qMy2XUhdZtJA');
  });
});

describe('a pairing secret that is not 32 bytes', () => {
  // A peer's reply carries the secret the friends will share; a short or empty one would put the
  // boxes at an id and under a key anyone can compute, so it is refused rather than derived from.
  const wrong = ['', 'AAAA', 'A'.repeat(42), 'A'.repeat(44), 'A'.repeat(43) + 'A', 'A'.repeat(42) + '!', 'A'.repeat(42) + 'B'];

  it('derives no box id and no key from it', () => {
    for (const secret of wrong) {
      for (const label of LABELS) expect(() => boxIdOf(secret, label), `boxIdOf(${JSON.stringify(secret)})`).toThrow('invalid pairing secret');
      expect(() => keyOf(secret), `keyOf(${JSON.stringify(secret)})`).toThrow('invalid pairing secret');
    }
    expect(() => boxIdOf('', 'a2b')).toThrow();
    expect(() => keyOf('AAAA')).toThrow();
  });

  it('is told apart from a real one by the same rule the link uses', () => {
    for (const secret of wrong) expect(isPairingSecret(secret)).toBe(false);
    for (let i = 0; i < 10; i += 1) expect(isPairingSecret(newSecret())).toBe(true);
    expect(isPairingSecret('A'.repeat(43))).toBe(true);
  });
});

describe('sealing with the shared key', () => {
  it('opens what it sealed, and nothing with another key or a changed byte', () => {
    const key = keyOf(newSecret());
    const value = { v: 1, at: '2026-10-29T08:00:00.000Z', name: 'נועה', shares: { timetable: true, absences: false }, exams: [] };
    const sealed = seal(value, key);
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(openSealed<typeof value>(sealed, key)).toEqual(value);

    // Another key opens nothing.
    expect(openSealed(sealed, keyOf(newSecret()))).toBeNull();
    // A changed byte, in the nonce, the body or the tag, opens nothing.
    const bytes = fromB64u(sealed)!;
    for (const at of [0, 23, 24, 30, bytes.length - 1]) {
      const changed = bytes.slice();
      changed[at] = changed[at]! ^ 1;
      expect(openSealed(b64u(changed), key)).toBeNull();
    }
    // Cut short, not text at all, not even a nonce, or the wrong key size: nothing, and no throw.
    expect(openSealed(b64u(bytes.slice(0, bytes.length - 1)), key)).toBeNull();
    expect(openSealed('not base64url!', key)).toBeNull();
    expect(openSealed('', key)).toBeNull();
    expect(openSealed(b64u(new Uint8Array(30)), key)).toBeNull();
    expect(openSealed(sealed, new Uint8Array(5))).toBeNull();
  });

  it('seals the same value to a different text each time (a new nonce)', () => {
    const key = keyOf(newSecret());
    expect(seal({ a: 1 }, key)).not.toBe(seal({ a: 1 }, key));
  });

  it('keeps any JSON value, not only objects', () => {
    const key = keyOf(newSecret());
    for (const value of [null, 0, 'טקסט', [1, 'ב'], { nested: { list: [true] } }]) {
      expect(openSealed(seal(value, key), key)).toEqual(value);
    }
  });
});

describe('sealing to a public key', () => {
  it('opens what was sealed to a public key only with its secret key', () => {
    const pair = newKeyPair();
    expect(fromB64u(pair.publicKey)).toHaveLength(32);
    expect(fromB64u(pair.secretKey)).toHaveLength(32);

    const reply = { name: 'דנה', shares: { timetable: true, absences: true }, S2: newSecret() };
    const sealed = sealTo(reply, pair.publicKey);
    expect(openFrom<typeof reply>(sealed, pair.secretKey)).toEqual(reply);

    // Not the public key, not another pair's secret key, not a changed byte.
    expect(openFrom(sealed, pair.publicKey)).toBeNull();
    expect(openFrom(sealed, newKeyPair().secretKey)).toBeNull();
    const bytes = fromB64u(sealed)!;
    for (const at of [0, 31, 32, 55, 56, bytes.length - 1]) {
      const changed = bytes.slice();
      changed[at] = changed[at]! ^ 1;
      expect(openFrom(b64u(changed), pair.secretKey)).toBeNull();
    }
    expect(openFrom('', pair.secretKey)).toBeNull();
    expect(openFrom(sealed, 'not a key')).toBeNull();
    // Each seal uses a new ephemeral key: the same reply never looks the same twice.
    expect(sealTo(reply, pair.publicKey)).not.toBe(sealed);
  });

  it('puts the ephemeral public key (32) and the nonce (24) before the box', () => {
    const pair = newKeyPair();
    const bytes = fromB64u(sealTo({ x: 1 }, pair.publicKey))!;
    // 32 + 24 + 16 (the tag) + the 7 characters of {"x":1}.
    expect(bytes).toHaveLength(32 + 24 + 16 + 7);
    const key = keyOf(newSecret());
    expect(fromB64u(seal({ x: 1 }, key))).toHaveLength(24 + 16 + 7);
  });

  it('refuses a public key that is not one, instead of sealing to nothing', () => {
    expect(() => sealTo({ x: 1 }, 'AAAA')).toThrow();
    expect(() => sealTo({ x: 1 }, '')).toThrow();
  });
});

describe('the content hash', () => {
  it('hashes the same content the same way', () => {
    const a = { v: 1, exams: [{ date: '2026-11-02', subject: 'מתמטיקה', title: '' }], name: 'נועה' };
    const copy = JSON.parse(JSON.stringify(a)) as typeof a;
    expect(contentHash(a)).toMatch(BOX_ID);
    expect(contentHash(copy)).toBe(contentHash(a));
    expect(contentHash({ ...a, name: 'דנה' })).not.toBe(contentHash(a));
    expect(fromB64u(contentHash(a))).toHaveLength(16);
  });
});

describe('the invite link', () => {
  const S = newSecret();

  it('builds the link with the secret after #', () => {
    expect(buddyUrl('https://api.x', S)).toBe('https://api.x/b#' + S);
    expect(buddyUrl('https://api.x///', S)).toBe('https://api.x/b#' + S);
    // No server, or not a secret: no link.
    expect(buddyUrl('', S)).toBeNull();
    expect(buddyUrl('https://api.x', S.slice(1))).toBeNull();
    expect(buddyUrl('https://api.x', S + 'A')).toBeNull();
    expect(buddyUrl('https://api.x', 'x'.repeat(42) + '!')).toBeNull();
  });

  it('reads the secret from the app link only', () => {
    expect(buddyOf('sederyom://buddy?k=' + S)).toBe(S);
    expect(buddyOf('sederyom://buddy/?k=' + S)).toBe(S);
    expect(buddyOf('SEDERYOM://Buddy?k=' + S)).toBe(S);
    expect(buddyOf('sederyom://buddy?x=1&k=' + S + '&y=2')).toBe(S);
    // A 42-character secret, a 44-character one, the page's own link, the class invite, nothing.
    expect(buddyOf('sederyom://buddy?k=' + S.slice(1))).toBeNull();
    expect(buddyOf('sederyom://buddy?k=' + S + 'A')).toBeNull();
    expect(buddyOf('https://api.x/b#' + S)).toBeNull();
    expect(buddyOf('sederyom://buddy#' + S)).toBeNull();
    expect(buddyOf('https://api.x/buddy?k=' + S)).toBeNull();
    expect(buddyOf('sederyom://join?k=' + S)).toBeNull();
    expect(buddyOf('sederyom://buddy')).toBeNull();
    expect(buddyOf('sederyom://buddy?k=')).toBeNull();
    expect(buddyOf('sederyom://buddy?k=' + S.slice(0, 42) + '!')).toBeNull();
    expect(buddyOf('k=' + S)).toBeNull();
    expect(buddyOf('')).toBeNull();
    expect(buddyOf(null)).toBeNull();
  });

  it('reads back the secret it built the link from', () => {
    for (let i = 0; i < 20; i += 1) {
      const secret = newSecret();
      const web = buddyUrl('https://api.x', secret)!;
      // What buddy.html makes of /b#<secret> on Android.
      expect(buddyOf('sederyom://buddy?k=' + web.slice(web.indexOf('#') + 1))).toBe(secret);
    }
  });
});
