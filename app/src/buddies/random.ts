/**
 * The phone's random source for `tweetnacl` (`crypto.ts`): Hermes has no
 * `crypto.getRandomValues`, and tweetnacl without one throws on every key,
 * secret and nonce. Imported for its side effect (`import './random'`) by
 * `run.ts`, so the background task and the widget's update, which reach the
 * friends' work without the app's entry, have it too. The only file that
 * imports `expo-crypto`; `crypto.ts` never imports this, so node's tests use
 * tweetnacl's own.
 */
import { getRandomBytes } from 'expo-crypto';
import nacl from 'tweetnacl';

nacl.setPRNG((x, n) => {
  x.set(getRandomBytes(n));
});
