/**
 * "השיעורים שלי". The school site publishes the whole class's grid; a student
 * attends a subset of it. Every published subject gets a checkbox here
 * ("show this", plan §16.1), and Mashov — which only ever lists the
 * student's own groups — can set them all at once. The checkboxes stay
 * authoritative: Mashov's match is a suggestion, and the server errs on "no
 * match" rather than hide a lesson that is really mine.
 *
 * Wave 5 (W5-7): the site publishes one subject under two names for the same
 * teacher ("אזרחות" and "אזרחות (יב2)"); they are one row, whose checkbox
 * moves every hide key in it — hiding one name hid half the lessons. Keys
 * that disagree (a list saved before this) draw the checkbox "mixed", and a
 * tap shows them all. Two teachers are two groups of the class, and each row
 * says so. What "יח״ל" and "מגמה" in a name mean is one sentence each,
 * behind the screen's one "?" (plan §16.2), and read with the row.
 *
 * Ruled rows on the page, edge to edge (plan §16.1), the checkbox at a row's
 * start as on every list; no card around them.
 */
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SUBJECT_NAME_MAX } from '@sederyom/shared/logic/ownNames';
import { useRenameSubject, useSaveSettings, useSettings } from '../api/hooks';
import { AppIcon } from '../components/AppIcon';
import { NameEditor, SUBJECT_NAME_NOTE } from '../components/NameEditor';
import { Checkbox, CHECKBOX_SIZE, LEAD_GAP, Row, ROW_END, ROW_GUTTER } from '../components/notebook';
import { useToast } from '../components/Toast';
import { Button, EmptyState, ErrorState, Loading, Screen, Text, touchSlop, usePalette } from '../components/ui';
import { isolateRanges, plural } from '../lib/format';
import {
  groupLessonOptions, isMashovOnly, lessonGroupState, LESSONS_COPY, lessonsShownLabel, MAJOR_EXPLAINER, mashovOnlyHidden, setKeysShown,
  termExplainer, UNITS_EXPLAINER, type LessonGroup,
} from '../lib/school';
import { groupNameTarget, groupOwnName, nameOfDraft } from '../local/subjectNames';
import { font, space, type } from '../theme';

