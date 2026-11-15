/**
 * The settings of a friend (friends spec 2.7), opened by the ״שיתוף״ chip on
 * their page:
 * - the switches: what they see from me, sent with the next refresh (the
 *   grades turned off leave the server at once, grades spec 2.5);
 * - my own name for them, kept on this phone only (empty goes back to theirs);
 * - ״להפסיק להיות חברים״ in the red pen, which asks first, inside the sheet,
 *   and then ends it: the boxes go, the page closes back to the friends
 *   screen, and a toast says ״נועה: כבר לא חברים״.
 *
 *   <BuddySettingsSheet visible={open} page={page} onClose={close} onRemoved={() => navigation.goBack()} />
 *
 * ״לשמור״ saves the switches and the name together; closing without it
 * keeps what was. A failure is said inside the sheet, which stays open to try
 * again (a toast would be under it). In the demo nothing is saved: the sheet
 * closes and says so. The name row and the switches are the invite sheet's
 * (`BuddyInviteSheet`).
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { BuddyShares } from '@sederyom/shared';
import { useMyHasBagrut, useRemoveBuddy, useRenameBuddy, useSetBuddyShares } from '../api/hooks';
import { BUDDY_COPY } from '../buddies/copy';
import { cleanBuddyName } from '../buddies/validate';
import type { BuddyPage } from '../buddies/view';
import { DEMO_COPY } from '../demo/mode';
import { isDemo } from '../demo/phone';
import { font, space, type } from '../theme';
import { BuddyLockLine, BuddyNameField, BuddyShareSwitches, BuddySheetError } from './BuddyInviteSheet';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Text, usePalette } from './ui';

/** Whether nothing a switch sets changed; a grades field that is not there is off. */
const sameShares = (a: BuddyShares, b: BuddyShares): boolean =>
  a.timetable === b.timetable && a.absences === b.absences && (a.grades === true) === (b.grades === true) && (a.bagrut === true) === (b.bagrut === true);

export function BuddySettingsSheet({ visible, page, onClose, onRemoved }: {
  visible: boolean;
  page: Pick<BuddyPage, 'id' | 'name' | 'myShares' | 'closesLink'>;
  onClose: () => void;
  /** The friend is gone: the page closes. */
  onRemoved: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const setShares = useSetBuddyShares();
  const rename = useRenameBuddy();
  const remove = useRemoveBuddy();
  const hasBagrut = useMyHasBagrut();
  const [shares, setLocalShares] = useState<BuddyShares>(page.myShares);
  const [name, setName] = useState(page.name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Every opening starts from what is kept, on the settings, not the question.
  useEffect(() => {
    if (!visible) return;
    setLocalShares(page.myShares);
    setName(page.name);
    setConfirming(false);
    setFailed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const close = (): void => {
    if (!busy) onClose();
  };

  /** In the demo: nothing is kept, and the sheet says so as it closes. */
  const inDemo = (): boolean => {
    if (!isDemo()) return false;
    onClose();
    toast.show(DEMO_COPY.notSaved);
    return true;
  };

  const save = async (): Promise<void> => {
    // As `renameBuddy` saves it: their own name pasted with a hidden mark is no new name.
    const label = cleanBuddyName(name);
    const sharesChanged = !sameShares(shares, page.myShares);
    // Cleaned on both sides: a name kept with a doubled space is not renamed by a save that left it alone.
    const renamed = label !== cleanBuddyName(page.name);
    if (!sharesChanged && !renamed) {
      onClose();
      return;
    }
    if (inDemo()) return;
    setBusy(true);
    setFailed(false);
    try {
      if (sharesChanged) await setShares.mutateAsync({ id: page.id, shares });
      if (renamed && !(await rename.mutateAsync({ id: page.id, label }))) {
        setFailed(true);
        return;
      }
      onClose();
    } catch {
      // Never the error's own words: one line for any failure.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    if (inDemo()) return;
    setBusy(true);
    setFailed(false);
    try {
      await remove.mutateAsync(page.id);
      onClose();
      // Said on the friends screen: this page goes with the friend.
      toast.show(BUDDY_COPY.ended(page.name), { outlivesScreen: true });
      onRemoved();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (confirming) {
    const footer = (
      <View style={styles.footer}>
        <Button title={BUDDY_COPY.stopYes} variant="danger" disabled={busy} onPress={() => void stop()} />
        <Button
          title={BUDDY_COPY.stopKeep}
          variant="ghost"
          disabled={busy}
          onPress={() => {
            setFailed(false);
            setConfirming(false);
          }}
        />
      </View>
    );
    return (
      <Sheet visible={visible} onClose={close} dismissable={!busy} title={BUDDY_COPY.stopTitle(page.name)} footer={footer}>
        <Text style={[styles.text, { color: p.text }]}>{page.closesLink ? `${BUDDY_COPY.stopWhat} ${BUDDY_COPY.stopClosesLink}` : BUDDY_COPY.stopWhat}</Text>
        <BuddySheetError shown={failed} />
      </Sheet>
    );
  }

  const footer = (
    <View style={styles.footer}>
      <Button title={BUDDY_COPY.save} disabled={busy} onPress={() => void save()} />
      <Button
        title={BUDDY_COPY.stop}
        variant="danger"
        disabled={busy}
        onPress={() => {
          setFailed(false);
          setConfirming(true);
        }}
      />
      <BuddyLockLine>{BUDDY_COPY.settingsNote(page.name)}</BuddyLockLine>
    </View>
  );

  return (
    <Sheet visible={visible} onClose={close} dismissable={!busy} title={BUDDY_COPY.shareWith(page.name)} footer={footer}>
      <BuddyShareSwitches shares={shares} onChange={setLocalShares} hasBagrut={hasBagrut} disabled={busy} />
      <BuddyNameField label={BUDDY_COPY.nameHere(page.name)} value={name} onChange={setName} disabled={busy} />
      <BuddySheetError shown={failed} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  footer: { gap: space.sm },
  text: { fontFamily: font.body, fontSize: type.body, lineHeight: 24 },
});
