/**
 * חיבור לצ׳אט (chat connection spec 4.5), opened by the row in Settings → אני:
 * the student's own chat (ChatGPT, Claude…) learns to read their school day.
 *
 * - A line on what it is, then the way in: ״להתחבר לצ׳אט״ asks for a code
 *   (`useMakeChatCode`) and the page shows it, large, with ״להעתיק״, what to do
 *   with it and until when it is good. While it is shown (and not out of date)
 *   the page reads the chats every three seconds; when a chat has come (an id the
 *   code was not made against) the code goes, and the page says ״הצ׳אט מחובר״ if
 *   one that came can read now, or ״צ׳אט חדש מחכה לאישור שלך.״ if every one that
 *   came waits for the student's word (its row asks). At its end an unused code is
 *   replaced by ״תוקף הקוד עבר״ and the button again. At five chats there is no
 *   button, only the line that says why (the server may also answer ״full״, which
 *   is a toast).
 * - ״מה לשתף״: the timetable and exams, always (a switch that is on and locked),
 *   then a switch for each of what else a chat may read. A change reaches a linked
 *   chat at once (`useSetChatShares`).
 * - ״צ׳אטים מחוברים״ (only with chats): a ruled row for each, with its own name and
 *   a line on whether it has used the copy, and ״לנתק״. A chat from a host the app
 *   does not know waits for the student: the row says where it comes from and
 *   offers ״לחבר״ as well. Cutting asks first. Then when the phone last sent
 *   its copy, and ״לנתק הכול״.
 * - The footer: who gets what is shared, and the privacy policy.
 *
 * A change that fails says why in a toast, in the words the error already has
 * (`chat/run.ts`): never anything the server sent. A chat's name and host come
 * from outside and are set in an isolate (`isolateName`) wherever a sentence of
 * ours holds them. In the demo the page is empty and a change says it is not saved
 * (the same hooks); a parent's phone has no page.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_CHAT_SHARES } from '@sederyom/shared';
import type { ChatShares, CreateChatCodeResponse } from '@sederyom/shared';
import {
  keys, useApproveChat, useChat, useCutAllChats, useCutChat, useMakeChatCode, useSetChatShares, useSettings,
} from '../api/hooks';
import { CHAT_COPY } from '../chat/copy';
import { codeOutcome, timeIn, type ChatRowView, type ChatScreenView } from '../chat/view';
import { Row, ROW_GUTTER } from '../components/notebook';
import { useToast } from '../components/Toast';
import { Button, Card, ErrorState, Loading, Ltr, Screen, Switch, Text, usePalette } from '../components/ui';
import { API_BASE_URL, TIMEZONE } from '../config';
import { isolateName } from '../lib/format';
import { font, space, type } from '../theme';
import { LOAD_ERROR_TEXT } from './ConnectionsScreen';
import { Section, SwitchRow } from './settings/parts';

/** The switches, in the order of the defaults (the timetable has its own, locked). */
const SHARE_KEYS = Object.keys(DEFAULT_CHAT_SHARES) as (keyof ChatShares)[];

/** A code on the screen, with the chats the phone had when it was made: one that is not among them is the chat it was made for. */
interface IssuedCode extends CreateChatCodeResponse {
  idsThen: string[];
}

/** What a chat adds: the server's `/mcp`. */
const CHAT_ADDRESS = `${API_BASE_URL}/mcp`;

/** What a failure says: the error's own words (already Hebrew), or the general ones. */
function said(err: unknown): string {
  return err instanceof Error && err.message ? err.message : CHAT_COPY.failed;
}

/**
 * Whether `expiresAt` has passed, and a new render at the moment it does. `null`
 * (no code) is never expired; a time that is not one is already out.
 */
function useExpired(expiresAt: string | null): boolean {
  // A timer that fires a hair early finds the code still good: `tick` sets the next one for what is left.
  const [tick, setTick] = useState(0);
  const at = expiresAt === null ? null : Date.parse(expiresAt);
  const expired = expiresAt !== null && (at === null || Number.isNaN(at) || Date.now() >= at);
  useEffect(() => {
    if (at === null || Number.isNaN(at) || expired) return undefined;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(at - Date.now(), 0));
    return () => clearTimeout(timer);
  }, [at, expired, tick]);
  return expired;
}

