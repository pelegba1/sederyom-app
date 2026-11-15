/**
 * ״חיסורים״ on a friend's page (friends spec 2.4, sketch 2-details.html, card
 * 2): for each subject, the absences that count out of those allowed (״2/6״)
 * and a bar, first the subjects the two learn together, mine beside theirs,
 * then the rest of theirs. A bar is the blue pen (`accentFill`), orange
 * (`homeworkMark`) once two or fewer are left (`level` is not `'ok'`).
 *
 * Under them, what the numbers mean, and when their phone last read Mashov
 * (״עודכן אצל נועה לפני 20 דקות״). Only the two of them: no friend is set
 * against another, and nothing is sorted by who missed more.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { BuddyAbsence } from '@sederyom/shared';
import { BUDDY_COPY } from '../buddies/copy';
import type { BuddyPage } from '../buddies/view';
import { relativeTime } from '../lib/format';
import { font, space, type } from '../theme';
import { BuddyTabNote } from './BuddyDayTab';
import { MARGIN_LINE, ROW_GUTTER } from './notebook';
import { Ltr, Text, usePalette } from './ui';

export function BuddyAbsencesTab({ page, now }: { page: BuddyPage; now: Date }): React.JSX.Element {
  const p = usePalette();
  if (page.updatedAt === null) return <BuddyTabNote>{BUDDY_COPY.waitingFirst}</BuddyTabNote>;
  // Shared, but their phone has not read Mashov's attendance yet: none in the box so far.
  if (page.absences === null) return <BuddyTabNote>{page.theirShares.absences ? BUDDY_COPY.waitingFirst : BUDDY_COPY.notShared}</BuddyTabNote>;
  const { shared, others } = page.absences;
  const ago = relativeTime(page.updatedAt, now);
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {shared.length > 0 ? (
        <>
          <Text accessibilityRole="header" style={[styles.label, { color: p.textMuted }]}>{BUDDY_COPY.absencesShared}</Text>
          {shared.map((s) => (
            <SubjectRow
              key={`shared|${s.subject}`}
              subject={s.subject}
              bars={[...(s.mine ? [{ who: BUDDY_COPY.yours, absence: s.mine }] : []), { who: page.name, absence: s.theirs }]}
            />
          ))}
        </>
      ) : null}
      {others.length > 0 ? (
        <>
          {/* ״The rest of theirs״ only after the subjects learnt together; alone, the rows need no heading. */}
          {shared.length > 0 ? (
            <Text accessibilityRole="header" style={[styles.label, { color: p.textMuted }]}>{BUDDY_COPY.absencesOthers(page.name)}</Text>
          ) : null}
          {others.map((a) => <SubjectRow key={`other|${a.subject}`} subject={a.subject} bars={[{ who: page.name, absence: a }]} />)}
        </>
      ) : null}
      {shared.length + others.length === 0 ? <BuddyTabNote>{BUDDY_COPY.noAbsences}</BuddyTabNote> : null}
      <Text style={[styles.note, { color: p.textMuted }]}>
        {ago ? `${BUDDY_COPY.absencesNote} ${BUDDY_COPY.updated(page.name, ago)}` : BUDDY_COPY.absencesNote}
      </Text>
    </ScrollView>
  );
}

interface Bar {
  who: string;
  absence: BuddyAbsence;
}

/** What a bar says aloud: whose, the two numbers, and what orange means. */
function barSaid({ who, absence }: Bar): string {
  const said = BUDDY_COPY.absenceSaid(who, absence.counted, absence.allowed);
  return absence.level === 'ok' ? said : `${said}, ${BUDDY_COPY.absenceLevel[absence.level]}`;
}

/** A subject at the start, its red margin line after it, and a bar for each of the two (or for theirs alone). */
function SubjectRow({ subject, bars }: { subject: string; bars: Bar[] }): React.JSX.Element {
  const p = usePalette();
  return (
    <View
      style={[styles.row, { borderTopColor: p.border }]}
      accessible
      accessibilityLabel={`${subject}, ${bars.map(barSaid).join(', ')}`}
    >
      <View style={[styles.subject, { borderEndColor: p.margin }]}>
        <Text numberOfLines={2} style={[styles.subjectText, { color: p.text }]}>{subject}</Text>
      </View>
      <View style={styles.bars}>
        {bars.map((bar, i) => <BarLine key={i} bar={bar} />)}
      </View>
    </View>
  );
}

function BarLine({ bar }: { bar: Bar }): React.JSX.Element {
  const p = usePalette();
  const { counted, allowed, level } = bar.absence;
  // Of what is allowed; nothing allowed and one missed is a full bar.
  const share = allowed > 0 ? Math.min(1, Math.max(0, counted / allowed)) : counted > 0 ? 1 : 0;
  return (
    <View style={styles.bar}>
      <Text maxScale={1.15} numberOfLines={1} style={[styles.who, { color: p.textMuted }]}>{bar.who}</Text>
      <View style={[styles.track, { backgroundColor: p.borderSoft }]}>
        <View style={[styles.fillBar, { width: `${share * 100}%`, backgroundColor: level === 'ok' ? p.accentFill : p.homeworkMark }]} />
      </View>
      <Text maxScale={1.15} style={[styles.value, { color: p.text }]}>
        <Ltr>{`${counted}/${allowed}`}</Ltr>
      </Text>
    </View>
  );
}

/** The subject's column, as wide as the sketch's (a little more, for ״היסטוריה״ at a larger size). */
const SUBJECT_WIDTH = 96;

const styles = StyleSheet.create({
  content: { paddingBottom: space.xxl },
  label: { fontFamily: font.bodySemi, fontSize: type.caption, paddingHorizontal: ROW_GUTTER, paddingTop: space.lg, paddingBottom: space.xs },
  row: { flexDirection: 'row', alignItems: 'stretch', borderTopWidth: 1, paddingVertical: space.sm },
  subject: { width: SUBJECT_WIDTH, justifyContent: 'center', paddingStart: ROW_GUTTER - space.xs, paddingEnd: space.sm, borderEndWidth: MARGIN_LINE },
  subjectText: { fontFamily: font.bodySemi, fontSize: type.small },
  bars: { flex: 1, justifyContent: 'center', gap: space.xs, paddingStart: space.md, paddingEnd: ROW_GUTTER },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 22 },
  who: { width: 52, fontFamily: font.body, fontSize: type.caption },
  track: { flex: 1, flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden' },
  fillBar: { height: '100%', borderRadius: 4 },
  value: { minWidth: 40, fontFamily: font.headingSemi, fontSize: type.caption, fontVariant: ['tabular-nums'] },
  note: { fontFamily: font.body, fontSize: type.caption, lineHeight: 20, paddingHorizontal: ROW_GUTTER, paddingTop: space.lg },
});
