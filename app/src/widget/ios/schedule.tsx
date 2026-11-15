/**
 * "מערכת" on the iPhone (systemMedium): one day's lessons on the page,
 * paged to any day of the feed's window by the two chevrons — "previous" in
 * the margin at the right, with the day before as a letter, "next" at the
 * left. A tap on a chevron runs in the extension (an App Intent, iOS 17+):
 * the button's `onPress` returns the new `offset`, which `expo-widgets`
 * merges into the entry on screen. The next entry of the timeline (the next
 * lesson boundary) starts from today again.
 *
 * A `'widget'` function: see `kit.tsx` for what it may and may not touch.
 */
import { HStack, Spacer, VStack } from '@expo/ui/swift-ui';
import { frame, padding } from '@expo/ui/swift-ui/modifiers';
import type { Kit } from './kit';
import type { EmptyProps, ScheduleProps } from './props';

export const scheduleLayout = (props: ScheduleProps | EmptyProps, environment: unknown, K: Kit) => {
  'widget';
  const { c, M, T, Mark, Page, Rule, Ruled, LessonCells, Time, Footer, Chevron, PlainButton } = K;

  if (props.kind !== 'schedule') {
    return (
      <Page margin={M}>
        <VStack alignment="leading" spacing={4} modifiers={[padding({ leading: M + 10, trailing: 14, top: 16 })]}>
          <T size={20} w="title" color={c.strong}>{props.title ?? 'מערכת'}</T>
          <T size={14} color={c.muted}>{props.line ?? ''}</T>
        </VStack>
      </Page>
    );
  }

  const last = props.days.length - 1;
  const index = Math.min(Math.max(props.today + (props.offset || 0), 0), last);
  const day = props.days[index]!;
  const go = (delta: number) => () => ({ offset: index + delta - props.today });

  return (
    <Page margin={M}>
      <VStack alignment="leading" spacing={0} modifiers={[padding({ top: 8, bottom: 6 })]}>
        <HStack spacing={0} modifiers={[frame({ height: 46 })]}>
          {day.prev ? (
            <PlainButton onPress={go(-1)} width={M}>
              <Chevron dir="right" />
              <T size={14} w="s" color={c.accent}>{day.prev}</T>
            </PlainButton>
          ) : (
            <Spacer modifiers={[frame({ width: M })]} />
          )}
          <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 10 })]}>
            <HStack spacing={8}>
              <T size={20} w="title" color={c.strong}>{day.title}</T>
              {day.exam ? <Mark text={day.exam} fg={c.onMark} bg={c.mark} /> : null}
            </HStack>
            <HStack spacing={8}>
              <T size={14} color={c.muted}>{day.line}</T>
              {day.change ? <Mark text={day.change} fg={c.change} bg={c.changeSoft} /> : null}
            </HStack>
          </VStack>
          <Spacer />
          {day.hasNext ? (
            <PlainButton onPress={go(1)} width={36}>
              <Chevron dir="left" />
            </PlainButton>
          ) : null}
          <Spacer modifiers={[frame({ width: 8 })]} />
        </HStack>

        <Rule />
        {day.empty ? (
          <Ruled min={26} max={30}>
            <Spacer modifiers={[frame({ width: M + 10 })]} />
            <T size={15} color={c.muted}>{day.empty}</T>
          </Ruled>
        ) : (
          day.rows.map((row, i) => (
            <Ruled key={`${day.title}-${i}`} dashed={row.state === 'now'} min={24} max={30}>
              <Time
                text={row.time}
                color={row.state === 'now' ? c.accent : row.state === 'past' ? c.faint : c.muted}
                bold={row.state === 'now'}
              />
              <LessonCells row={row} size={16} />
            </Ruled>
          ))
        )}

        <Spacer />
        <Footer left={day.more} updated={props.updated} stale={props.stale} inset={M + 10} />
      </VStack>
    </Page>
  );
};
