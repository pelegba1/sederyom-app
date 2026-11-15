/**
 * מצב חיבורים (design panel 05, plan F2/F7): one section of the page per
 * source, between ruled lines (plan §16.1, no cards). Each says, in plain
 * words, whether it is connected — "מחובר" in green with a dot, or the
 * problem in the red pen — as whom, what it is used for in one short line,
 * and when it was last read — the per-source times are what people trust —
 * and offers what there is to do: connect, or connect again. The raw error
 * and "ניתוק" (a red text button) stay under "פרטים טכניים": three red
 * "ניתוק" on the rows were the loudest thing on the screen (Wave 9 re-rate).
 *
 * The verdict is driven by `configured`, `needsReauth` and the Hebrew
 * `message` of each source (lib/connections.ts), never by its `state`.
 *
 * Under משוב's "פרטים טכניים", besides the login times: what the phone did
 * with the app closed, when Mashov's login ends, how many messages the last
 * read brought, whether the school uses Mashov's timetable changes, and the
 * "מכשיר אישי" trial, with its switch (`MashovPhoneDetail`).
 *
 * On a parent's phone (parents mode, stage 3) Mashov is the parent's own
 * login, and the parents' check sits under the connections, with its report.
 *
 * In the demo (`demo/mode.ts`) every source says "הדגמה", in the muted ink,
 * with what it would bring and nothing to do: no connecting, no "ניתוק", no
 * technical details, and one line under them that none of it is real.
 */
import React, { useState } from 'react';
import {
  Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { SourceStatus } from '@sederyom/shared';
import { lastBackgroundRun } from '../background/refresh';
import { DEMO_COPY } from '../demo/mode';
import { isDemo } from '../demo/phone';
import { connectGoogle as signInToGoogle } from '../google/connect';
import {
  DEVICE_LOGIN_STRIKES, deviceLoginMode, deviceLoginState, hasDevicePass, setDeviceLoginOn, type DeviceLoginMode,
} from '../mashov/device';
import { localRead, localStatus, timetableChangesEnabled, timetableChangesFailed } from '../mashov/sync';
import { storage } from '../widget/feedCache';
import { keys, useChildren, useDisconnectGoogle, useDisconnectMashov, useOnlyChildName, useSettings, useStatus, useSyncNow } from '../api/hooks';
import { AppIcon } from '../components/AppIcon';
import { MashovRenewDetail } from '../components/MashovRenewSheet';
import { ROW_END, ROW_GUTTER } from '../components/notebook';
import { ParentCheckPanel } from '../components/ParentCheckPanel';
import { useToast } from '../components/Toast';
import { Button, ErrorState, Loading, Ltr, MIN_TOUCH, Screen, Text, usePalette } from '../components/ui';
import { API_BASE_URL, isConfigured } from '../config';
import {
  CARD_NAMES, CONNECTION_COPY, KIND_LABELS, PARENT_MASHOV_COPY, checkedAgo, connectionCards, mailReadLine, movedToGoogleLabel, sourceKind,
  sourceMessage, type CardId, type SourceKind,
} from '../lib/connections';
import { isParentReadError } from '../mashov/parents';
import { shortDateTime } from '../lib/format';
import { displayClassName } from '../lib/onboarding';
import { shownChildName } from '../lib/settingsSummary';
import { font, space, type } from '../theme';
import type { RootNavigation } from '../navigation/types';

type Palette = ReturnType<typeof usePalette>;

/** Shown when a screen cannot load; the raw reason is not something to read. */
export const LOAD_ERROR_TEXT = 'בדקו את החיבור לאינטרנט ונסו שוב.';

/** The status's colour: green when connected, the red pen for a problem, muted otherwise. */
function toneOf(kind: SourceKind, p: Palette): string {
  switch (kind) {
    case 'ok':
      return p.ok;
    case 'reauth':
    case 'trouble':
      return p.cancel;
    default:
      return p.textMuted;
  }
}

/**
 * A row that opens and closes what is under it: "פרטים טכניים", "מתקדם", a
 * question in the help screen. Closed by default.
 *
 * It opens in place, so its arrow points down, and up while open — as the
 * folds of the timeline and of a long message do. A left arrow is for a row
 * that goes to another screen (Daniel: these pointed the wrong way).
 */
export function Disclosure({
  title, children, initiallyOpen = false, style, titleStyle,
}: {
  title: string;
  children: React.ReactNode;
  initiallyOpen?: boolean;
  style?: StyleProp<ViewStyle>;
  /** The title's look, when it is more than a quiet fold (a question in help). */
  titleStyle?: StyleProp<TextStyle>;
}): React.JSX.Element {
  const p = usePalette();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.disclosure, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[{ flexShrink: 1, fontFamily: font.bodyMedium, fontSize: type.small, color: p.textMuted }, titleStyle]}>{title}</Text>
        <View style={open ? styles.flip : null}>
          <AppIcon name="chevronDown" color={p.textMuted} size={16} />
        </View>
      </Pressable>
      {open ? <View style={{ paddingBottom: space.sm }}>{children}</View> : null}
    </View>
  );
}

