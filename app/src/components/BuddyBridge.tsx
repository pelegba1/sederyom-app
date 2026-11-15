/**
 * A friend's invite link as it reaches the app (friends spec 2.6, 4.3): the
 * page at /b opens `sederyom://buddy?k=<secret>` (`buddyOf`), when the link
 * opens the app or while it is open.
 *
 * Before onboarding is done the phone has no name, Mashov or class yet: the
 * secret is kept (`keepIncomingInvite`, up to 7 days) and asked about once
 * `onboarded` turns true (`takeIncomingInvite`). After it, the invite is read
 * (`checkBuddyInvite`) and:
 *
 * | It is                 | What happens                                                    |
 * |-----------------------|-----------------------------------------------------------------|
 * | someone's, unanswered | the accept sheet (`BuddyAcceptSheet`)                           |
 * | answered here before  | the answer is finished (`acceptBuddyInvite`), and its toast     |
 * | my own                | ״זה הקישור ששלחת. צריך לשלוח אותו לחבר.״                        |
 * | used, or gone         | ״הקישור הזה כבר מלא״, ״הקישור הזה כבר לא בתוקף״                 |
 * | not read (no server)  | ״לא הצלחנו להתחבר. כדאי לנסות שוב.״, never the error's words    |
 *
 * A parent's phone has no friends: the link is let go. In the demo nothing
 * reaches the server, and a line says so.
 *
 * Rendered once, inside the navigation container, beside `JoinBridge`; its
 * toasts belong to no screen, so they stay over whichever is in front.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { DEFAULT_BUDDY_SHARES } from '@sederyom/shared';
import { useAcceptBuddyInvite, useReadBuddyInvite } from '../api/hooks';
import { BUDDY_COPY } from '../buddies/copy';
import { buddyOf } from '../buddies/link';
import { keepIncomingInvite, takeIncomingInvite } from '../buddies/store';
import { DEMO_COPY } from '../demo/mode';
import { isDemo } from '../demo/phone';
import { userSettings } from '../local/userSettings';
import { storage } from '../widget/feedCache';
import { acceptOutcome, BuddyAcceptSheet, type BuddyInvite } from './BuddyAcceptSheet';
import { useToast } from './Toast';

export function BuddyBridge({ onboarded }: { onboarded: boolean }): React.JSX.Element | null {
  const toast = useToast();
  const { mutateAsync: acceptAsync } = useAcceptBuddyInvite();
  // The link being asked about, and then the invite it holds, on the sheet.
  const [secret, setSecret] = useState<string | null>(null);
  const [invite, setInvite] = useState<BuddyInvite | null>(null);
  const check = useReadBuddyInvite(secret);
  // The listeners are set once; they read these as they are when a link comes.
  const latest = useRef({ toast, acceptAsync, onboarded });
  latest.current = { toast, acceptAsync, onboarded };

  /** A link to ask about now: none on a parent's phone, and only a line in the demo. */
  const ask = useCallback((kept: string): void => {
    if (userSettings().audience === 'parent') return;
    if (isDemo()) {
      latest.current.toast.show(DEMO_COPY.notSaved);
      return;
    }
    setSecret(kept);
  }, []);

  useEffect(() => {
    let alive = true;
    const arrive = (url: string | null): void => {
      const found = buddyOf(url);
      if (!alive || !found) return;
      // No name or class yet: asked about when onboarding is done.
      if (!latest.current.onboarded) {
        keepIncomingInvite(storage, found, new Date());
        return;
      }
      ask(found);
    };
    void Linking.getInitialURL().then(arrive).catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => arrive(url));
    return () => {
      alive = false;
      sub.remove();
    };
  }, [ask]);

  // Onboarding done (or done before): a link kept meanwhile, once. Whether it is a
  // parent's phone is known only now.
  useEffect(() => {
    if (!onboarded) return;
    const kept = takeIncomingInvite(storage, new Date());
    if (kept) ask(kept);
  }, [onboarded, ask]);

  // What the link is, once read.
  useEffect(() => {
    if (secret === null) return;
    const say = latest.current.toast;
    if (check.isError) {
      setSecret(null);
      say.show(BUDDY_COPY.failed);
      return;
    }
    const found = check.data;
    if (found === undefined) return;
    setSecret(null);
    if (found === 'own') say.show(BUDDY_COPY.own);
    else if (found === 'used') say.show(BUDDY_COPY.used);
    else if (found === 'gone') say.show(BUDDY_COPY.gone);
    else if (found === 'answered') {
      // Answered here before, its write maybe lost: the very same answer is finished, or found done.
      latest.current.acceptAsync({ secret, shares: DEFAULT_BUDDY_SHARES }).then(
        (result) => latest.current.toast.show(acceptOutcome(result, null)),
        () => latest.current.toast.show(BUDDY_COPY.failed),
      );
    } else setInvite({ secret, name: found.name, shares: found.shares });
  }, [secret, check.data, check.isError]);

  // A newer link replaces the sheet of an older one, its fields fresh.
  return invite ? <BuddyAcceptSheet key={invite.secret} invite={invite} onClose={() => setInvite(null)} /> : null;
}
