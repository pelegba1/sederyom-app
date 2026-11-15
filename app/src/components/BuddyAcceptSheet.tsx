/**
 * The sheet a friend's link opens (friends spec 2.6, sketch ״הוספת חבר״):
 * who invites, my name as they will see it, what I share with them (the
 * timetable and the absences on by default, the grades off, whatever the
 * invite offers: grades spec 2.1), ״להיות חברים״ or ״לא עכשיו״, and under the
 * buttons what they share with me, the grades and the bagrut included
 * (`shareParts`), and the lock line.
 *
 *   <BuddyAcceptSheet invite={{ secret, name, shares }} onClose={close} />
 *
 * Opened by `BuddyBridge` once `checkBuddyInvite` has read the invite. The
 * name is saved first (`setMyBuddyName`), then the answer is written. An
 * answer closes the sheet and says itself in a toast (`acceptOutcome`); a
 * failure to reach the server is said inside the sheet, which stays open to
 * try again.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { BuddyShares } from '@sederyom/shared';
import { DEFAULT_BUDDY_SHARES } from '@sederyom/shared';
import { useAcceptBuddyInvite, useBuddies, useMyHasBagrut, useSetMyBuddyName } from '../api/hooks';
import { BUDDY_COPY } from '../buddies/copy';
import { font, space, type } from '../theme';
import { BuddyLockLine, BuddyNameField, BuddySheetError, BuddyShareSwitches, isFilledName } from './BuddyInviteSheet';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Text, usePalette } from './ui';

/** An invite read from a link: its secret, who sends it, and what they share with me. */
export interface BuddyInvite {
  secret: string;
  name: string;
  shares: BuddyShares;
}

/**
 * What an answer to a link says: the friend's arrival, or why there is none.
 * `name` is `null` for a link this phone had answered before, whose sender is
 * not known here (`checkBuddyInvite`'s `'answered'`).
 */
export function acceptOutcome(result: 'ok' | 'used' | 'gone' | 'full' | 'own', name: string | null): string {
  if (result === 'ok') return name ? BUDDY_COPY.accepted(name) : BUDDY_COPY.alreadyAccepted;
  if (result === 'used') return BUDDY_COPY.used;
  if (result === 'gone') return BUDDY_COPY.gone;
  if (result === 'full') return BUDDY_COPY.full;
  return BUDDY_COPY.own;
}

export function BuddyAcceptSheet({ invite, onClose }: { invite: BuddyInvite; onClose: () => void }): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const myName = useBuddies().data?.myName ?? '';
  const saveName = useSetMyBuddyName();
  const accept = useAcceptBuddyInvite();
  const hasBagrut = useMyHasBagrut();
  // `null` until typed in: the name kept, once it is read.
  const [typed, setTyped] = useState<string | null>(null);
  const [shares, setShares] = useState<BuddyShares>(DEFAULT_BUDDY_SHARES);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = typed ?? myName;

  const close = (): void => {
    if (!busy) onClose();
  };

  const answer = async (): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      if (!(await saveName.mutateAsync(name))) {
        setFailed(true);
        return;
      }
      const result = await accept.mutateAsync({ secret: invite.secret, shares });
      onClose();
      toast.show(acceptOutcome(result, invite.name));
    } catch {
      // Never the error's own words: one line for any failure.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <View style={styles.footer}>
      <Button title={BUDDY_COPY.accept} disabled={busy || !isFilledName(name)} onPress={() => void answer()} />
      <Button title={BUDDY_COPY.later} variant="ghost" disabled={busy} onPress={close} />
      <BuddyLockLine>{`${BUDDY_COPY.fromThem(invite.name, BUDDY_COPY.shareParts(invite.shares))}. ${BUDDY_COPY.lock}`}</BuddyLockLine>
    </View>
  );

  return (
    <Sheet visible onClose={close} dismissable={!busy} title={BUDDY_COPY.acceptTitle(invite.name)} footer={footer}>
      <Text style={[styles.lead, { color: p.textMuted }]}>{BUDDY_COPY.acceptLead}</Text>
      <BuddyNameField label={BUDDY_COPY.nameThere(invite.name)} value={name} onChange={setTyped} disabled={busy} />
      <BuddyShareSwitches shares={shares} onChange={setShares} hasBagrut={hasBagrut} disabled={busy} />
      <BuddySheetError shown={failed} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  lead: { fontFamily: font.body, fontSize: type.small, lineHeight: 22, marginBottom: space.md },
  footer: { gap: space.xs },
});