export function ConnectionsScreen({ navigation }: { navigation: RootNavigation }): React.JSX.Element {
  const p = usePalette();
  const qc = useQueryClient();
  const status = useStatus();
  const settings = useSettings();
  const sync = useSyncNow();
  const disconnectGoogle = useDisconnectGoogle();
  const disconnectMashov = useDisconnectMashov();
  const children = useChildren();
  const [onlyChildName] = useOnlyChildName();
  const toast = useToast();

  if (status.isLoading) return <Screen><Loading /></Screen>;
  if (status.isError || !status.data) {
    return (
      <Screen>
        <ErrorState message={LOAD_ERROR_TEXT} onRetry={() => void status.refetch()} />
      </Screen>
    );
  }

  const cards = connectionCards(status.data.sources);
  const demo = isDemo();
  const examsToCalendar = settings.data?.settings.examsToCalendar ?? true;
  // A parent logs in to Mashov with the parent's own details (parents mode, stage 3), and has the check.
  const parent = settings.data?.settings.audience === 'parent';
  // Whose timetable the Shahaf line speaks of: a parent's child, by the parent's name for it; else the class.
  const whose = shownChildName({
    parent, listName: children.data?.list.find((c) => c.shown)?.name ?? null, onlyName: onlyChildName,
  }) || displayClassName(settings.data?.settings.className ?? '');

  const disconnects = {
    google: { mutation: disconnectGoogle, title: 'לנתק את Google?', body: CONNECTION_COPY.googleDisconnect, done: CONNECTION_COPY.googleDisconnected },
    mashov: { mutation: disconnectMashov, title: 'לנתק את משוב?', body: CONNECTION_COPY.mashovDisconnect, done: CONNECTION_COPY.mashovDisconnected },
  } as const;

  const confirmDisconnect = (id: keyof typeof disconnects): void => {
    const { mutation, title, body, done } = disconnects[id];
    Alert.alert(title, body, [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'ניתוק',
        style: 'destructive',
        onPress: () =>
          mutation.mutate(undefined, {
            onSuccess: () => toast.show(done),
            onError: () => toast.show('לא הצלחנו לנתק. אפשר לנסות שוב'),
          }),
      },
    ]);
  };

  const connectGoogle = (): void => {
    // "מחובר" as soon as Google says yes; the rest once the first read is in.
    signInToGoogle(() => void qc.invalidateQueries({ queryKey: keys.status }), (n) => toast.show(movedToGoogleLabel(n)))
      .then(() => qc.invalidateQueries())
      .catch(() => toast.show('לא הצלחנו להתחבר ל-Google. אפשר לנסות שוב בעוד רגע'));
  };
  const connectMashov = (): void => navigation.navigate('MashovLogin');

  /**
   * "ניתוק", in the red pen: a text button, not a box. It sits in the source's
   * "פרטים טכניים" fold, not on its row: three red "ניתוק" were the loudest
   * thing on the screen (the Wave 9 re-rate).
   */
  const disconnect = (id: keyof typeof disconnects, busy: boolean): React.ReactNode => (
    <Button title="ניתוק" variant="danger" disabled={busy} onPress={() => confirmDisconnect(id)} />
  );

  /** What each source says in its one line, what there is to do about it on its row, and its "ניתוק". */
  const partsOf = (id: CardId, source: SourceStatus): { line: string; actions: React.ReactNode; off: React.ReactNode } => {
    const kind = sourceKind(source);
    // What each would bring, and nothing to do about a connection that is not there.
    if (demo && id === 'mashov') return { line: CONNECTION_COPY.mashovUse, actions: null, off: null };
    // The demo writes no exams to Google (`demoSettings`): its line never says they are there.
    if (demo && id === 'google') return { line: CONNECTION_COPY.googleUseNoExams, actions: null, off: null };
    switch (id) {
      case 'google':
        return {
          line: examsToCalendar ? CONNECTION_COPY.googleUse : CONNECTION_COPY.googleUseNoExams,
          actions: !source.configured ? <Button title="להתחבר עם Google" onPress={connectGoogle} />
            : source.needsReauth ? <Button title="לאשר מחדש את Google" onPress={connectGoogle} /> : null,
          off: source.configured ? disconnect('google', disconnectGoogle.isPending) : null,
        };
      case 'mashov':
        // A parent's phone that never read Mashov: the way in, as the parent. A phone with no
        // login reads as "connect again" once a read found none.
        if (parent && source.lastOkAt === null && !isParentReadError(source.message)) {
          return {
            line: PARENT_MASHOV_COPY.use,
            actions: <Button title={PARENT_MASHOV_COPY.connect} onPress={connectMashov} />,
            off: source.configured ? disconnect('mashov', disconnectMashov.isPending) : null,
          };
        }
        return {
          line: source.configured ? CONNECTION_COPY.mashovDrops : CONNECTION_COPY.mashovUse,
          actions: !source.configured ? <Button title="להתחבר למשוב" onPress={connectMashov} />
            : kind === 'reauth' ? <Button title="להתחבר שוב" onPress={connectMashov} />
              : kind === 'trouble' ? <Button title="להתחבר שוב" variant="ghost" onPress={connectMashov} /> : null,
          off: source.configured ? disconnect('mashov', disconnectMashov.isPending) : null,
        };
      case 'shahaf':
        return { line: whose ? `המערכת והשינויים של ${whose}` : 'המערכת והשינויים של הכיתה', actions: null, off: null };
      default:
        // The exam board: from a link or a file, the class's or the person's own (the card's name says "לוח המבחנים").
        return { line: 'המבחנים, מקישור או מקובץ', actions: null, off: null };
    }
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={status.isFetching} onRefresh={() => void status.refetch()} tintColor={p.accent} />}
      >
        {cards.map(({ id, source }) => {
          const { line, actions, off } = partsOf(id, source);
          return <SourceSection key={id} id={id} source={source} line={line} actions={actions} off={off} demo={demo} />;
        })}

        {parent && !demo ? (
          <View style={styles.gutter}>
            <ParentCheckPanel />
          </View>
        ) : null}

        {demo ? (
          <View style={styles.gutter}>
            <Text style={[detailStyle(p), { marginTop: space.lg }]}>{DEMO_COPY.connections}</Text>
          </View>
        ) : (
          <View style={styles.gutter}>
            <View style={{ marginTop: space.lg, alignItems: 'flex-start' }}>
              <Button
                title={sync.isPending ? 'בודקים…' : 'לבדוק עכשיו'}
                variant="ghost"
                disabled={sync.isPending}
                onPress={() =>
                  sync.mutate(undefined, {
                    onSuccess: () => toast.show('בדקנו עכשיו'),
                    onError: () => toast.show('לא הצלחנו לבדוק עכשיו. אפשר לנסות שוב בעוד רגע'),
                  })}
              />
            </View>

            <Text style={[detailStyle(p), { marginTop: space.lg }]}>על תקלות בחיבור תמיד נודיע לך.</Text>

            <Disclosure title="מתקדם" style={{ marginTop: space.sm }}>
              <Text selectable style={detailStyle(p)}>
                {'כתובת החיבור: '}
                <Ltr style={detailStyle(p)}>{isConfigured ? hostOf(API_BASE_URL) : 'לא הוגדרה'}</Ltr>
              </Text>
            </Disclosure>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * One source, as a section of the page: its name and its status on the first
 * line, the account, its one line, what the server says is wrong, the way to
 * connect (again) when there is one, when it was last read, and the fold with
 * the raw details and "ניתוק" (`off`).
 */
function SourceSection({
  id, source, line, actions, off, demo = false,
}: {
  id: CardId;
  source: SourceStatus;
  line: string;
  actions: React.ReactNode;
  /** "ניתוק", at the end of the "פרטים טכניים" fold. */
  off: React.ReactNode;
  /** The demo's: "הדגמה", its line, and nothing else. */
  demo?: boolean;
}): React.JSX.Element {
  const p = usePalette();
  const kind = sourceKind(source);
  const tone = demo ? p.textMuted : toneOf(kind, p);
  const message = sourceMessage(source);
  const details = technicalDetails(source);
  const account = id === 'google' && source.configured ? source.account : null;
  return (
    <View style={[styles.section, { borderBottomColor: p.border }]}>
      <View style={styles.rowBetween}>
        <Text accessibilityRole="header" style={{ flexShrink: 1, fontFamily: font.bodySemi, fontSize: type.title, color: p.text }}>{CARD_NAMES[id]}</Text>
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: tone }]} />
          <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: tone }}>{demo ? DEMO_COPY.status : KIND_LABELS[kind]}</Text>
        </View>
      </View>

      {account ? <Ltr style={{ fontFamily: font.bodyMedium, fontSize: type.small, color: p.textMuted }}>{account}</Ltr> : null}
      <Text style={detailStyle(p)}>{line}</Text>

      {/* "לא מחובר" and the connect button already say it all. */}
      {message && kind !== 'off' ? (
        <Text style={{ fontFamily: font.body, fontSize: type.body, color: p.text, lineHeight: 22, marginTop: space.xs }}>{message}</Text>
      ) : null}

      {actions ? <View style={styles.actions}>{actions}</View> : null}

      {demo ? null : <CheckedLine source={source} />}

      {/* Mashov's always: its "מכשיר אישי" switch is there, before the first login too. */}
      {!demo && (details.length > 0 || off || id === 'mashov') ? (
        <Disclosure title="פרטים טכניים">
          {details.map((detail) => (
            <Text key={`${detail.label}${detail.value}`} selectable style={detailStyle(p)}>
              {detail.label ? `${detail.label}: ` : null}
              <Ltr style={detailStyle(p)}>{detail.value}</Ltr>
            </Text>
          ))}
          {/* W6-1: how the last automatic reconnect went, for the student to read and report. */}
          {id === 'mashov' ? <MashovRenewDetail style={detailStyle(p)} /> : null}
          {id === 'mashov' ? <MashovPhoneDetail style={detailStyle(p)} /> : null}
          {off ? <View style={styles.off}>{off}</View> : null}
        </Disclosure>
      ) : null}
    </View>
  );
}

