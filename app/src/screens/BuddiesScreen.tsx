/**
 * חברים (friends spec 2.3, sketch 1-layout.html, option ב's list): opened by
 * the two heads in the header of ״היום״ and ״שבוע״.
 *
 * - The friends, a ruled row each: the initial in a circle, the name, one line
 *   about today (`BuddyRow.line`). A friend whose first update has not come
 *   yet is grey, the circle dashed. A tap opens the friend (`Buddy`).
 * - My links still open: one grey row, ״הקישור עדיין פתוח״ under it (friends
 *   can go on answering a link after the first has).
 * - ״להוסיף חבר״, dashed, right under the list as the sketch has it, which
 *   opens `BuddyInviteSheet`; at `MAX_BUDDIES` it says ״אפשר עד 20 חברים״ and
 *   does nothing.
 * - ״מבחנים עם חברים״: my exams in the next two weeks that a friend has too,
 *   and who (only when there is one).
 *
 * Opening it says the one-time notes (a friend who joined, one who left) once,
 * as one toast, and marks the screen seen: the dot on the header's button goes.
 * Nothing of it is a parent's: the header has no button, and this screen
 * shows nothing.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { DateStr } from '@sederyom/shared';
import type { ExamWithBuddies } from '@sederyom/shared/logic/buddies-compare';
import { useBuddies, useCancelBuddyInvites, useMarkBuddiesSeen, useSettings } from '../api/hooks';
import { BUDDY_COPY, buddyNames } from '../buddies/copy';
import type { BuddyRow } from '../buddies/view';
import { DEMO_COPY } from '../demo/mode';
import { isDemo } from '../demo/phone';
import { AppIcon } from '../components/AppIcon';
import { BuddyInitial } from '../components/BuddyInitial';
import { BuddyInviteSheet, BuddySheetError } from '../components/BuddyInviteSheet';
import { MarginList, MarginRow, Row, ROW_GUTTER, SectionHeading } from '../components/notebook';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { Button, ErrorState, Loading, Ltr, MIN_TOUCH, Screen, Text, usePalette } from '../components/ui';
import { formatShortDate, isolateRanges } from '../lib/format';
import { marginWeekday } from '../lib/school';
import type { RootNavigation } from '../navigation/types';
import { font, radius, space, type } from '../theme';
import { LOAD_ERROR_TEXT } from './ConnectionsScreen';
import { InviteRows } from './settings/InviteRows';

export function BuddiesScreen(): React.JSX.Element {
  const p = usePalette();
  const navigation = useNavigation<RootNavigation>();
  const toast = useToast();
  const buddies = useBuddies();
  const markSeen = useMarkBuddiesSeen();
  const parent = useSettings().data?.settings.audience === 'parent';
  const [adding, setAdding] = useState(false);
  const view = buddies.data;

  // Once for each opening: the notes, then seen. Not again when the model is read again while open.
  const opened = useRef(false);
  useEffect(() => {
    if (!view || opened.current) return;
    opened.current = true;
    if (view.notes.length > 0) toast.show(view.notes.join('\n'), view.notes.length > 1 ? { durationMs: NOTES_MS } : undefined);
    if (view.unseen || view.notes.length > 0) markSeen();
  }, [view, toast, markSeen]);

  if (parent) return <Screen>{null}</Screen>;
  if (buddies.isLoading) return <Screen><Loading /></Screen>;
  if (buddies.isError || !view) {
    return (
      <Screen>
        <ErrorState message={LOAD_ERROR_TEXT} onRetry={() => void buddies.refetch()} />
      </Screen>
    );
  }

  const empty = view.rows.length === 0 && view.invites === 0;
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {empty ? <Text style={[styles.lead, { color: p.textMuted }]}>{BUDDY_COPY.emptyLead}</Text> : null}
        {view.rows.map((row) => (
          <BuddyListRow key={row.id} row={row} onPress={() => navigation.navigate('Buddy', { id: row.id })} />
        ))}
        {view.invites > 0 ? <InvitesRow count={view.invites} /> : null}
        <AddRow full={view.full} onPress={() => setAdding(true)} />
        {/* Also in Settings → אני ובית הספר (settings spec §4.3): the invites sit where the friends are. */}
        <InviteRows />
        {view.exams.length > 0 ? <ExamsWithBuddies exams={view.exams} /> : null}
      </ScrollView>
      <BuddyInviteSheet visible={adding} myName={view.myName} onClose={() => setAdding(false)} />
    </Screen>
  );
}

/** Several notes at once stay longer than one. */
const NOTES_MS = 6000;

