import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import type { PushPayload } from '@sederyom/shared';

export interface OutgoingPush {
  title: string;
  body: string;
  payload: PushPayload;
}

export interface Pusher {
  send(tokens: string[], push: OutgoingPush): Promise<{ ok: boolean; invalidTokens: string[]; error?: string }>;
}

export class ExpoPusher implements Pusher {
  private readonly expo = new Expo();

  async send(tokens: string[], push: OutgoingPush): Promise<{ ok: boolean; invalidTokens: string[]; error?: string }> {
    const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
    // Annotated: TS infers a type predicate from the arrow and would otherwise
    // narrow this to never[].
    const invalidTokens: string[] = tokens.filter((t) => !Expo.isExpoPushToken(t));
    if (valid.length === 0) return { ok: false, invalidTokens, error: 'no valid Expo push tokens registered' };

    const messages: ExpoPushMessage[] = valid.map((to) => ({
      to,
      title: push.title,
      body: push.body,
      data: push.payload as unknown as Record<string, unknown>,
      sound: 'default',
      priority: 'high',
      channelId: 'default',
    }));

    const tickets: ExpoPushTicket[] = [];
    try {
      for (const chunk of this.expo.chunkPushNotifications(messages)) {
        tickets.push(...(await this.expo.sendPushNotificationsAsync(chunk)));
      }
    } catch (err) {
      // Expo unreachable, or a 5xx or 429 after the SDK's own retries: a send that failed,
      // which the caller retries on a later tick, not an exception that ends the tick.
      return { ok: false, invalidTokens, error: `expo: ${err instanceof Error ? err.message : String(err)}` };
    }

    const errors: string[] = [];
    tickets.forEach((ticket, i) => {
      if (ticket.status !== 'error') return;
      errors.push(ticket.message);
      if (ticket.details?.error === 'DeviceNotRegistered') {
        const token = valid[i];
        if (token) invalidTokens.push(token);
      }
    });

    return { ok: errors.length === 0, invalidTokens, error: errors.length > 0 ? errors.join('; ') : undefined };
  }
}

/** Records what would have been sent — used by tests and by SCHEDULER_ENABLED=false runs. */
export class RecordingPusher implements Pusher {
  readonly sent: { tokens: string[]; push: OutgoingPush }[] = [];

  async send(tokens: string[], push: OutgoingPush): Promise<{ ok: boolean; invalidTokens: string[] }> {
    this.sent.push({ tokens, push });
    return { ok: true, invalidTokens: [] };
  }
}