export function ChatScreen(): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const parent = useSettings().data?.settings.audience === 'parent';
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const expired = useExpired(issued?.expiresAt ?? null);
  const live = issued !== null && !expired;
  const chat = useChat({ polling: live });
  const makeCode = useMakeChatCode();
  const setShares = useSetChatShares();
  const approve = useApproveChat();
  const cut = useCutChat();
  const cutAll = useCutAllChats();
  const view = chat.data;

  // A chat came while the code was out: the code is spent. ״הצ׳אט מחובר״ only when one that came can read now; when every one that came waits for the student's word the toast says so (its row, below the fold, asks), so the code does not just vanish.
  useEffect(() => {
    if (!issued || !view) return;
    const outcome = codeOutcome(issued.idsThen, view.chats);
    if (outcome === 'waiting') return;
    setIssued(null);
    toast.show(outcome === 'linked' ? CHAT_COPY.linkedToast : CHAT_COPY.waitingToast);
  }, [issued, view, toast]);

  if (parent) return <Screen>{null}</Screen>;
  if (!view) {
    return (
      <Screen>
        {chat.isLoading ? <Loading /> : <ErrorState message={LOAD_ERROR_TEXT} onRetry={() => void chat.refetch()} />}
      </Screen>
    );
  }

  const connect = async (): Promise<void> => {
    try {
      const made = await makeCode.mutateAsync();
      if (made === 'full') {
        toast.show(CHAT_COPY.full);
        return;
      }
      // The mutation has read the page again by now, so these are the ids the code is made against.
      const now = queryClient.getQueryData<ChatScreenView>(keys.chat);
      setIssued({ ...made, idsThen: (now ?? view).chats.map((row) => row.id) });
    } catch (err) {
      toast.show(said(err));
    }
  };

  const copy = (text: string, done: string): void => {
    // A copy that fails says so (never ״הקוד הועתק״ it did not earn); the code stays on the screen to be typed.
    // `false` is a failure too: the phones always answer `true` or reject, but the web build answers `false`.
    void Clipboard.setStringAsync(text).then(
      (saved) => toast.show(saved === false ? CHAT_COPY.copyFailed : done),
      () => toast.show(CHAT_COPY.copyFailed),
    );
  };

  const changeShare = (key: keyof ChatShares, on: boolean): void => {
    void setShares.mutateAsync({ ...view.shares, [key]: on }).catch((err: unknown) => toast.show(said(err)));
  };

  const confirmCut = (row: ChatRowView): void => {
    Alert.alert(CHAT_COPY.cutConfirm(isolateName(row.title)), undefined, [
      { text: 'ביטול', style: 'cancel' },
      { text: CHAT_COPY.cut, style: 'destructive', onPress: () => void cut.mutateAsync(row.id).catch((err: unknown) => toast.show(said(err))) },
    ]);
  };

  const confirmCutAll = (): void => {
    Alert.alert(CHAT_COPY.cutAllConfirm, undefined, [
      { text: 'ביטול', style: 'cancel' },
      { text: CHAT_COPY.cutAll, style: 'destructive', onPress: () => void cutAll.mutateAsync().catch((err: unknown) => toast.show(said(err))) },
    ]);
  };

  const busy = approve.isPending || cut.isPending || cutAll.isPending;
  const hasChats = view.chats.length > 0;
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.lead, { color: p.textMuted }]}>{CHAT_COPY.intro}</Text>

        {issued && live ? (
          <CodeCard issued={issued} onCopy={() => copy(issued.code, CHAT_COPY.copied)} onCopyAddress={() => copy(CHAT_ADDRESS, CHAT_COPY.addressCopied)} />
        ) : (
          <View style={styles.connect}>
            {issued ? <Text style={[styles.note, { color: p.textMuted }]}>{CHAT_COPY.codeExpired}</Text> : null}
            {view.canAdd ? (
              <Button title={CHAT_COPY.connect} disabled={makeCode.isPending} onPress={() => void connect()} />
            ) : (
              <Text style={[styles.note, { color: p.textMuted }]}>{CHAT_COPY.full}</Text>
            )}
          </View>
        )}

        <Section title={CHAT_COPY.sharesTitle}>
          {/*
            Locked on, not a setting that cannot apply now: `SwitchRow disabled` mutes the title too (the notifications' meaning), and
            the row read as unavailable. Here the title keeps its ink; only the switch is drawn locked.
          */}
          <Row
            title={CHAT_COPY.timetable}
            subtitle={CHAT_COPY.timetableHint}
            end={<Switch value disabled />}
            accessible
            accessibilityRole="switch"
            accessibilityLabel={CHAT_COPY.timetable}
            accessibilityHint={CHAT_COPY.timetableHint}
            accessibilityState={{ checked: true, disabled: true }}
          />
          {SHARE_KEYS.map((key) => (
            <SwitchRow
              key={key}
              label={CHAT_COPY.shares[key]}
              value={view.shares[key]}
              busy={setShares.isPending}
              onChange={(on) => changeShare(key, on)}
            />
          ))}
        </Section>

        {hasChats ? (
          <Section title={CHAT_COPY.chatsTitle}>
            {view.chats.map((row) => (
              <ChatRow
                key={row.id}
                row={row}
                busy={busy}
                onApprove={() => void approve.mutateAsync(row.id).catch((err: unknown) => toast.show(said(err)))}
                onCut={() => confirmCut(row)}
              />
            ))}
            {view.updatedLine ? <Text style={[styles.updated, { color: p.textMuted }]}>{view.updatedLine}</Text> : null}
            <View style={styles.cutAll}>
              <View style={styles.start}>
                <Button title={CHAT_COPY.cutAll} variant="danger" disabled={busy} onPress={confirmCutAll} />
              </View>
            </View>
          </Section>
        ) : null}

        <View style={styles.footer}>
          <Text style={[styles.note, { color: p.textMuted }]}>{CHAT_COPY.footer}</Text>
          <View style={styles.start}>
            <Button
              title={CHAT_COPY.privacy}
              variant="ghost"
              onPress={() => void Linking.openURL(`${API_BASE_URL}/privacy.html`).catch(() => toast.show('לא הצלחנו לפתוח את האתר'))}
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

