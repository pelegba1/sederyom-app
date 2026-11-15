/**
 * A friend invite's link (docs/superpowers/specs/2026-10-29-friends-design.md,
 * 2.6 and 4.3):
 *
 *   https://<server>/b#<secret>
 *
 * The secret is 32 random bytes in 43 base64url characters and lives only
 * after the `#`, which a browser never sends to a server. The server's page
 * (`public/buddy.html`) reads it there and opens the app on
 * `sederyom://buddy?k=<secret>` (a query, not a fragment, which an Android
 * intent does not carry); `buddyOf` reads it from that. The store link on the
 * page carries nothing, so the secret never reaches Google Play.
 *
 *   buddyUrl('https://api.example', S) → 'https://api.example/b#' + S
 *   buddyOf('sederyom://buddy?k=' + S) → S
 *
 * Pure, so the tests run it as is. Like `invite.ts`, it reads the link by hand:
 * `URL` does not parse a custom scheme the same everywhere.
 */
import { isPairingSecret } from './crypto';

/** The invite's link to share, or `null` when the app has no server or what it was given is not a secret. */
export function buddyUrl(base: string, secret: string): string | null {
  if (!base || !isPairingSecret(secret)) return null;
  return `${base.replace(/\/+$/, '')}/b#${secret}`;
}

/**
 * The secret an invite carries, from the app's own link (`sederyom://buddy?k=…`)
 * and nothing else: the page's link keeps the secret after `#`, where it is
 * never meant to be handed to anything but the page. `null` for any other link
 * and for a secret that is not 43 base64url characters.
 */
export function buddyOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const q = url.indexOf('?');
  if (q < 0 || !/^sederyom:\/\/buddy$/i.test(url.slice(0, q).replace(/\/+$/, ''))) return null;
  for (const pair of url.slice(q + 1).split('#')[0]!.split('&')) {
    if (pair.startsWith('k=')) {
      const secret = pair.slice(2);
      return isPairingSecret(secret) ? secret : null;
    }
  }
  return null;
}