function BuddyListRow({ row, onPress }: { row: BuddyRow; onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  return (
    <Row
      lead={<BuddyInitial letter={row.initial} waiting={row.waiting} />}
      title={row.name}
      titleStyle={row.waiting ? { color: p.textFaint } : null}
      subtitle={row.line ? row.line : undefined}
      chevron
      onPress={onPress}
      accessibilityLabel={row.line ? `${row.name}, ${row.line}` : row.name}
    />
  );
}

/**
 * My links still open, as the sketch's grey row: no name,
 * ״הקישור עדיין פתוח״. A tap asks, in a sheet, whether to close them
 * (`CancelInvitesSheet`).
 */
function InvitesRow({ count }: { count: number }): React.JSX.Element {
  const p = usePalette();
  const [asking, setAsking] = useState(false);
  const title = BUDDY_COPY.invitesSent(count);
  const open = BUDDY_COPY.waiting(count);
  return (
    <>
      <Row
        lead={<BuddyInitial icon="link" waiting />}
        title={title}
        titleStyle={{ color: p.textFaint }}
        subtitle={open}
        onPress={() => setAsking(true)}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${open}`}
      />
      <CancelInvitesSheet visible={asking} count={count} onClose={() => setAsking(false)} />
    </>
  );
}

/**
 * ״לסגור את הקישורים?״: closes them (`useCancelBuddyInvites`), and the links
 * already shared read as no longer good; friends who answered them stay. A failure is said
 * inside the sheet, which stays open to try again. In the demo nothing is
 * saved: the sheet closes and says so.
 */
function CancelInvitesSheet({ visible, count, onClose }: { visible: boolean; count: number; onClose: () => void }): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const cancel = useCancelBuddyInvites();
  const [failed, setFailed] = useState(false);
  const busy = cancel.isPending;

  useEffect(() => {
    if (visible) setFailed(false);
  }, [visible]);

  const withdraw = async (): Promise<void> => {
    if (isDemo()) {
      onClose();
      toast.show(DEMO_COPY.notSaved);
      return;
    }
    setFailed(false);
    try {
      await cancel.mutateAsync();
      onClose();
    } catch {
      // Never the error's own words: one line for any failure.
      setFailed(true);
    }
  };

  const footer = (
    <View style={styles.sheetFooter}>
      <Button title={BUDDY_COPY.cancelInvitesYes(count)} variant="danger" disabled={busy} onPress={() => void withdraw()} />
      <Button title={BUDDY_COPY.cancelInvitesKeep} variant="ghost" disabled={busy} onPress={onClose} />
    </View>
  );
  return (
    <Sheet visible={visible} onClose={onClose} dismissable={!busy} title={BUDDY_COPY.cancelInvitesTitle(count)} footer={footer}>
      <Text style={[styles.sheetText, { color: p.text }]}>{BUDDY_COPY.cancelInvitesWhat(count)}</Text>
      <BuddySheetError shown={failed} />
    </Sheet>
  );
}

/** An exam's date in the margin, the weekday under it, as on ״בית ספר״. */
function ExamDate({ date }: { date: DateStr }): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={styles.dateMargin}>
      <Ltr style={[styles.marginDate, { color: p.textMuted }]}>{formatShortDate(date)}</Ltr>
      <Text style={[styles.marginDay, { color: p.textMuted }]}>{marginWeekday(date)}</Text>
    </View>
  );
}

/** Who else sits the exam: on the same day, and in the same week on another. */
function examLines(exam: ExamWithBuddies): string {
  const lines: string[] = [];
  if (exam.together.length > 0) lines.push(BUDDY_COPY.alsoTogether(buddyNames(exam.together)));
  if (exam.sameSubject.length > 0) lines.push(BUDDY_COPY.alsoOtherDay(buddyNames(exam.sameSubject)));
  return lines.join('\n');
}

function ExamsWithBuddies({ exams }: { exams: ExamWithBuddies[] }): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={styles.section}>
      <View style={styles.gutter}>
        <SectionHeading>{BUDDY_COPY.examsTitle}</SectionHeading>
      </View>
      <MarginList style={[styles.examList, { borderTopColor: p.border }]}>
        {exams.map((exam, i) => {
          const title = isolateRanges(exam.title);
          const who = examLines(exam);
          return (
            <MarginRow
              key={`${exam.date}|${exam.title}|${i}`}
              margin={<ExamDate date={exam.date} />}
              title={title}
              subtitle={who}
              accessible
              accessibilityLabel={`${title}, ${formatShortDate(exam.date)}, ${who.replace('\n', ', ')}`}
            />
          );
        })}
      </MarginList>
    </View>
  );
}

/** ״להוסיף חבר״, dashed; at the limit it says so and does nothing. */
function AddRow({ full, onPress }: { full: boolean; onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  const label = full ? BUDDY_COPY.full : BUDDY_COPY.add;
  const ink = full ? p.textFaint : p.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: full }}
      disabled={full}
      onPress={onPress}
      // Dashed on all four sides alike: Android draws no dashed border otherwise.
      style={({ pressed }) => [styles.add, { borderColor: full ? p.border : p.accent, opacity: pressed ? 0.6 : 1 }]}
    >
      {full ? null : <AppIcon name="plus" color={ink} size={18} />}
      <Text style={[styles.addText, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 60 },
  gutter: { paddingHorizontal: ROW_GUTTER },
  lead: { fontFamily: font.body, fontSize: type.body, lineHeight: 24, paddingHorizontal: ROW_GUTTER, paddingTop: space.lg },
  // Under the add row: a section's usual distance, as on Settings.
  section: { marginTop: space.xxl },
  examList: { borderTopWidth: 1 },
  dateMargin: { alignItems: 'center' },
  marginDate: { fontFamily: font.bodySemi, fontSize: type.small, fontVariant: ['tabular-nums'] },
  marginDay: { fontFamily: font.body, fontSize: type.caption },
  // Right under the last ruled row (or the empty screen's lead), 12 points off, as the sketch's.
  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs,
    minHeight: MIN_TOUCH + space.xs, marginHorizontal: ROW_GUTTER, marginTop: space.md, paddingHorizontal: space.md,
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.md,
  },
  addText: { fontFamily: font.bodySemi, fontSize: type.body },
  sheetFooter: { gap: space.sm },
  sheetText: { fontFamily: font.body, fontSize: type.body, lineHeight: 24 },
});