function detailStyle(p: Palette) {
  return { fontFamily: font.body, fontSize: type.small, color: p.textMuted, lineHeight: 20 } as const;
}

/** "בדקנו לפני 5 דקות", and under it "השינוי האחרון באתר: 7.10, 16:01": the times people trust. */
function CheckedLine({ source }: { source: SourceStatus }): React.JSX.Element | null {
  const p = usePalette();
  if (!source.configured || !source.lastOkAt) return null;
  const style = detailStyle(p);
  return (
    <>
      <Text style={style}>{checkedAgo(source.lastOkAt)}</Text>
      {source.sourceFreshness ? (
        <Text style={style}>
          {'השינוי האחרון באתר: '}
          <Ltr style={style}>{shortDateTime(source.sourceFreshness)}</Ltr>
        </Text>
      ) : null}
    </>
  );
}

/** Raw, for whoever debugs: the last error as recorded, and Mashov's login times. */
function technicalDetails(source: SourceStatus): { label: string | null; value: string }[] {
  const lines: { label: string | null; value: string }[] = [];
  if (source.lastError) lines.push({ label: null, value: source.lastError });
  const session = source.session;
  if (session?.capturedAt) lines.push({ label: 'נכנסת למשוב', value: shortDateTime(session.capturedAt) });
  if (session?.lastOkAt) lines.push({ label: 'עדכון אחרון שהצליח', value: shortDateTime(session.lastOkAt) });
  if (session?.failedAt) lines.push({ label: 'משוב ניתק', value: shortDateTime(session.failedAt) });
  if (source.consecutiveFailures > 0) lines.push({ label: 'ניסיונות שלא הצליחו ברצף', value: String(source.consecutiveFailures) });
  return lines;
}

