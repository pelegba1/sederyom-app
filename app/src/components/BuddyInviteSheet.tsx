/**
 * ״להוסיף חבר״ (friends spec 2.6): my name as friends see it, what the friend
 * will see from me (the timetable and the absences on by default, the grades
 * off, grades spec 2.1), and ״לשלוח קישור״, which makes the
 * invite and opens the phone's share sheet with its link, as ״שליחה לקבוצה״
 * does (`ShareToGroup`).
 *
 *   <BuddyInviteSheet visible={open} myName={view.myName} onClose={close} />
 *
 * The name is required, at most `BUDDY_NAME_MAX` characters, and saved before
 * the invite is made: the invite carries it. A failure to reach the server is
 * said inside the sheet, which stays open to try again: a toast would be
 * hidden under it. An answer (the list is full, the link was made) closes it
 * first. In the demo nothing is sent: the sheet closes and says so.
 *
 * The name row, the switches and the lock line are the accept sheet's
 * too (`BuddyAcceptSheet`), drawn by the pieces exported here.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import type { BuddyShares } from '@sederyom/shared';
import { BUDDY_NAME_MAX, DEFAULT_BUDDY_SHARES } from '@sederyom/shared';
import { useCreateBuddyInvite, useMyHasBagrut, useSetMyBuddyName } from '../api/hooks';
import { BUDDY_COPY } from '../buddies/copy';
import { buddyUrl } from '../buddies/link';
import { cleanBuddyName } from '../buddies/validate';
import { API_BASE_URL } from '../config';
import { DEMO_COPY } from '../demo/mode';
import { isDemo } from '../demo/phone';
import { font, space, type } from '../theme';
import { fieldLook } from './fieldLook';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, MIN_TOUCH, Switch, Text, TextInput, usePalette } from './ui';

/** Whether `name` can be the name friends see: not blank once the marks nobody sees are out (its length is held by the field). */
export const isFilledName = (name: string): boolean => cleanBuddyName(name) !== '';

/** The name friends see for me: its label at the start, the field at the end, as the sketch has it. */
export function BuddyNameField({ label, value, onChange, disabled = false }: {
  label: string;
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.line, styles.nameLine, { borderTopColor: p.border }]}>
      <Text style={[styles.label, styles.nameLabel, { color: p.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        maxLength={BUDDY_NAME_MAX}
        autoCorrect={false}
        returnKeyType="done"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.nameInput, { color: p.text }, fieldLook(p, { focused })]}
      />
    </View>
  );
}

/** One thing I share: the whole row is the switch, its line under the name. `nested`: set in under the switch it goes with. */
function ShareSwitch({ label, line, value, onChange, disabled, nested = false }: {
  label: string;
  line: string;
  value: boolean;
  onChange: (on: boolean) => void;
  disabled: boolean;
  nested?: boolean;
}): React.JSX.Element {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={line}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.line, nested ? styles.nested : null, { borderTopColor: p.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={styles.grow}>
        <Text style={[styles.label, { color: p.text }]}>{label}</Text>
        <Text style={[styles.sub, { color: p.textMuted }]}>{line}</Text>
      </View>
      <Switch value={value} disabled={disabled} />
    </Pressable>
  );
}

/**
 * What a friend sees from me: my timetable and exams, my absences (2.6), and
 * my grades, compared only when they turn theirs on too (grades spec 2.1).
 * Under the grades, while they are on, ״גם ציוני בגרות״, only on a phone with
 * bagrut grades of Mashov's own (`hasBagrut`, `useMyHasBagrut`); the grades
 * turned off take the bagrut with them.
 */
export function BuddyShareSwitches({ shares, onChange, hasBagrut, disabled = false }: {
  shares: BuddyShares;
  onChange: (shares: BuddyShares) => void;
  hasBagrut: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <View>
      <ShareSwitch
        label={BUDDY_COPY.shareTimetable}
        line={BUDDY_COPY.shareTimetableSub}
        value={shares.timetable}
        disabled={disabled}
        onChange={(timetable) => onChange({ ...shares, timetable })}
      />
      <ShareSwitch
        label={BUDDY_COPY.shareAbsences}
        line={BUDDY_COPY.shareAbsencesSub}
        value={shares.absences}
        disabled={disabled}
        onChange={(absences) => onChange({ ...shares, absences })}
      />
      <ShareSwitch
        label={BUDDY_COPY.shareGrades}
        line={BUDDY_COPY.shareGradesSub}
        value={shares.grades === true}
        disabled={disabled}
        onChange={(grades) => onChange(grades ? { ...shares, grades } : { ...shares, grades, bagrut: false })}
      />
      {shares.grades && hasBagrut ? (
        <ShareSwitch
          nested
          label={BUDDY_COPY.shareBagrut}
          line={BUDDY_COPY.shareBagrutSub}
          value={shares.bagrut === true}
          disabled={disabled}
          onChange={(bagrut) => onChange({ ...shares, bagrut })}
        />
      ) : null}
    </View>
  );
}

