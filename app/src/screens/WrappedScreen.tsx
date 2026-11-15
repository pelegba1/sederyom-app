/**
 * סיכום שנה (design 2026-11-10 §9, sketches 2026-11-11): the year so far as a
 * story of cards, one strong number on each with a short line under it.
 *
 * A notebook page, full screen: ruled lines, the red margin line at the start
 * edge, the number in the display face over the yellow highlighter (a
 * cancelled lesson's in the teacher's red pen). A bar at the top has a part
 * for each card and fills from the start edge. A tap on the end half of the
 * page goes on, on the start half goes back, and a pull down closes.
 *
 * The cards come from `wrapped/load.ts`: at once from what the phone kept,
 * and again once the class history was read. A card with too little behind it
 * is simply not there. "מאיפה המספר" opens the rows a number was counted from.
 * "שיתוף" sends the card as an image through the phone's share sheet
 * (`wrapped/share.ts`); grades and attendance say "נשאר אצלך" there instead.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, PixelRatio, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import type { WrappedCard } from '@sederyom/shared/logic/wrapped/index';
import { AppIcon } from '../components/AppIcon';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { MIN_TOUCH, Text, usePalette } from '../components/ui';
import { CardWords, Page, RULE, ShareImage, TEXT_MAX, WORDS_START } from '../components/WrappedFace';
import { isDemo } from '../demo/phone';
import { loadLocalSources } from '../local/source';
import type { RootNavigation } from '../navigation/types';
import { font, radius, space, type } from '../theme';
import { storage } from '../widget/feedCache';
import { WRAPPED_COPY, cardCopy, closeOnce, recordRow, type CardCopy } from '../wrapped/copy';
import { storedHistory } from '../wrapped/history';
import { loadWrapped, wrappedNow, type WrappedView } from '../wrapped/load';
import { SHARE_IMAGE, canShare, captureSize, shareCard } from '../wrapped/share';

export function WrappedScreen({ navigation }: { navigation: RootNavigation }): React.JSX.Element {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const demo = isDemo();
  // With a history kept, the cards are there at once; without one the first read is waited for,
  // so the opening never says "nothing kept" a moment before the days arrive.
  const [view, setView] = useState<WrappedView | null>(() => (
    demo || storedHistory(storage) ? { cards: wrappedNow(storage, loadLocalSources(), demo), state: 'fresh' } : null
  ));
  const [id, setId] = useState<WrappedCard['id']>('intro');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const toast = useToast();
  const image = useRef<View>(null);

  useEffect(() => {
    let gone = false;
    void loadWrapped(storage, loadLocalSources(), fetch, demo).then((next) => {
      if (!gone) setView(next);
    });
    return () => { gone = true; };
  }, [demo]);

  const cards = view?.cards ?? [];
  // The open card is kept by its id: a read that adds cards must not move the reader to another one.
  const index = Math.max(0, cards.findIndex((c) => c.id === id));
  const card = cards[index] ?? null;
  const copy = useMemo(() => (card ? cardCopy(card) : null), [card]);

  // Once: a fast second tap on the last card would close the screen under this one too.
  const close = useRef(closeOnce(() => navigation.goBack())).current;
  const go = (step: 1 | -1): void => {
    const next = cards[index + step];
    if (next) setId(next.id);
    else if (step === 1) close();
  };

  const share = (): void => {
    if (!card || sharing) return;
    setSharing(true);
    const capture = (): Promise<string> => captureRef(image, { format: 'png', result: 'tmpfile', ...captureSize(Platform.OS, PixelRatio.get()) });
    shareCard(card, capture, Sharing, releaseCapture)
      .then((done) => {
        if (done === 'unavailable') toast.show(WRAPPED_COPY.shareUnavailable);
      })
      .catch(() => toast.show(WRAPPED_COPY.shareFailed))
      .finally(() => setSharing(false));
  };

  // A pull down closes. Taps stay with the two halves under it.
  const pull = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => g.dy > PULL_START && g.dy > 2 * Math.abs(g.dx),
    onPanResponderRelease: (_e, g) => {
      if (g.dy > PULL_CLOSE) close();
    },
  })).current;

  // The number starts on a ruled line: the lines are counted from the top of the screen.
  const bodyTop = Math.ceil((insets.top + HEADER_HEIGHT + height * BODY_TOP) / RULE) * RULE - insets.top;

  const notice = view?.state === 'kept' ? WRAPPED_COPY.kept : view?.state === 'missing' ? WRAPPED_COPY.missing : null;

  return (
    <View style={[styles.page, { backgroundColor: p.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* The image that is shared, kept off the screen; only a card that may be shared has one. */}
      {card && copy && canShare(card) ? (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.offscreen}>
          <ShareImage ref={image} copy={copy} />
        </View>
      ) : null}
      <Page height={height} />

      {card && copy ? (
        <View
          accessible
          accessibilityLabel={spoken(copy, index, cards.length)}
          pointerEvents="none"
          style={[styles.content, { paddingTop: bodyTop }]}
        >
          <CardWords copy={copy}>
            {card.id === 'intro' && notice ? <Text maxScale={TEXT_MAX} style={[styles.notice, { color: p.textMuted }]}>{notice}</Text> : null}
          </CardWords>
        </View>
      ) : (
        <View style={[styles.content, styles.waiting]}>
          <Text style={[styles.line, { color: p.textMuted }]}>{WRAPPED_COPY.loading}</Text>
        </View>
      )}

      {/* The two halves: the first is at the start edge (the right, in Hebrew) and goes back. */}
      <View style={[StyleSheet.absoluteFill, styles.halves]} {...pull.panHandlers}>
        <Pressable accessibilityRole="button" accessibilityLabel={WRAPPED_COPY.back} disabled={index === 0} onPress={() => go(-1)} style={styles.half} />
        <Pressable accessibilityRole="button" accessibilityLabel={WRAPPED_COPY.next} disabled={!card} onPress={() => go(1)} style={styles.half} />
      </View>

      <View style={[styles.header, { top: insets.top }]}>
        <View style={styles.bar}>
          {cards.map((c, i) => (
            <View key={c.id} style={[styles.barPart, { backgroundColor: i <= index ? p.accent : p.border }]} />
          ))}
        </View>
        <View style={styles.headerRow}>
          <Text maxScale={TEXT_MAX} numberOfLines={1} style={[styles.kicker, { color: p.textMuted }]}>{copy?.kicker ?? ''}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={WRAPPED_COPY.close}
            onPress={close}
            style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}
          >
            <AppIcon name="close" color={p.textMuted} size={22} />
          </Pressable>
        </View>
      </View>

      {card && copy ? (
        <View style={[styles.footer, { bottom: insets.bottom + space.md }]}>
          {copy.source ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={WRAPPED_COPY.source}
              onPress={() => setSourceOpen(true)}
              style={({ pressed }) => [styles.footAction, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text maxScale={TEXT_MAX} style={[styles.source, { color: p.accent }]}>{WRAPPED_COPY.source}</Text>
            </Pressable>
          ) : <View />}
          {card.id === 'outro' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={WRAPPED_COPY.again}
              onPress={() => setId(cards[0]?.id ?? 'intro')}
              style={({ pressed }) => [styles.pill, { backgroundColor: p.accentFill, opacity: pressed ? 0.75 : 1 }]}
            >
              <Text maxScale={TEXT_MAX} style={[styles.pillText, { color: p.onAccentFill }]}>{WRAPPED_COPY.again}</Text>
            </Pressable>
          ) : canShare(card) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={WRAPPED_COPY.share}
              accessibilityState={{ busy: sharing }}
              disabled={sharing}
              onPress={share}
              style={({ pressed }) => [styles.pill, { backgroundColor: p.accentFill, opacity: sharing ? 0.6 : pressed ? 0.75 : 1 }]}
            >
              <Text maxScale={TEXT_MAX} style={[styles.pillText, { color: p.onAccentFill }]}>{WRAPPED_COPY.share}</Text>
            </Pressable>
          ) : (
            <Text maxScale={TEXT_MAX} style={[styles.own, { color: p.textMuted }]}>{WRAPPED_COPY.own}</Text>
          )}
        </View>
      ) : null}

      {card && copy?.source ? (
        <Sheet visible={sourceOpen} onClose={() => setSourceOpen(false)} title={copy.source.title}>
          <Text style={[styles.note, { color: p.textMuted }]}>{copy.source.note}</Text>
          {card.records.map((r, i) => {
            const row = recordRow(r);
            return (
              <View key={i} style={[styles.record, { borderTopColor: p.border }]}>
                <Text style={[styles.recordLead, { color: p.textMuted }]}>{row.lead}</Text>
                <Text
                  numberOfLines={2}
                  style={[styles.recordText, { color: row.struck ? p.cancel : p.text }, row.struck ? styles.struck : null]}
                >
                  {row.text}
                </Text>
                {row.end ? <Text style={[styles.recordEnd, { color: p.text }]}>{row.end}</Text> : null}
              </View>
            );
          })}
        </Sheet>
      ) : null}
    </View>
  );
}

