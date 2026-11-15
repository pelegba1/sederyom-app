/**
 * ״מבחנים״ on a friend's page (friends spec 2.4, sketch 2-details.html, card
 * 3): the two students' exams in the next two weeks, by date (`compareExams`).
 *
 * A lead line counts the exams sat together on one day (״מבחן אחד משותף,
 * מחר״). Each exam is a ruled row: its date over its weekday in the margin,
 * its title, a line saying whose it is (״לשניכם, באותו יום״, ״רק לנועה״,
 * ״רק לך״, or for the same subject on another day of the week, by the row's
 * `owner`: ״לשניכם, נועה ביום חמישי 12.11״ under mine, ״לשניכם, אצלך ביום
 * רביעי 11.11״ under theirs), and its tag at the end: ״ביחד״ and ״אותו
 * מקצוע״ in the exam's ink on its highlighter (`exam` on `examSoft`), ״לך״
 * and the friend's name outlined.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { DateStr } from '@sederyom/shared';
import type { ExamCompareRow } from '@sederyom/shared/logic/buddies-compare';
import { BUDDY_COPY } from '../buddies/copy';
import type { BuddyPage } from '../buddies/view';
import { countdownLabel, dayDateLabel, daysUntil, formatShortDate, isolateRanges } from '../lib/format';
import { marginWeekday } from '../lib/school';
import { font, space, type } from '../theme';
import { BuddyTabNote } from './BuddyDayTab';
import { MarginList, MarginRow, ROW_GUTTER } from './notebook';
import { Ltr, Text, usePalette } from './ui';

export function BuddyExamsTab({ page }: { page: BuddyPage }): React.JSX.Element {
  const p = usePalette();
  if (page.updatedAt === null) return <BuddyTabNote>{BUDDY_COPY.waitingFirst}</BuddyTabNote>;
  if (page.exams === null) return <BuddyTabNote>{BUDDY_COPY.notShared}</BuddyTabNote>;
  if (page.exams.length === 0) return <BuddyTabNote>{BUDDY_COPY.noExams}</BuddyTabNote>;
  const together = page.exams.filter((row) => row.who === 'together');
  const lead = BUDDY_COPY.examLead(together.length);
  const first = together[0];
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {lead && first ? (
        <Text style={[styles.lead, { color: p.text }]}>
          <Text style={styles.leadStrong}>{lead}</Text>
          {`, ${BUDDY_COPY.examWhen(together.length, countdownLabel(daysUntil(first.date)))}`}
        </Text>
      ) : null}
      <MarginList style={[styles.list, { borderTopColor: p.border }]}>
        {page.exams.map((row, i) => {
          const title = isolateRanges(row.title);
          const line = whoLine(row, page.name);
          const tag = tagOf(row, page.name);
          return (
            <MarginRow
              key={`${row.date}|${row.title}|${row.who}|${i}`}
              margin={<ExamDate date={row.date} />}
              title={title}
              subtitle={line}
              end={<ExamTag text={tag} both={row.who === 'together' || row.who === 'same_subject'} />}
              accessible
              accessibilityLabel={`${title}, ${dayDateLabel(row.date)}, ${line}, ${tag}`}
            />
          );
        })}
      </MarginList>
    </ScrollView>
  );
}

/** Whose exam a row is, in words. */
function whoLine(row: ExamCompareRow, name: string): string {
  switch (row.who) {
    case 'together': return BUDDY_COPY.examBoth;
    case 'theirs': return BUDDY_COPY.examOnlyTheirs(name);
    case 'mine': return BUDDY_COPY.examOnlyMine;
    // The same subject on another day: under my exam, the day of theirs; under theirs, mine.
    default:
      if (!row.otherDate) return BUDDY_COPY.examBoth;
      return row.owner === 'mine' ? BUDDY_COPY.examTheirDay(name, dayDateLabel(row.otherDate)) : BUDDY_COPY.examMyDay(dayDateLabel(row.otherDate));
  }
}

/** The tag at a row's end: ״ביחד״, ״אותו מקצוע״, ״לך״, or the friend's name. */
const tagOf = (row: ExamCompareRow, name: string): string => (row.who === 'theirs' ? name : BUDDY_COPY.examTag[row.who]);

function ExamTag({ text, both }: { text: string; both: boolean }): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={[styles.tag, both ? { backgroundColor: p.examSoft } : { borderColor: p.border, borderWidth: 1 }]}>
      <Text maxScale={1.15} numberOfLines={1} style={[styles.tagText, { color: both ? p.exam : p.textMuted }]}>{text}</Text>
    </View>
  );
}

/** An exam's date in the margin, the weekday under it, as on ״בית ספר״ and the friends screen. */
function ExamDate({ date }: { date: DateStr }): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={styles.dateMargin}>
      <Ltr style={[styles.marginDate, { color: p.textMuted }]}>{formatShortDate(date)}</Ltr>
      <Text style={[styles.marginDay, { color: p.textMuted }]}>{marginWeekday(date)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.xxl },
  lead: { fontFamily: font.body, fontSize: type.body, lineHeight: 24, paddingHorizontal: ROW_GUTTER, paddingTop: space.md, paddingBottom: space.md },
  leadStrong: { fontFamily: font.headingSemi },
  list: { borderTopWidth: 1 },
  dateMargin: { alignItems: 'center' },
  marginDate: { fontFamily: font.bodySemi, fontSize: type.small, fontVariant: ['tabular-nums'] },
  marginDay: { fontFamily: font.body, fontSize: type.caption },
  tag: { maxWidth: 120, borderRadius: 6, paddingHorizontal: space.sm, paddingVertical: 2 },
  tagText: { fontFamily: font.bodySemi, fontSize: type.caption },
});
