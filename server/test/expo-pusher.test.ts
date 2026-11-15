/**
 * `ExpoPusher` against a stand-in for Expo's push API: when Expo cannot be
 * reached, or answers 5xx or 429 past the SDK's own retries, the send fails
 * like any other failed send. Thrown, it used to end the whole tick, the
 * followed classes' polls and pushes with it.
 */
import { describe, expect, it } from 'vitest';
import { ExpoPusher, type OutgoingPush } from '../src/notify/push.js';

const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const PUSH: OutgoingPush = { title: 'סדר יום', body: 'בדיקה', payload: { type: 'morning_summary', deepLink: 'today', refreshWidget: true } };

function pusherWith(send: (chunk: unknown[]) => Promise<unknown[]>): ExpoPusher {
  const pusher = new ExpoPusher();
  // The SDK client is private; the stand-in replaces only its network call.
  (pusher as unknown as { expo: unknown }).expo = { chunkPushNotifications: (messages: unknown[]) => [messages], sendPushNotificationsAsync: send };
  return pusher;
}

describe('ExpoPusher', () => {
  it('turns an unreachable Expo into a failed send', async () => {
    const pusher = pusherWith(async () => {
      throw new Error('Expo responded with an error with status code 503');
    });
    await expect(pusher.send([TOKEN], PUSH)).resolves.toEqual({ ok: false, invalidTokens: [], error: 'expo: Expo responded with an error with status code 503' });
  });

  it('still reports a token Expo no longer knows', async () => {
    const pusher = pusherWith(async () => [{ status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }]);
    await expect(pusher.send([TOKEN], PUSH)).resolves.toMatchObject({ ok: false, invalidTokens: [TOKEN] });
  });
});
