/**
 * The invites (ideas ה2): the class's link to send to friends, and the one to
 * send to a parent. Drawn on Settings and wherever else a person might want to
 * pass the app on.
 */
import React from 'react';
import { Share } from 'react-native';
import { useSettings } from '../../api/hooks';
import { Row } from '../../components/notebook';
import { API_BASE_URL } from '../../config';
import { isDemo } from '../../demo/phone';
import { inviteMessage, inviteUrl, parentInviteMessage } from '../../lib/invite';
import { INVITE_COPY, displayClassName } from '../../lib/onboarding';

/**
 * The share rows for the class's invite link, once a class is followed at a
 * known site; not the demo's made-up one. A student invites classmates and a
 * parent; a parent invites another parent. Nothing while the settings have not
 * loaded, or when neither row applies.
 */
export function InviteRows(): React.JSX.Element | null {
  const settings = useSettings();
  if (!settings.data) return null;
  const s = settings.data.settings;
  const demo = isDemo();
  const parent = s.audience === 'parent';
  const siteUrl = settings.data.schoolSiteUrl;
  const invite = !demo && !parent && s.classId && siteUrl ? inviteUrl(API_BASE_URL, siteUrl, s.classId) : null;
  // With the lines hidden here, as codes (`lib/invite.ts`): the parent's phone shows the same lessons.
  const parentInvite = !demo && s.classId && siteUrl ? inviteUrl(API_BASE_URL, siteUrl, s.classId, true, s.lessons.hiddenSubjects) : null;
  if (!invite && !parentInvite) return null;
  return (
    <>
      {invite ? (
        <Row
          title={INVITE_COPY.row}
          subtitle={INVITE_COPY.rowHint}
          accessibilityRole="button"
          onPress={() => void Share.share({ message: inviteMessage(invite) }).catch(() => undefined)}
        />
      ) : null}
      {parentInvite ? (
        <Row
          title={INVITE_COPY.parentRow}
          subtitle={parent ? INVITE_COPY.otherParentRowHint : INVITE_COPY.parentRowHint}
          accessibilityRole="button"
          onPress={() => void Share.share({ message: parentInviteMessage(parentInvite, parent ? displayClassName(s.className) : undefined) }).catch(() => undefined)}
        />
      ) : null}
    </>
  );
}