/** The quiet line under a sheet's buttons: it can be changed or stopped, and it goes encrypted. */
export function BuddyLockLine({ children }: { children?: string }): React.JSX.Element {
  const p = usePalette();
  return <Text style={[styles.lock, { color: p.textMuted }]}>{children ?? BUDDY_COPY.lock}</Text>;
}

/** A failure to reach the server, said inside a sheet (a toast would be under it). */
export function BuddySheetError({ shown }: { shown: boolean }): React.JSX.Element | null {
  const p = usePalette();
  if (!shown) return null;
  return <Text accessibilityLiveRegion="polite" style={[styles.error, { color: p.cancel }]}>{BUDDY_COPY.failed}</Text>;
}

export function BuddyInviteSheet({ visible, myName, onClose }: {
  visible: boolean;
  /** The name kept, filled in; `''` before the first. */
  myName: string;
  onClose: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const saveName = useSetMyBuddyName();
  const create = useCreateBuddyInvite();
  const hasBagrut = useMyHasBagrut();
  const [name, setName] = useState(myName);
  const [shares, setShares] = useState<BuddyShares>(DEFAULT_BUDDY_SHARES);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Every opening starts from the name kept and the default switches; a name saved
  // while it is open (the send's own) changes nothing on it.
  useEffect(() => {
    if (!visible) return;
    setName(myName);
    setShares(DEFAULT_BUDDY_SHARES);
    setFailed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const close = (): void => {
    if (!busy) onClose();
  };

  const send = async (): Promise<void> => {
    if (isDemo()) {
      onClose();
      toast.show(DEMO_COPY.notSaved);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      if (!(await saveName.mutateAsync(name))) {
        setFailed(true);
        return;
      }
      const secret = await create.mutateAsync(shares);
      if (secret === 'full') {
        onClose();
        toast.show(BUDDY_COPY.full);
        return;
      }
      const url = buddyUrl(API_BASE_URL, secret);
      if (!url) {
        setFailed(true);
        return;
      }
      // Share first, close after: on the iPhone a share sheet asked for while this sheet is
      // going away never comes up, and nothing says so.
      await Share.share({ message: BUDDY_COPY.inviteMessage(url) }).catch(() => toast.show(BUDDY_COPY.shareFailed));
      onClose();
    } catch {
      // Never the error's own words: one line for any failure.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <View style={styles.footer}>
      <Button title={BUDDY_COPY.sendLink} disabled={busy || !isFilledName(name)} onPress={() => void send()} />
      <BuddyLockLine>{`${BUDDY_COPY.linkForMany} ${BUDDY_COPY.lock}`}</BuddyLockLine>
    </View>
  );

  return (
    <Sheet visible={visible} onClose={close} dismissable={!busy} title={BUDDY_COPY.add} footer={footer}>
      <BuddyNameField label={BUDDY_COPY.myName} value={name} onChange={setName} disabled={busy} />
      <BuddyShareSwitches shares={shares} onChange={setShares} hasBagrut={hasBagrut} disabled={busy} />
      <BuddySheetError shown={failed} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // A ruled line of the sheet, as the sketch's: a soft rule above, the text at the start, the control at the end.
  line: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    minHeight: MIN_TOUCH + space.sm, paddingVertical: space.sm, borderTopWidth: 1,
  },
  // At a large text size the field goes under its label rather than squeezing it.
  nameLine: { flexWrap: 'wrap', rowGap: space.sm },
  // ״גם ציוני בגרות״ under ״הציונים שלך״: its rule set in too, so it reads as part of the switch above.
  nested: { marginStart: space.lg },
  grow: { flex: 1 },
  label: { fontFamily: font.body, fontSize: type.body, lineHeight: 23 },
  nameLabel: { flexGrow: 1, flexShrink: 1, flexBasis: 140 },
  sub: { fontFamily: font.body, fontSize: type.caption, lineHeight: 19 },
  nameInput: {
    width: 160, paddingVertical: space.sm, paddingHorizontal: space.md,
    fontFamily: font.bodySemi, fontSize: type.body, textAlign: 'right', writingDirection: 'rtl',
  },
  footer: { gap: space.sm },
  lock: { fontFamily: font.body, fontSize: type.caption, lineHeight: 20 },
  error: { fontFamily: font.body, fontSize: type.small, lineHeight: 21, marginTop: space.md },
});