export function MyLessonsScreen(): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const settings = useSettings();
  const save = useSaveSettings();
  const [about, setAbout] = useState(false);
  // "לשנות שם": one row at a time has its field open (by `LessonGroup.id`).
  const [naming, setNaming] = useState<string | null>(null);
  const rename = useRenameSubject();
  const names = settings.data?.settings.lessons.subjectNames;

  const hiddenKeys = useMemo(() => settings.data?.settings.lessons.hiddenSubjects ?? [], [settings.data]);
  const hidden = useMemo(() => new Set(hiddenKeys), [hiddenKeys]);
  const groups = useMemo(() => groupLessonOptions(settings.data?.subjects ?? []), [settings.data]);
  // On a parent's phone the screen is the lessons shown, which are the child's (`LESSONS_COPY`).
  const copy = LESSONS_COPY[settings.data?.settings.audience === 'parent' ? 'parent' : 'student'];
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({ title: copy.title });
  }, [navigation, copy.title]);

  if (settings.isLoading) return <Screen><Loading /></Screen>;
  if (settings.isError || !settings.data) {
    return (
      <Screen>
        <ErrorState message={(settings.error as Error | undefined)?.message ?? 'שגיאה'} onRetry={() => void settings.refetch()} />
      </Screen>
    );
  }

  const { mashovKnown } = settings.data;
  // The words in the list's names that need a sentence ("יח״ל", "מגמה"): behind the screen's one "?" (plan §16.2).
  const terms = [...new Set(groups.map((g) => termExplainer(g.names.join(' '))).filter((t): t is string => t !== null))];
  const shownCount = groups.filter((g) => lessonGroupState(g, hidden) !== false).length;
  const allInMashov = groups.every((g) => g.inMashov);
  const mashovOnly = mashovKnown && isMashovOnly(groups, hidden);

  const setHidden = (next: string[]): void => save.mutate({ lessons: { hiddenSubjects: next } });
  const toggle = (group: LessonGroup, show: boolean): void => setHidden(setKeysShown(hiddenKeys, group.keys, show));

  /** A name for the whole row (every line in it). Empty, or the site's own, gives the site's name back. */
  const giveName = (group: LessonGroup, draft: string): void => {
    setNaming(null);
    const target = groupNameTarget(group);
    const name = nameOfDraft(draft, target.originals);
    // The same name again changes nothing.
    if (name === groupOwnName(group, names)) return;
    // No name clears every key that could still name the row's lessons, so the site's name really comes back.
    rename(name === null ? target.clear : target.keys, name, target.originals);
  };

  /** A whole-list change says what it did, and can be taken back. */
  const replaceAll = (next: string[], confirm: string): void => {
    const before = hiddenKeys;
    save.mutate({ lessons: { hiddenSubjects: next } }, {
      onSuccess: () => toast.show(confirm, {
        onAction: () => save.mutate(
          { lessons: { hiddenSubjects: before } },
          { onError: () => toast.show('לא הצלחנו להחזיר. אפשר לנסות שוב') },
        ),
      }),
    });
  };

  const keepMashov = (): void => {
    const off = groups.filter((g) => !g.inMashov).length;
    replaceAll(
      mashovOnlyHidden(groups),
      off === 0 ? 'כל השיעורים מוצגים' : plural(off, 'מקצוע אחד שלא מופיע במשוב הוסתר', 'מקצועות שלא מופיעים במשוב הוסתרו'),
    );
  };

  // Say what stays, not what goes: Maya read "להסתיר מה שלא במשוב" as hiding things *in* Mashov.
  const mashovTitle = mashovOnly
    ? allInMashov ? 'כל השיעורים מופיעים במשוב' : 'מוצג רק מה שבמשוב'
    : 'להשאיר רק מה שבמשוב';

  return (
    <Screen>
      {/* A tap on "לשמור" under the open keyboard is one tap, not two. */}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.gutter}>
          {/* What a mark does, not what the screen is (plan §16.2); a word in the names, behind its one "?". */}
          <View style={styles.intro}>
            <Text style={{ flex: 1, fontFamily: font.body, fontSize: type.small, color: p.textMuted, lineHeight: 21 }}>
              כל שיעורי הכיתה. מה שלא מסומן לא יופיע ביום, בשבוע, במסך הבית של הטלפון ובהתראות.
            </Text>
            {terms.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: about }}
                accessibilityLabel={terms.map(termQuestion).join(' ')}
                hitSlop={touchSlop(18)}
                onPress={() => setAbout((v) => !v)}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <AppIcon name="help" color={about ? p.accent : p.textMuted} size={18} />
              </Pressable>
            ) : null}
          </View>
          {about ? terms.map((term) => (
            <Text
              key={term}
              accessibilityLiveRegion="polite"
              style={{ fontFamily: font.body, fontSize: type.small, color: p.text, marginTop: space.sm, lineHeight: 20 }}
            >
              {term}
            </Text>
          )) : null}

          <View style={styles.actions}>
            <Button title={mashovTitle} variant="ghost" disabled={!mashovKnown || save.isPending || mashovOnly} onPress={keepMashov} />
            <Button
              title="להציג הכול"
              variant="ghost"
              disabled={hidden.size === 0 || save.isPending}
              onPress={() => replaceAll([], 'כל השיעורים מוצגים')}
            />
          </View>
          <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted, lineHeight: 20 }}>
            {mashovKnown ? copy.mashovKnown : copy.mashovUnknown}
          </Text>

          {/* Lead with what is there: "5 מוסתרים" read as if something had gone missing. */}
          <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text, marginTop: space.xl, marginBottom: space.sm }}>
            {`${lessonsShownLabel(shownCount)} מתוך ${groups.length} בכיתה`}
          </Text>
        </View>

        {groups.length === 0 ? (
          <EmptyState text="עדיין אין מערכת מהאתר. השיעורים יופיעו כאן ברגע שהיא תיטען." />
        ) : (
          <View style={[styles.list, { borderTopColor: p.border }]}>
            {groups.map((group) => (
              <LessonRow
                key={group.id}
                group={group}
                state={lessonGroupState(group, hidden)}
                mashovKnown={mashovKnown}
                parallelLine={copy.parallel}
                busy={save.isPending}
                onToggle={(show) => toggle(group, show)}
                ownName={groupOwnName(group, names)}
                naming={naming === group.id}
                onStartNaming={() => setNaming(group.id)}
                onStopNaming={() => setNaming(null)}
                onName={(draft) => giveName(group, draft)}
              />
            ))}
          </View>
        )}

        {save.isError ? (
          <Text accessibilityRole="alert" style={[styles.gutter, { fontFamily: font.body, fontSize: type.small, color: p.cancel, marginTop: space.lg }]}>
            {`לא הצלחנו לשמור: ${(save.error as Error).message}`}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/**
 * One subject and teacher, as a ruled row of the page with a checkbox at its
 * start (its `lead`, where every list draws it): checked, the lesson is shown
 * (plan §16.1: a checkbox for "show this", a switch only for a setting). Some
 * of its names hidden draws it mixed. What "יח״ל" or "מגמה" in its name means
 * is behind the screen's one "?", and read with the row.
 *
 * "לשנות שם" (a name of the student's own for the subject) is a text button
 * under the row, not in it: the row is one checkbox for a screen reader, and
 * a button inside would be out of its reach. The rule under the row moves to
 * the wrapper so the button and its field sit inside the row's ruled space.
 * With a name the title is the name and the site's, muted, is under it.
 */
function LessonRow({
  group, state, mashovKnown, parallelLine, busy, onToggle, ownName, naming, onStartNaming, onStopNaming, onName,
}: {
  group: LessonGroup;
  state: boolean | 'mixed';
  mashovKnown: boolean;
  /** "יש 2 קבוצות במקצוע הזה…", in the student's words or the parent's. */
  parallelLine: (groups: number) => string;
  busy: boolean;
  onToggle: (show: boolean) => void;
  /** The name the student gave the row, else `null`. */
  ownName: string | null;
  /** The row's name field is open. */
  naming: boolean;
  onStartNaming: () => void;
  onStopNaming: () => void;
  /** "לשמור" with the draft as typed. */
  onName: (draft: string) => void;
}): React.JSX.Element {
  const p = usePalette();
  const on = state !== false;
  const shown = ownName ?? group.name;
  const explainer = termExplainer(group.names.join(' '));
  const mashovTag = mashovKnown ? (group.inMashov ? 'מופיע במשוב' : 'לא מופיע במשוב') : null;
  // Two teachers under one subject: the class's two groups, and only one is the student's (Maya).
  const parallel = group.parallel > 0 ? parallelLine(group.parallel + 1) : null;
  const mixed = state === 'mixed' ? 'חלק מהשיעורים מוסתרים' : null;
  // Who and how many, with a comma (plan §16.2); "mixed" gets a line of its own.
  const meta = [group.teacher, plural(group.count, 'שיעור אחד', 'שיעורים')].filter(Boolean).join(', ');

  const original = ownName !== null ? `שם מקורי: ${group.name}` : null;

  return (
    <View style={[styles.item, { borderBottomColor: p.border }]}>
      {/* The whole row is the checkbox's target, not just the box; a mixed row shows everything on a tap. */}
      <Row
        // The wrapper draws the rule, so that the name's button and field sit above it.
        style={styles.bareRow}
        // Drawn only: the row is the checkbox and takes every tap, so one tap is one save.
        lead={<Checkbox value={state} disabled={busy} />}
        title={isolateRanges(shown)}
        titleStyle={{ color: on ? p.text : p.textMuted }}
        subtitle={(
          <>
            {/* The site's name, under the name the student gave: the muted style of the row's other lines. */}
            {original ? (
              <Text style={{ width: '100%', fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>{isolateRanges(original)}</Text>
            ) : null}
            <Text style={{ flexShrink: 1, fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>{meta}</Text>
            {/* In Mashov: green words with a drawn tick, not a pill (plan §16.1). */}
            {mashovTag ? (
              <View style={styles.tag}>
                {group.inMashov ? <AppIcon name="check" color={p.ok} size={15} /> : null}
                <Text style={{ fontFamily: font.bodyMedium, fontSize: type.small, color: group.inMashov ? p.ok : p.textMuted }}>{mashovTag}</Text>
              </View>
            ) : null}
          </>
        )}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: state, disabled: busy }}
        // The sentence behind the screen's "?" for a word in this name, read here with the row.
        accessibilityLabel={[shown, original, group.teacher, mashovTag, mixed, parallel, explainer].filter(Boolean).join(', ')}
        disabled={busy}
        onPress={() => onToggle(state !== true)}
      >
        {mixed ? <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.change, lineHeight: 20 }}>{mixed}</Text> : null}
        {parallel ? (
          <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted, lineHeight: 20 }}>{parallel}</Text>
        ) : null}
      </Row>
      <View style={[styles.name, naming ? styles.nameField : null]}>
        {naming ? (
          <NameEditor
            label={`שם המקצוע ${group.name}`}
            initial={ownName ?? ''}
            original={group.name}
            note={SUBJECT_NAME_NOTE}
            maxLength={SUBJECT_NAME_MAX}
            onSave={onName}
            onCancel={onStopNaming}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`לשנות שם: ${shown}`}
            // Not upward: the row's bottom edge is the checkbox's.
            hitSlop={{ bottom: 4, left: 12, right: 12 }}
            onPress={onStartNaming}
            style={({ pressed }) => [styles.nameButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.accent }}>לשנות שם</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** The question a word's sentence answers, for the "?"'s spoken name. */
function termQuestion(explainer: string): string {
  if (explainer === UNITS_EXPLAINER) return 'מה זה יח״ל?';
  if (explainer === MAJOR_EXPLAINER) return 'מה זו מגמה?';
  return 'מה זה אומר?';
}

const styles = StyleSheet.create({
  content: { paddingTop: space.lg, paddingBottom: 80 },
  /** The page's gutter, where the rows' text starts. */
  gutter: { paddingHorizontal: ROW_GUTTER },
  intro: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' },
  list: { borderTopWidth: 1 },
  /** A subject's row and, under it, its name: the rule is theirs together. */
  item: { borderBottomWidth: 1 },
  bareRow: { borderBottomWidth: 0 },
  /** Under the row's text (past the checkbox), not under the checkbox. */
  name: { paddingStart: ROW_GUTTER + CHECKBOX_SIZE + LEAD_GAP, paddingEnd: ROW_END, paddingBottom: space.xs },
  nameField: { paddingBottom: space.md },
  nameButton: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
