/**
 * What goes into a friend's box, and what a box id and its key come from
 * (docs/superpowers/specs/2026-10-29-friends-design.md, 4.2 and 4.3).
 *
 * Two people who became friends share one 32-byte pairing secret (43 base64url
 * characters). From it each derives, by SHA-512 with a label, the ids of the
 * boxes on the server (`boxIdOf`) and the one key that seals what is in them
 * (`keyOf`, XSalsa20-Poly1305). The server sees an id and ciphertext, never
 * the secret, a name or a lesson. An invite's reply is sealed to a one-off
 * public key instead (`sealTo`, X25519), so only the inviter opens it.
 *
 * Pure, so the tests run it in node and the phone in Hermes: `tweetnacl` only,
 * `TextEncoder`/`TextDecoder` for UTF-8, no `Buffer`, no `atob`. It never
 * imports `random.ts`, which gives tweetnacl its random source on the phone
 * (`expo-crypto`): the one place that does is `run.ts`.
 */
import nacl from 'tweetnacl';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const NONCE = 24;
const KEY = 32;
const TAG = 16;

/**
 * What a box id is for: the invite and its replies, one for each person who
 * answers (`replyLabel`); one box each way between friends; and one grades box
 * each way, written only while both share grades
 * (docs/superpowers/specs/2026-10-30-buddies-grades-design.md, 4.3).
 */
export type BuddyBoxLabel = 'invite' | 'reply' | `reply-${number}` | 'a2b' | 'b2a' | 'a2b-grades' | 'b2a-grades';

/** The label of a link's reply box number `slot`, from 0. The first is plain `'reply'`: the one box an older app knows. */
export const replyLabel = (slot: number): BuddyBoxLabel => (slot === 0 ? 'reply' : `reply-${slot}`);

/** Bytes as base64url, with no padding. */
export function b64u(bytes: Uint8Array): string {
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
 * base64url as bytes; `null` for anything `b64u` would not have written: other
 * characters, padding, a length no bytes give, or spare bits that are not zero.
 * So a text and its bytes are one to one.
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

const SECRET_BYTES = 32;

/** A pairing secret's bytes: base64url of exactly 32 bytes (43 characters), else `null`. */
function decodeSecret(text: string): Uint8Array | null {
  const bytes = fromB64u(text);
  return bytes && bytes.length === SECRET_BYTES ? bytes : null;
}

/**
 * Whether `text` is a pairing secret. The one rule for it, in the invite link
 * and in what a peer's reply carries alike: anything shorter would make boxes
 * whose id and key anyone can compute.
 */
export function isPairingSecret(text: string): boolean {
  return decodeSecret(text) !== null;
}

function secretBytes(secret: string): Uint8Array {
  const bytes = decodeSecret(secret);
  if (!bytes) throw new Error('invalid pairing secret');
  return bytes;
}

/** A new pairing secret: 32 random bytes, 43 base64url characters. */
export function newSecret(): string {
  return b64u(nacl.randomBytes(SECRET_BYTES));
}

/** A box's id on the server for this secret and direction: 16 bytes, 22 base64url characters. */
export function boxIdOf(secret: string, label: BuddyBoxLabel): string {
  return b64u(nacl.hash(concat(utf8(`sy-buddy-box|${label}|`), secretBytes(secret))).slice(0, 16));
}

/** The key that seals what is in the secret's boxes. */
export function keyOf(secret: string): Uint8Array {
  return nacl.hash(concat(utf8('sy-buddy-key|'), secretBytes(secret))).slice(0, KEY);
}

/** `value` as JSON, sealed with `key`: a new nonce (24 bytes) then the box, as base64url. */
export function seal(value: unknown, key: Uint8Array): string {
  const nonce = nacl.randomBytes(NONCE);
  return b64u(concat(nonce, nacl.secretbox(utf8(JSON.stringify(value) ?? 'null'), nonce, key)));
}

/** How many characters `seal(value, key)` makes, with any key: the nonce, the tag and the JSON, as base64url. */
export function sealedLength(value: unknown): number {
  return Math.ceil(((NONCE + TAG + utf8(JSON.stringify(value) ?? 'null').length) * 4) / 3);
}

/** What `seal` made, opened with the same key; `null` for anything else (another key, a changed byte, not a box). */
export function openSealed<T>(ciphertext: string, key: Uint8Array): T | null {
  try {
    const bytes = fromB64u(ciphertext);
    if (!bytes || bytes.length < NONCE + TAG) return null;
    const plain = nacl.secretbox.open(bytes.subarray(NONCE), bytes.subarray(0, NONCE), key);
    return plain ? (JSON.parse(new TextDecoder().decode(plain)) as T) : null;
  } catch {
    return null;
  }
}

/** A key pair for one invite (X25519), as base64url: the public half goes in the invite, the secret half stays. */
export function newKeyPair(): { publicKey: string; secretKey: string } {
  const pair = nacl.box.keyPair();
  return { publicKey: b64u(pair.publicKey), secretKey: b64u(pair.secretKey) };
}

/**
 * `value` as JSON, sealed so that only the holder of the public key's secret
 * half opens it: a one-off key pair's public half (32 bytes), a nonce (24), then
 * the box. Throws on a public key that is not 32 bytes of base64url.
 */
export function sealTo(value: unknown, publicKey: string): string {
  const to = fromB64u(publicKey);
  if (!to || to.length !== nacl.box.publicKeyLength) throw new Error('invalid public key');
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(NONCE);
  return b64u(concat(ephemeral.publicKey, nonce, nacl.box(utf8(JSON.stringify(value) ?? 'null'), nonce, to, ephemeral.secretKey)));
}

/** What `sealTo` made, opened with the secret key; `null` for anything else. */
export function openFrom<T>(ciphertext: string, secretKey: string): T | null {
  try {
    const bytes = fromB64u(ciphertext);
    const secret = fromB64u(secretKey);
    const head = nacl.box.publicKeyLength + NONCE;
    if (!bytes || !secret || bytes.length < head + TAG) return null;
    const plain = nacl.box.open(bytes.subarray(head), bytes.subarray(nacl.box.publicKeyLength, head), bytes.subarray(0, nacl.box.publicKeyLength), secret);
    return plain ? (JSON.parse(new TextDecoder().decode(plain)) as T) : null;
  } catch {
    return null;
  }
}

/** A short fingerprint of `value`'s JSON (16 bytes of SHA-512, base64url): equal content, equal hash. */
export function contentHash(value: unknown): string {
  return b64u(nacl.hash(utf8(JSON.stringify(value) ?? 'null')).slice(0, 16));
}
