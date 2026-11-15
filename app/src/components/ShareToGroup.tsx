/**
 * "שליחה לקבוצה" (ideas ה1): the phone's share sheet, where the class's
 * WhatsApp group is, with the text `lib/share.ts` builds and the class's
 * invite link under it (`lib/invite.ts`): the store's page when the phone
 * follows no class, and in the demo, whose class is made up.
 *
 *   <ShareToGroup text={(ctx) => changesShareText(lessons, day, ctx)} />
 */
import React from 'react';
import { Share } from 'react-native';
import { useSettings } from '../api/hooks';
import { API_BASE_URL } from '../config';
import { isDemo } from '../demo/phone';
import { inviteUrl } from '../lib/invite';
import { displayClassName } from '../lib/onboarding';
import { STORE_URL, type ShareContext } from '../lib/share';
import { useToast } from './Toast';
import { Button } from './ui';

/** Whom the text is about, and its link, from the settings as they are now. */
export function useShareContext(): ShareContext {
  const data = useSettings().data;
  const settings = data?.settings;
  const site = data?.schoolSiteUrl ?? null;
  const invite = !isDemo() && settings?.classId && site ? inviteUrl(API_BASE_URL, site, settings.classId) : null;
  return { className: settings?.className ? displayClassName(settings.className) : '', link: invite ?? STORE_URL };
}

export function ShareToGroup({ text }: { text: (ctx: ShareContext) => string | null }): React.JSX.Element | null {
  const ctx = useShareContext();
  const toast = useToast();
  const message = text(ctx);
  if (!message) return null;
  return (
    <Button
      title="שליחה לקבוצה"
      variant="ghost"
      onPress={() => {
        Share.share({ message }).catch(() => toast.show('לא הצלחנו לפתוח את השיתוף'));
      }}
    />
  );
}
