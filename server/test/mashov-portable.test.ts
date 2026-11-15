/**
 * The Mashov session helpers now run on the phone too (plan Phase 2c), where
 * there is no Node `Buffer`: the token's payload is decoded by hand. It has to
 * agree with Node byte for byte, Hebrew included.
 */
import { describe, expect, it } from 'vitest';
import { base64UrlToUtf8, parseMashovToken } from '@sederyom/shared/logic/mashov/session';

describe('base64UrlToUtf8', () => {
  it('decodes what Node encodes, padded or not, Hebrew and all', () => {
    for (const text of ['', 'a', 'ab', 'abc', '{"UserId":"x"}', 'שלום, משוב', '🙂 ~?>', 'x'.repeat(301)]) {
      const encoded = Buffer.from(text, 'utf8').toString('base64url');
      expect(base64UrlToUtf8(encoded)).toBe(text);
      expect(base64UrlToUtf8(Buffer.from(text, 'utf8').toString('base64'))).toBe(text);
    }
  });

  it('refuses what is not base64', () => {
    expect(() => base64UrlToUtf8('not base64!')).toThrow();
  });
});

describe('parseMashovToken without Buffer', () => {
  it('reads the user, the school and the expiry, and nothing personal', () => {
    // As Mashov writes them: Semel and Year are strings.
    const payload = { UserId: 'user-1', Semel: '123456', Year: '2027', iat: 1_790_000_000, exp: 1_790_003_600, IdNumber: '000000000', Name: 'שם' };
    const jwt = `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;
    const info = parseMashovToken(`a=1; MashovAuthToken=${jwt}; b=2`)!;
    expect(info.userId).toBe('user-1');
    expect(info.schoolId).toBe('123456');
    expect(info.expiresAt?.getTime()).toBe(1_790_003_600_000);
    expect(JSON.stringify(info)).not.toContain('000000000');
  });
});