/** What a screen reader says for the card: where it is in the story, then its words in order. */
function spoken(copy: CardCopy, index: number, count: number): string {
  const line = copy.line?.map((s) => s.text).join('') ?? null;
  return [`${index + 1} מתוך ${count}`, copy.kicker, copy.hero.replace('\n', ' '), copy.unit, line, copy.since].filter(Boolean).join('. ');
}

/** The bar and the row under it. */
const HEADER_HEIGHT = 64;
/** How far down the page the number starts, as a part of the screen's height. */
const BODY_TOP = 0.14;
const PULL_START = 12;
const PULL_CLOSE = 80;

const styles = StyleSheet.create({
  page: { flex: 1, direction: 'rtl' },
  content: { flex: 1, paddingStart: WORDS_START, paddingEnd: space.xl, alignItems: 'flex-start' },
  waiting: { justifyContent: 'center' },
  line: { fontFamily: font.body, fontSize: 20, lineHeight: RULE, marginTop: RULE },
  notice: { fontFamily: font.body, fontSize: type.body, lineHeight: RULE },
  // Far past the start edge: laid out and drawn for the capture, never seen.
  offscreen: { position: 'absolute', top: 0, insetInlineStart: -4 * SHARE_IMAGE.points.width },
  halves: { flexDirection: 'row' },
  half: { flex: 1 },
  header: { position: 'absolute', insetInline: 0, height: HEADER_HEIGHT, paddingTop: space.md },
  bar: { flexDirection: 'row', gap: 4, paddingHorizontal: space.lg },
  barPart: { flex: 1, height: 3, borderRadius: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingStart: WORDS_START, paddingEnd: space.xs },
  kicker: { flex: 1, fontFamily: font.bodySemi, fontSize: type.body },
  close: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  footer: {
    position: 'absolute', insetInline: 0, minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingStart: WORDS_START, paddingEnd: space.lg,
  },
  footAction: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  source: { fontFamily: font.bodySemi, fontSize: type.body, textDecorationLine: 'underline' },
  own: { fontFamily: font.bodySemi, fontSize: type.body },
  pill: { minHeight: MIN_TOUCH, borderRadius: radius.pill, paddingHorizontal: space.xl, justifyContent: 'center' },
  pillText: { fontFamily: font.headingSemi, fontSize: type.body },
  note: { fontFamily: font.body, fontSize: type.small, lineHeight: 22, marginBottom: space.md },
  record: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44, paddingVertical: space.sm, borderTopWidth: 1 },
  recordLead: { fontFamily: font.body, fontSize: type.small },
  recordText: { flex: 1, fontFamily: font.bodySemi, fontSize: type.body },
  struck: { textDecorationLine: 'line-through' },
  recordEnd: { fontFamily: font.headingSemi, fontSize: type.body },
});
