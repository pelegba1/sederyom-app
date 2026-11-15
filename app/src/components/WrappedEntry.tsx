/**
 * The year in review's row on Today (sketches 2026-11-11): from the last
 * school week to the end of July, "סיכום השנה שלך מוכן" with the year's days,
 * cancellations and tasks under it. It opens the review; the "×" at its end
 * puts it away for that school year (it stays in Settings). With nothing
 * counted behind it, it is not there.
 *
 * Outside those weeks nothing is read and nothing is built. Inside them the
 * class history is read at most once a day (`wrapped/history.ts`).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { DateStr } from '@sederyom/shared';
import { schoolYearStart, type WrappedCard } from '@sederyom/shared/logic/wrapped/types';
import { isDemo } from '../demo/phone';
import { getWrappedEntryClosed, setWrappedEntryClosed } from '../lib/prefs';
import { loadLocalSources } from '../local/source';
import type { RootNavigation } from '../navigation/types';
import { storage } from '../widget/feedCache';
import { WRAPPED_COPY, entryReady, entryShown, entrySummary } from '../wrapped/copy';
import { loadWrapped, wrappedNow } from '../wrapped/load';
import { AppIcon } from './AppIcon';
import { Row } from './notebook';
import { MIN_TOUCH, usePalette } from './ui';

export function WrappedEntry({ today }: { today: DateStr }): React.JSX.Element | null {
  const p = usePalette();
  const navigation = useNavigation<RootNavigation>();
  const [closed, setClosed] = useState(() => getWrappedEntryClosed());
  // The demo's days are made up: it has no year to sum.
  const shown = entryShown(today, closed) && !isDemo();
  const [cards, setCards] = useState<WrappedCard[] | null>(null);

  useEffect(() => {
    if (!shown) return undefined;
    let gone = false;
    const demo = isDemo();
    setCards(wrappedNow(storage, loadLocalSources(), demo));
    void loadWrapped(storage, loadLocalSources(), fetch, demo).then((view) => {
      if (!gone) setCards(view.cards);
    });
    return () => { gone = true; };
  }, [shown, today]);

  // With nothing counted yet there is nothing to open: the row waits for the first day or task.
  if (!shown || !cards || !entryReady(cards)) return null;
  const summary = entrySummary(cards);
  return (
    <Row
      accessibilityRole="button"
      accessibilityLabel={summary ? `${WRAPPED_COPY.entryTitle}. ${summary}` : WRAPPED_COPY.entryTitle}
      accessibilityHint={WRAPPED_COPY.open}
      onPress={() => navigation.navigate('Wrapped')}
      title={WRAPPED_COPY.entryTitle}
      subtitle={summary ?? undefined}
      end={(
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={WRAPPED_COPY.entryClose}
          onPress={() => {
            const year = schoolYearStart(today);
            setWrappedEntryClosed(year);
            setClosed(year);
          }}
          style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}
        >
          <AppIcon name="close" color={p.textMuted} size={20} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  close: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
});