/** The code for a new chat: large, as it is typed (left to right), to copy, what to do with it and until when. */
function CodeCard({ issued, onCopy, onCopyAddress }: { issued: IssuedCode; onCopy: () => void; onCopyAddress: () => void }): React.JSX.Element {
  const p = usePalette();
  const until = timeIn(issued.expiresAt, TIMEZONE);
  return (
    <View style={styles.codeArea}>
      <Card style={styles.codeCard}>
        <Ltr style={[styles.code, { color: p.textStrong }]}>{issued.code}</Ltr>
        <Button title={CHAT_COPY.copy} variant="ghost" onPress={onCopy} />
        <Text style={[styles.codeText, { color: p.text }]}>{CHAT_COPY.codeHint}</Text>
        {until ? <Text style={[styles.codeText, { color: p.textMuted }]}>{CHAT_COPY.codeValid(until)}</Text> : null}
        <Text selectable style={[styles.codeText, { color: p.text }]}>
          <Ltr style={[styles.codeText, { color: p.text }]}>{CHAT_ADDRESS}</Ltr>
        </Text>
        <Button title={CHAT_COPY.copyAddress} variant="ghost" onPress={onCopyAddress} />
        <Text style={[styles.codeText, { color: p.textMuted }]}>{CHAT_COPY.addressHint}</Text>
      </Card>
    </View>
  );
}

/**
 * One chat linked: its name and its line, and ״לנתק״ at the end. A chat the
 * student has not confirmed says where it comes from instead of its line, with
 * ״לחבר״ and ״לנתק״ under it.
 */
function ChatRow({ row, busy, onApprove, onCut }: {
  row: ChatRowView;
  busy: boolean;
  onApprove: () => void;
  onCut: () => void;
}): React.JSX.Element {
  const name = isolateName(row.title);
  // RLM first: a line that opens with the isolated name has no strong letter of its own before it, so without the
  // mark a Latin name made the whole line left to right (drawn from the left, the Hebrew sentence after it out of order).
  const title = `${RLM}${name}`;
  if (row.needsApproval) {
    return (
      <Row title={title} titleLines={2} subtitle={`${RLM}${CHAT_COPY.approvePrompt(name, isolateName(row.host))}`}>
        <View style={styles.actions}>
          <Button title={CHAT_COPY.approve} disabled={busy} onPress={onApprove} />
          <Button title={CHAT_COPY.cut} variant="danger" disabled={busy} onPress={onCut} />
        </View>
      </Row>
    );
  }
  return (
    <Row
      title={title}
      titleLines={2}
      subtitle={row.line}
      end={(
        // The word, not the button's padding, at the row's end: where the switches above end.
        <View style={styles.endButton}>
          <Button title={CHAT_COPY.cut} variant="danger" disabled={busy} onPress={onCut} />
        </View>
      )}
    />
  );
}

/** Right-to-left mark: makes a line that starts with a name from outside a Hebrew line. */
const RLM = String.fromCharCode(0x200f);

const styles = StyleSheet.create({
  content: { paddingBottom: 80 },
  lead: { fontFamily: font.body, fontSize: type.body, lineHeight: 24, paddingHorizontal: ROW_GUTTER, paddingTop: space.lg },
  // The way in, 12 points under the line on what it is, as the friends' ״להוסיף חבר״ under theirs.
  connect: { paddingHorizontal: ROW_GUTTER, marginTop: space.md, gap: space.md },
  note: { fontFamily: font.body, fontSize: type.small, lineHeight: 22 },
  codeArea: { paddingHorizontal: ROW_GUTTER, marginTop: space.md },
  codeCard: { alignItems: 'center', gap: space.sm },
  code: { fontFamily: font.headingSemi, fontSize: type.display, letterSpacing: 4, fontVariant: ['tabular-nums'], paddingTop: space.sm },
  codeText: { fontFamily: font.body, fontSize: type.small, lineHeight: 22, textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  updated: { fontFamily: font.body, fontSize: type.small, paddingHorizontal: ROW_GUTTER, paddingTop: space.md },
  endButton: { marginEnd: -space.md },
  // The text buttons' words where the page's words start (the button's own padding pulled back, as in ConnectionsScreen).
  cutAll: { paddingHorizontal: ROW_GUTTER, marginTop: space.sm },
  footer: { paddingHorizontal: ROW_GUTTER, marginTop: space.xxl, gap: space.xs },
  start: { alignItems: 'flex-start', marginStart: -space.md },
});
