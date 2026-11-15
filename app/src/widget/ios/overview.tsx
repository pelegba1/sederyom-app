/**
 * "סדר יום" on the iPhone (systemLarge): the day at a glance on one page.
 * Each ruled line holds a lesson (time in the margin, then the subject) and,
 * at its end, a line of what surrounds the lessons — homework due, the next
 * exam on the highlighter, the tasks due, the calendar — in the order
 * `overviewSideLayout` spends the lines (worked out in `props.ts`).
 *
 * A `'widget'` function: see `kit.tsx` for what it may and may not touch.
 */
import { HStack, Spacer, VStack } from '@expo/ui/swift-ui';
import { frame, padding } from '@expo/ui/swift-ui/modifiers';
import type { Kit } from './kit';
import type { EmptyProps, OverviewProps, SideLine } from './props';

export const overviewLayout = (props: OverviewProps | EmptyProps, environment: unknown, K: Kit) => {
  'widget';
  const { c, M, tone, T, Mark, Page, Rule, Ruled, LessonCells, Time, Footer } = K;
  const LESSON = 140;

  if (props.kind !== 'overview') {
    return (
      <Page margin={M}>
        <VStack alignment="leading" spacing={4} modifiers={[padding({ leading: M + 10, trailing: 14, top: 16 })]}>
          <T size={20} w="title" color={c.strong}>{props.title ?? 'סדר יום'}</T>
          <T size={14} color={c.muted}>{props.line ?? ''}</T>
        </VStack>
      </Page>
    );
  }

  const Side = ({ line }: { line: SideLine }) => {
    switch (line.kind) {
      case 'head': return <T size={13} w="b" color={c.muted}>{line.text}</T>;
      case 'exam': return <Mark text={line.text} fg={c.onMark} bg={c.mark} size={13} />;
      case 'ok': return <T size={14} color={c.ok}>{line.text}</T>;
      case 'task':
        return (
          <HStack spacing={6}>
            <T size={14} color={c.text}>{line.text}</T>
            <Spacer minLength={4} />
            {line.when ? <T size={13} w="b" color={tone(line.whenTone)} fixed>{line.when}</T> : null}
          </HStack>
        );
      case 'blank': return <Spacer />;
      default: return <T size={14} color={c.text}>{line.text}</T>;
    }
  };

  return (
    <Page margin={M}>
      <VStack alignment="leading" spacing={0} modifiers={[padding({ top: 10, bottom: 6 })]}>
        <HStack spacing={8} modifiers={[frame({ height: 46 }), padding({ leading: M + 10, trailing: 14 })]}>
          <VStack alignment="leading" spacing={2}>
            <T size={20} w="title" color={c.strong}>{props.title}</T>
            <T size={14} color={c.muted}>{props.line}</T>
          </VStack>
          <Spacer />
          {props.change ? <Mark text={props.change} fg={c.change} bg={c.changeSoft} /> : null}
        </HStack>
        <Rule />
        {props.rows.map((row, i) => (
          <Ruled key={`o-${i}`} dashed={row.lesson?.state === 'now'} min={24} max={30}>
            {row.lesson ? (
              <Time
                text={row.lesson.time}
                color={row.lesson.state === 'now' ? c.accent : row.lesson.state === 'past' ? c.faint : c.muted}
                bold={row.lesson.state === 'now'}
              />
            ) : (
              <Spacer modifiers={[frame({ width: M })]} />
            )}
            {row.lesson ? (
              <LessonCells row={row.lesson} size={15} width={LESSON} />
            ) : i === 0 && props.empty ? (
              <HStack spacing={0} modifiers={[padding({ leading: 10 }), frame({ width: LESSON, alignment: 'leading' })]}>
                <T size={15} color={c.muted}>{props.empty}</T>
              </HStack>
            ) : (
              <Spacer modifiers={[frame({ width: LESSON })]} />
            )}
            {/* The rest of the line, start-aligned. A frame, not a Spacer: a second
                flexible view would split the width with the task line's own Spacer. */}
            <HStack spacing={0} modifiers={[padding({ leading: 4, trailing: 14 }), frame({ maxWidth: 10000, alignment: 'leading' })]}>
              {row.side ? <Side line={row.side} /> : <Spacer minLength={0} />}
            </HStack>
          </Ruled>
        ))}
        <Spacer />
        <Footer updated={props.updated} stale={props.stale} inset={M + 10} />
      </VStack>
    </Page>
  );
};
