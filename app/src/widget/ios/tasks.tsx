/**
 * "משימות" on the iPhone (systemSmall): homework due and the open tasks on
 * the page, each on a ruled line. The margin says when — "איחור" in the red
 * pen, "היום", "מחר", a weekday — and the line starts with the task's box,
 * or "ש״ב" in blue for Mashov homework.
 *
 * The small widget is 148–170 pt wide, which leaves some 90 pt after the
 * margin: too little for the title and the count on one line. So the header
 * and the footer are written across the whole page, and the margin line runs
 * between them, beside the ruled lines.
 *
 * A `'widget'` function: see `kit.tsx` for what it may and may not touch.
 */
import { HStack, Rectangle, Spacer, VStack } from '@expo/ui/swift-ui';
import { foregroundStyle, frame, padding, strokeBorder } from '@expo/ui/swift-ui/modifiers';
import type { Kit } from './kit';
import type { EmptyProps, TasksProps } from './props';

export const tasksLayout = (props: TasksProps | EmptyProps, environment: unknown, K: Kit) => {
  'widget';
  const { c, tone, T, Page, Rule, Ruled, Footer } = K;
  const M = 50;
  /** Where the margin line starts and ends: under the header, above the footer. */
  const HEAD = 42;
  const FOOT = 26;

  if (props.kind !== 'tasks') {
    return (
      <Page margin={M} top={HEAD}>
        <VStack alignment="leading" spacing={4} modifiers={[padding({ leading: 12, trailing: 12, top: 12 })]}>
          <T size={19} w="title" color={c.strong}>{props.title ?? 'משימות'}</T>
          <T size={13} color={c.muted}>{props.line ?? ''}</T>
        </VStack>
      </Page>
    );
  }

  return (
    <Page margin={M} top={HEAD} bottom={FOOT}>
      <VStack alignment="leading" spacing={0} modifiers={[padding({ top: 6, bottom: 6 })]}>
        <HStack spacing={0} modifiers={[frame({ height: HEAD - 6 }), padding({ leading: 12, trailing: 12 })]}>
          <T size={18} w="title" color={c.strong}>משימות</T>
          <Spacer minLength={6} />
          <T size={14} w="b" color={tone(props.summaryTone)} fixed>{props.summary}</T>
        </HStack>
        <Rule />
        {props.empty ? (
          <Ruled min={26} max={30}>
            <Spacer modifiers={[frame({ width: M + 8 })]} />
            <T size={14} color={c.muted}>{props.empty}</T>
          </Ruled>
        ) : (
          props.rows.map((row, i) => (
            <Ruled key={`t-${i}`} min={26} max={30}>
              <HStack spacing={0} modifiers={[frame({ width: M, alignment: 'leading' })]}>
                <Spacer modifiers={[frame({ width: 10 })]} />
                <T size={13} w={row.whenBold ? 'b' : 'r'} color={tone(row.whenTone)} fixed>{row.when}</T>
              </HStack>
              <HStack spacing={row.homework ? 5 : 6} modifiers={[padding({ leading: 8, trailing: 12 })]}>
                {row.homework ? (
                  <T size={13} w="x" color={c.accent} fixed>ש״ב</T>
                ) : (
                  <Rectangle modifiers={[
                    foregroundStyle(c.bg),
                    frame({ width: 13, height: 13 }),
                    strokeBorder({ content: tone(row.box), style: { lineWidth: 1.5 }, shape: 'roundedRectangle', cornerRadius: 3 }),
                  ]} />
                )}
                <T size={15} color={c.text}>{row.text}</T>
                <Spacer minLength={0} />
              </HStack>
            </Ruled>
          ))
        )}
        <Spacer />
        <Footer left={props.more} updated={props.updated} stale={props.stale} inset={12} />
      </VStack>
    </Page>
  );
};
