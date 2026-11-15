/**
 * The day's changes (F4, B8): what the "4 שינויים היום" row opens. Each
 * changed lesson is one ruled row (plan §16.1); tapping it shows the lesson's
 * details in the same sheet (no second modal on top), with a way back to the
 * list.
 *
 *   <ChangesSheet visible={open} lessons={changedLessons(view.timeline)} classId={classId} onClose={close} />
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Lesson } from '@sederyom/shared';
import { useSettings } from '../api/hooks';
import { isolateRanges, shownSubject, todayStr } from '../lib/format';
import { changesLabel, lessonSiteUrl, lessonTimeParts, statusExplanation } from '../lib/today';
import { font, space, statusStyle, type } from '../theme';
import { AppIcon } from './AppIcon';
import { changesShareText } from '../lib/share';
import { LessonDetails, SiteButton } from './LessonSheet';
import { ShareToGroup } from './ShareToGroup';
import { Mark, Row } from './notebook';
import { PartsText } from './timeline';
import { Sheet } from './Sheet';
import { EmptyState, MIN_TOUCH, Text, usePalette } from './ui';

export interface ChangesSheetProps {
  visible: boolean;
  /** The day's lessons whose status is not `regular`. */
  lessons: Lesson[];
  onClose: () => void;
  classId?: string | null;
  projected?: boolean;
}

export function ChangesSheet({ visible, lessons: current, onClose, classId = null, projected: currentProjected = false }: ChangesSheetProps): React.JSX.Element {
  const p = usePalette();
  const [selected, setSelected] = useState<Lesson | null>(null);
  // While the sheet slides away the screen may already show another day — "X" and then "מחר" at
  // once. It keeps what it showed open, rather than flash "0 שינויים" (W4, Noa).
  const [kept, setKept] = useState({ lessons: current, projected: currentProjected });
  if (visible && (kept.lessons !== current || kept.projected !== currentProjected)) {
    setKept({ lessons: current, projected: currentProjected });
  }
  const lessons = visible ? current : kept.lessons;
  const projected = visible ? currentProjected : kept.projected;

  // Every opening starts on the list.
  useEffect(() => {
    if (visible) setSelected(null);
  }, [visible]);

  const today = todayStr();
  // The day the changes are on, named in the title: "4 שינויים היום", "2 שינויים ביום ראשון".
  const day = lessons[0]?.date ?? today;
  // The site's changes list serves the whole day as well as any one lesson on it.
  const siteLesson = selected ?? lessons.find((l) => l.source === 'shahaf') ?? null;
  const siteUrl = useSettings().data?.schoolSiteUrl ?? null;
  const url = siteLesson && !projected ? lessonSiteUrl(siteLesson, siteUrl, classId, today) : null;
  // The list, to the class's group (ideas ה1); a single lesson's details keep the site's button alone.
  const share = !selected && lessons.length > 0
    ? <ShareToGroup text={(ctx) => changesShareText(lessons, day, ctx)} />
    : null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={selected ? shownSubject(selected) : changesLabel(lessons.length, day, today)}
      footer={share || url ? (
        <View style={styles.footer}>
          {share}
          {url ? <SiteButton url={url} /> : null}
        </View>
      ) : undefined}
    >
      {selected ? (
        <View style={{ gap: space.md }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="חזרה לכל השינויים ביום הזה"
            onPress={() => setSelected(null)}
            style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}
          >
            <AppIcon name="chevronRight" color={p.accent} size={18} />
            <Text style={[styles.backText, { color: p.accent }]}>כל השינויים</Text>
          </Pressable>
          <LessonDetails lesson={selected} projected={projected} />
        </View>
      ) : lessons.length === 0 ? (
        <EmptyState text="אין שינויים" />
      ) : (
        <View>
          {lessons.map((lesson, i) => (
            <ChangeRow key={`${lesson.hourIndex}-${lesson.subject}-${i}`} lesson={lesson} onPress={() => setSelected(lesson)} />
          ))}
        </View>
      )}
    </Sheet>
  );
}

/**
 * One changed lesson as a row: the subject, its word at the end ("בוטל" in
 * the red pen, a change on the highlighter), the period and time under it,
 * and the site's note when there is one. Without a note the word says it:
 * "השיעור בוטל ולא יתקיים." under every "בוטל" read four times in a row
 * (Itai, run 4) — the full sentence stays in the lesson's details.
 */
function ChangeRow({ lesson, onPress }: { lesson: Lesson; onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  const s = statusStyle(lesson.status, p);
  const subject = shownSubject(lesson);
  const what = lesson.note ? isolateRanges(lesson.note) : null;
  const cancelled = lesson.status === 'cancelled';
  return (
    <Row
      accessibilityRole="button"
      accessibilityLabel={`${subject}, שיעור ${lesson.hourIndex}, ${s.label || statusExplanation(lesson.status)}${what ? `. ${what}` : ''}`}
      accessibilityHint="פותח את פרטי השינוי"
      onPress={onPress}
      title={subject}
      titleLines={1}
      tone={cancelled ? 'cancelled' : 'normal'}
      end={s.label ? (
        cancelled
          ? <Text style={[styles.word, { color: p.cancel }]}>{s.label}</Text>
          : <Mark kind={lesson.status === 'exam' ? 'exam' : 'change'} color={s.color}>{s.label}</Mark>
      ) : undefined}
      chevron
      // The sheet brings its own side padding.
      style={styles.row}
    >
      <PartsText parts={lessonTimeParts(lesson)} style={[styles.meta, { color: p.textMuted }]} />
      {what ? <Text numberOfLines={2} style={[styles.meta, { color: p.text }]}>{what}</Text> : null}
    </Row>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm },
  back: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: MIN_TOUCH, alignSelf: 'flex-start' },
  backText: { fontFamily: font.bodySemi, fontSize: type.label },
  row: { paddingStart: 0, paddingEnd: 0 },
  word: { fontFamily: font.bodySemi, fontSize: type.small },
  meta: { fontFamily: font.body, fontSize: type.small },
});