/** How long a Mashov login lasts before Mashov ends it. */
const MASHOV_LOGIN_HOURS = 8;

/** A time in the details, or "עוד לא". */
function when(iso: string | null | undefined): string {
  return iso ? shortDateTime(iso) : 'עוד לא';
}

/** Whether the next Mashov login ticks "מכשיר אישי", and why not. */
const DEVICE_MODE_LINE: Record<DeviceLoginMode, string> = {
  on: 'בכניסה למשוב מסומן ״מכשיר אישי״.',
  paused: 'משוב דחה את הכניסה האחרונה עם ״מכשיר אישי״. הכניסה הבאה תהיה בלי הסימון, ואחרי כניסה שמצליחה הוא יחזור.',
  stopped: `משוב דחה ${DEVICE_LOGIN_STRIKES} כניסות ברצף עם ״מכשיר אישי״, ולכן הוא כבר לא מסומן. אפשר לסמן אותו שוב כאן.`,
  off: 'בכניסה למשוב לא מסומן ״מכשיר אישי״, כי הסימון כובה כאן.',
};

/**
 * What the phone does with Mashov by itself, for whoever debugs: the last
 * refresh with the app closed (plan Phase 2, step 4), when Mashov will end
 * the login, how many messages the last read brought, whether the school
 * uses Mashov's timetable changes (nothing until a read has asked), and the
 * "מכשיר אישי" trial: whether Mashov gave the phone a pass, how the last
 * login with it went, whether the next login ticks the box
 * (`deviceLoginMode`), and the switch.
 */
