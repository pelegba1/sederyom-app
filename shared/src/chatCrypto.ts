/**
 * Sealing of the chat snapshot and the shape of a chat's tokens
 * (docs/superpowers/specs/2026-11-04-chat-connection-design.md, 4.1 and 4.2).
 *
 * The phone seals the snapshot with K (32 random bytes, XSalsa20-Poly1305 via
 * `tweetnacl`) and the server keeps only the ciphertext. K travels in the
 * chat's tokens, so the server can open a snapshot only while a chat's request
 * is in hand. Pure, so it runs in node and in Hermes: `tweetnacl` only,
 * `TextEncoder`/`TextDecoder` for UTF-8, no `Buffer`, no `node:crypto`.
 */
import nacl from 'tweetnacl';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const NONCE = 24;
const TAG = 16;
const KEY = 32;

// The same base64url as app/src/buddies/crypto.ts (shared never imports the app).

/** Bytes as base64url, with no padding. */
export function toB64u(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2]! + ALPHABET[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 !== undefined) out += ALPHABET[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]!;
    if (b2 !== undefined) out += ALPHABET[b2 & 63]!;
  }
  return out;
}

/**
 * base64url as bytes; `null` for anything `toB64u` would not have written: other
 * characters, padding, a length no bytes give, or spare bits that are not zero.
 */
export function fromB64u(text: string): Uint8Array | null {
  if (typeof text !== 'string' || text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < text.length; i += 1) {
    const value = ALPHABET.indexOf(text[i]!);
    if (value < 0) return null;
    buffer = ((buffer << 6) | value) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (buffer >> bits) & 0xff;
      at += 1;
    }
  }
  return (buffer & ((1 << bits) - 1)) === 0 ? out : null;
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** `value` as JSON, sealed with `key` (32 bytes): a new random nonce (24 bytes) then the box, as base64url. */
export function sealChat(value: unknown, key: Uint8Array): string {
  const nonce = nacl.randomBytes(NONCE);
  return toB64u(concat(nonce, nacl.secretbox(utf8(JSON.stringify(value) ?? 'null'), nonce, key)));
}

/** What `sealChat` made, opened with the same key; `null` for anything else (another key, a changed byte, not a box). */
export function openChat<T>(ciphertext: string, key: Uint8Array): T | null {
  try {
    const bytes = fromB64u(ciphertext);
    if (!bytes || bytes.length < NONCE + TAG) return null;
    const plain = nacl.secretbox.open(bytes.subarray(NONCE), bytes.subarray(0, NONCE), key);
    return plain ? (JSON.parse(new TextDecoder().decode(plain)) as T) : null;
  } catch {
    return null;
  }
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * SHA-512 of `value` as JSON, without its top-level `at`, as hex: the same
 * content taken at another time hashes the same. It follows the order the
 * keys were written in, so the same code must make both snapshots.
 */
export function chatHash(value: unknown): string {
  let content = value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const { at: _at, ...rest } = value as Record<string, unknown>;
    content = rest;
  }
  return hex(nacl.hash(utf8(JSON.stringify(content) ?? 'null')));
}

const TOKEN_PREFIX = { access: 'sya', refresh: 'syr' } as const;
const TOKEN = /^(sya|syr)_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

/** A chat's token: 'sya_<id>.<K>' (access) or 'syr_<id>.<K>' (refresh), K as base64url. */
export function formatChatToken(kind: 'access' | 'refresh', id: string, key: Uint8Array): string {
  return `${TOKEN_PREFIX[kind]}_${id}.${toB64u(key)}`;
}

/** The kind, id and key of a token `formatChatToken` made; `null` for anything else, or a key that is not 32 bytes. */
export function parseChatToken(token: string): { kind: 'access' | 'refresh'; id: string; key: Uint8Array } | null {
  if (typeof token !== 'string') return null;
  const match = TOKEN.exec(token);
  if (!match) return null;
  const key = fromB64u(match[3]!);
  if (!key || key.length !== KEY) return null;
  return { kind: match[1] === 'sya' ? 'access' : 'refresh', id: match[2]!, key };
}
