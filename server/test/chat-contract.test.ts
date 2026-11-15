/**
 * The chat connection's shared contract (shared/src/chat.ts, chatCrypto.ts):
 * the code a student reads out to a chat, the hosts a chat may come from, the
 * sealing of the snapshot the phone writes, and the shape of the tokens a chat
 * holds. Pure, so the tests run it in node with tweetnacl's own random source.
 */
import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';
import {
  CHAT_CODE_ALPHABET,
  CHAT_CODE_LENGTH,
  DEFAULT_CHAT_SHARES,
  chatHash,
  formatChatCode,
  formatChatToken,
  isKnownChatHost,
  normalizeChatCode,
  openChat,
  parseChatToken,
  sealChat,
} from '@sederyom/shared';

const key = (): Uint8Array => nacl.randomBytes(32);

describe('chat codes', () => {
  it('reads a code however a person typed it', () => {
    expect(normalizeChatCode(' k7qm-2xpa ')).toBe('K7QM2XPA');
    expect(normalizeChatCode('K7QM 2XPA')).toBe('K7QM2XPA');
    expect(normalizeChatCode('K7QM2XPA')).toBe('K7QM2XPA');
  });

  it('refuses what is not a code', () => {
    expect(normalizeChatCode('K7QM2XP0')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeChatCode('K7QM2XPI')).toBeNull(); // nor I
    expect(normalizeChatCode('K7QM2XP')).toBeNull(); // 7 characters
    expect(normalizeChatCode('K7QM2XPAA')).toBeNull(); // 9 characters
    expect(normalizeChatCode('')).toBeNull();
    expect(normalizeChatCode('אבגדהוזח')).toBeNull();
  });

  it('shows a code as two groups of four', () => {
    expect(formatChatCode('K7QM2XPA')).toBe('K7QM-2XPA');
  });

  it('has an alphabet without the look-alikes, 8 long', () => {
    expect(CHAT_CODE_LENGTH).toBe(8);
    expect(CHAT_CODE_ALPHABET).toHaveLength(32);
    for (const c of '01OIl') expect(CHAT_CODE_ALPHABET).not.toContain(c);
  });
});

describe('known chat hosts', () => {
  it('knows the five, by exact host', () => {
    for (const host of ['chatgpt.com', 'chat.openai.com', 'claude.ai', 'claude.com', 'gemini.google.com']) {
      expect(isKnownChatHost(host)).toBe(true);
    }
  });

  it('does not take a host that only starts or ends like one', () => {
    expect(isKnownChatHost('chatgpt.com.evil.io')).toBe(false);
    expect(isKnownChatHost('evil.chatgpt.com')).toBe(false);
    expect(isKnownChatHost('notclaude.ai')).toBe(false);
    expect(isKnownChatHost('google.com')).toBe(false);
    expect(isKnownChatHost('')).toBe(false);
  });
});

describe('default shares', () => {
  it('shares homework and nothing else', () => {
    expect(DEFAULT_CHAT_SHARES).toEqual({
      homework: true,
      grades: false,
      bagrut: false,
      absences: false,
      messages: false,
    });
  });
});

describe('sealing a snapshot', () => {
  it('opens with the key it was sealed with', () => {
    const k = key();
    expect(openChat(sealChat({ a: 1, b: 'שלום' }, k), k)).toEqual({ a: 1, b: 'שלום' });
  });

  it('gives null for another key, a changed byte, or text that is not a box', () => {
    const k = key();
    const sealed = sealChat({ a: 1 }, k);
    expect(openChat(sealed, key())).toBeNull();
    expect(openChat('garbage', k)).toBeNull();
    expect(openChat('', k)).toBeNull();
    const flipped = (sealed[40] === 'A' ? 'B' : 'A');
    expect(openChat(sealed.slice(0, 40) + flipped + sealed.slice(41), k)).toBeNull();
    expect(openChat(sealed, new Uint8Array(5))).toBeNull(); // not a 32-byte key
  });

  it('seals the same value to a different text each time', () => {
    const k = key();
    expect(sealChat({ a: 1 }, k)).not.toBe(sealChat({ a: 1 }, k));
  });

  it('writes base64url, nothing else', () => {
    expect(sealChat({ a: 1 }, key())).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('the hash of a snapshot', () => {
  it('ignores when it was taken', () => {
    expect(chatHash({ at: 'x', a: 1 })).toBe(chatHash({ at: 'y', a: 1 }));
  });

  it('changes with what is in it', () => {
    expect(chatHash({ at: 'x', a: 1 })).not.toBe(chatHash({ at: 'x', a: 2 }));
  });

  it('is sha512 as hex', () => {
    expect(chatHash({ at: 'x', a: 1 })).toMatch(/^[0-9a-f]{128}$/);
  });
});

describe('chat tokens', () => {
  it('carries a kind, an id and the key', () => {
    const k = key();
    const parsed = parseChatToken(formatChatToken('refresh', 'abc123', k));
    expect(parsed?.kind).toBe('refresh');
    expect(parsed?.id).toBe('abc123');
    expect(Array.from(parsed?.key ?? [])).toEqual(Array.from(k));
    expect(parseChatToken(formatChatToken('access', 'abc123', k))?.kind).toBe('access');
  });

  it('starts with sya_ for access and syr_ for refresh', () => {
    const k = key();
    expect(formatChatToken('access', 'abc', k)).toMatch(/^sya_abc\.[A-Za-z0-9_-]{43}$/);
    expect(formatChatToken('refresh', 'abc', k)).toMatch(/^syr_abc\.[A-Za-z0-9_-]{43}$/);
  });

  it('refuses what is not a token', () => {
    const k = key();
    expect(parseChatToken('sya_abc')).toBeNull();
    expect(parseChatToken('')).toBeNull();
    expect(parseChatToken('xyz_abc.' + 'A'.repeat(43))).toBeNull();
    expect(parseChatToken('sya_.' + 'A'.repeat(43))).toBeNull(); // no id
    expect(parseChatToken(formatChatToken('access', 'abc', k) + '.x')).toBeNull();
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(parseChatToken(formatChatToken('access', 'abc', new Uint8Array(5)))).toBeNull();
    expect(parseChatToken('sya_abc.' + 'A'.repeat(42))).toBeNull(); // 31 bytes
    expect(parseChatToken('sya_abc.' + 'A'.repeat(44))).toBeNull(); // 33 bytes
    expect(parseChatToken('sya_abc.' + 'A'.repeat(43))).not.toBeNull(); // 32 zero bytes (a demo grant)
    expect(parseChatToken('sya_abc.' + 'A'.repeat(42) + 'B')).toBeNull(); // spare bits not zero
  });
});