function MashovPhoneDetail({ style }: { style: StyleProp<TextStyle> }): React.JSX.Element {
  const [deviceMode, setDeviceMode] = useState(() => deviceLoginMode(storage));
  const run = lastBackgroundRun();
  const mashov = localStatus(storage);
  const device = deviceLoginState(storage);
  const lastRead = localRead(storage);
  const mashovEntities = lastRead?.entities;
  const mailLine = mailReadLine(lastRead?.counts);
  const changesOn = timetableChangesEnabled(mashovEntities);
  // The last read could not ask for them: the changes shown are the read before's.
  const changesFailed = timetableChangesFailed(mashovEntities);
  const endsAt = mashov.loginAt ? new Date(Date.parse(mashov.loginAt) + MASHOV_LOGIN_HOURS * 60 * 60_000).toISOString() : null;
  const timed: { label: string; at: string | null | undefined; note?: string }[] = [
    { label: 'רענון אחרון כשהאפליקציה סגורה', at: run?.at, note: run ? (run.by === 'task' ? (Platform.OS === 'ios' ? 'של iOS' : 'של Android') : 'של מסך הבית') : undefined },
    ...(mashov.loginAt ? [{ label: 'סוף החיבור למשוב, בערך', at: endsAt }] : []),
  ];
  return (
    <>
      {timed.map((line) => (
        <Text key={line.label} selectable style={style}>
          {`${line.label}: `}
          <Ltr style={style}>{when(line.at)}</Ltr>
          {line.note ? ` (${line.note})` : null}
        </Text>
      ))}
      {mailLine ? <Text selectable style={style}>{mailLine}</Text> : null}
      {run && run.problems.length > 0 ? <Text selectable style={style}>{`תקלות ברענון הזה: ${run.problems.join('; ')}`}</Text> : null}
      {changesFailed || changesOn !== null ? (
        <Text selectable style={style}>
          {`שינויי מערכת במשוב: ${changesFailed ? 'הקריאה האחרונה נכשלה' : changesOn ? 'בית הספר משתמש בהם' : 'בית הספר לא משתמש בהם'}`}
        </Text>
      ) : null}
      <Text selectable style={style}>{`אישור ״מכשיר אישי״: ${hasDevicePass(storage) ? 'שמור בטלפון' : 'אין'}`}</Text>
      {device.lastLogin ? (
        <Text selectable style={style}>
          {`בכניסה האחרונה משוב ${device.lastLogin.gotPass ? 'נתן אישור' : 'לא נתן אישור'} (HTTP ${device.lastLogin.status}): `}
          <Ltr style={style}>{when(device.lastLogin.at)}</Ltr>
        </Text>
      ) : null}
      {device.lastTry ? (
        <Text selectable style={style}>
          {`חיבור אחרון עם האישור ${device.lastTry.ok ? 'הצליח' : 'לא הצליח'} (${device.lastTry.detail}): `}
          <Ltr style={style}>{when(device.lastTry.at)}</Ltr>
        </Text>
      ) : null}
      <Text style={style}>{DEVICE_MODE_LINE[deviceMode]}</Text>
      <View style={styles.off}>
        <Button
          title={deviceMode === 'on' ? 'לא לסמן ״מכשיר אישי״' : 'לסמן ״מכשיר אישי״ בכניסה הבאה'}
          variant="ghost"
          onPress={() => {
            setDeviceLoginOn(storage, deviceMode !== 'on');
            setDeviceMode(deviceLoginMode(storage));
          }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 60 },
  /** The page's gutter, where the sections' text starts. */
  gutter: { paddingHorizontal: ROW_GUTTER },
  section: {
    paddingStart: ROW_GUTTER, paddingEnd: ROW_END, paddingVertical: space.lg, gap: space.xs, borderBottomWidth: 1,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  // "ניתוק" at the fold's end: a text button, its words where the details' words start.
  off: { alignItems: 'flex-start', marginStart: -space.md, marginTop: space.xs },
  disclosure: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, minHeight: MIN_TOUCH },
  flip: { transform: [{ rotate: '180deg' }] },
});
