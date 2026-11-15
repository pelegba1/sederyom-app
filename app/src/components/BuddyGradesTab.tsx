/**
 * ״ציונים״ on a friend's page (docs/superpowers/specs/2026-10-30-buddies-grades-design.md,
 * 2.2 to 2.4), shown only while both of us turned grades on (`page.grades`).
 *
 * Until then the tab says what has to happen for there to be any, with a
 * button that turns mine on when nobody's is or only theirs is. Once both are
 * on and their box is here, a ruled row for each subject, as the School
 * screen's grade rows: first the subjects both of us have grades in, then,
 * under ״שאר המקצועות של נועה״, the rest of theirs. Over the two numbers,
 * ״ממוצע״ (״ציון״ for one grade each), and over each number whose it is,
 * ״שלך״ or their name. A tap opens the subject in place: every grade of both,
 * newest first, one of the same assessment on one line, and ״רק לך״ or
 * ״רק לנועה״ by a grade only one of us has. Under the subjects, the bagrut
 * part, when it is shared or asked for (only once their box is here); then
 * what the averages are by, where their box starts, and when their phone last
 * read Mashov.
 *
 * Nothing marks who is higher (1.3): the two numbers have one face, one size
 * and one colour, never ״מצוין״ or a difference, and the order is the model's
 * (by date, never by grade). Opening the tab answers its dot (2.4).
 */
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { BuddyBagrutRow, BuddyGrade } from '@sederyom/shared';
import { useMarkBuddyGradesSeen, useTurnOnBuddyGrades } from '../api/hooks';
import { BUDDY_COPY } from '../buddies/copy';
import type { BagrutRow, GradeRow, GradeSubjectCompare } from '../buddies/grades';
import type { BuddyPage } from '../buddies/view';
import { DEMO_COPY } from '../demo/mode';
import { isDemo } from '../demo/phone';
import { formatShortDate, isolateRanges, relativeTime } from '../lib/format';
import { averageLabel, formatAverage } from '../lib/school';
import { font, space, type } from '../theme';
import { AppIcon } from './AppIcon';
import { BuddyTabNote } from './BuddyDayTab';
import { Row, ROW_GUTTER } from './notebook';
import { useToast } from './Toast';
import { Button, Ltr, Text, usePalette } from './ui';

/** A left-to-right isolate (LRI, U+2066) and its end (PDI, U+2069): a date like ״1.9״ keeps its order in a Hebrew line. Made from their codes, so they show in review. */
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);

export function BuddyGradesTab({ page, now }: { page: BuddyPage; now: Date }): React.JSX.Element {
  const p = usePalette();
  useSeen(page);
  // Which subjects and questionnaires are open, by `rowKey`.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((was) => ({ ...was, [key]: !was[key] }));
  const { state, compare, from } = page.grades;

  if (state === 'neither') return <StateLine page={page} line={BUDDY_COPY.gradesNeither} button={BUDDY_COPY.turnOnMine} which="grades" />;
  if (state === 'mine') return <StateLine page={page} line={BUDDY_COPY.gradesMine(page.name)} />;
  if (state === 'theirs') return <StateLine page={page} line={BUDDY_COPY.gradesTheirs(page.name)} button={BUDDY_COPY.turnOnToo} which="grades" />;
  if (state === 'waiting') return <BuddyTabNote>{BUDDY_COPY.waitingFirst}</BuddyTabNote>;

  const shared = state === 'list' ? compare?.shared ?? [] : [];
  const others = state === 'list' ? compare?.others ?? [] : [];
  const ago = page.updatedAt ? relativeTime(page.updatedAt, now) : '';
  // The time last: ״עודכן אצל נועה לפני 20 דקות״ is not a sentence of its own.
  const note = [
    state === 'list' ? BUDDY_COPY.gradesWeights(page.name) : null,
    from ? BUDDY_COPY.gradesFrom(page.name, `${LRI}${formatShortDate(from)}${PDI}`) : null,
    ago ? BUDDY_COPY.updated(page.name, ago) : null,
  ].filter((line): line is string => line !== null).join(' ');
  const subjects = (list: GradeSubjectCompare[], theirsOnly: boolean) => list.map((s) => {
    const key = rowKey(theirsOnly, s.subject);
    return <SubjectLines key={key} subject={s} page={page} theirsOnly={theirsOnly} open={open[key] === true} onToggle={() => toggle(key)} />;
  });

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {state === 'empty' ? <BuddyTabNote>{BUDDY_COPY.gradesEmpty(page.name)}</BuddyTabNote> : null}
      {shared.length > 0 ? <View style={[styles.list, styles.firstList, { borderTopColor: p.border }]}>{subjects(shared, false)}</View> : null}
      {others.length > 0 ? (
        <>
          {/* ״The rest of theirs״ only after the subjects both have; alone, the rows need no heading (as on ״חיסורים״). */}
          {shared.length > 0 ? (
            <Text accessibilityRole="header" style={[styles.label, { color: p.textMuted }]}>{BUDDY_COPY.gradesOthers(page.name)}</Text>
          ) : null}
          <View style={[styles.list, shared.length > 0 ? null : styles.firstList, { borderTopColor: p.border }]}>{subjects(others, true)}</View>
        </>
      ) : null}
      <BagrutPart page={page} open={open} onToggle={toggle} />
      {note ? <Text style={[styles.note, { color: p.textMuted }]}>{note}</Text> : null}
    </ScrollView>
  );
}

/** A subject's or a questionnaire's key in the open ones: whether it is one of theirs alone, and its name or code. */
const rowKey = (theirsOnly: boolean, name: string | number): string => `${theirsOnly ? 'theirs' : 'both'}|${name}`;

/**
 * The tab was opened: its dot goes (2.4). So does a dot that comes while it
 * is open (a refresh brought their choice); not again once it is gone.
 */
function useSeen(page: BuddyPage): void {
  const markSeen = useMarkBuddyGradesSeen();
  const opened = useRef(false);
  const { id } = page;
  const { dot } = page.grades;
  useEffect(() => {
    if (opened.current && !dot) return;
    opened.current = true;
    markSeen(id);
  }, [markSeen, id, dot]);
}

/**
 * What has to happen for grades (or the bagrut) to be here, and under it the
 * button that turns mine on (2.2), when there is one: one tap, no bagrut
 * with the grades. A text button, as an empty list offers its way forward: the
 * ask to share stays small (2.4).
 */
function StateLine({ page, line, button, which }: {
  page: BuddyPage;
  line: string;
  button?: string;
  which?: 'grades' | 'bagrut';
}): React.JSX.Element {
  const toast = useToast();
  const turnOn = useTurnOnBuddyGrades();
  const press = (): void => {
    if (!which) return;
    if (isDemo()) {
      toast.show(DEMO_COPY.notSaved);
      return;
    }
    // Never the error's own words: one line for any failure. What was turned on stays on.
    turnOn.mutate({ id: page.id, which }, { onError: () => toast.show(BUDDY_COPY.failed) });
  };
  return (
    <View>
      <BuddyTabNote>{line}</BuddyTabNote>
      {button && which ? (
        <View style={styles.action}>
          <Button title={button} variant="ghost" disabled={turnOn.isPending} onPress={press} />
        </View>
      ) : null}
    </View>
  );
}

/** One side's column at a row's end, as wide as the other's: whose it is over the number, when the row says so. */
function Cell({ who, children }: { who?: string; children?: React.ReactNode }): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={styles.cell}>
      {who !== undefined ? <Text maxScale={1.15} numberOfLines={1} style={[styles.who, { color: p.textMuted }]}>{who}</Text> : null}
      {children}
    </View>
  );
}

/** A number in a cell: a subject's average or a questionnaire's final grade (`big`), or one grade. The same for both sides (1.3). */
function Score({ text, big = false }: { text: string; big?: boolean }): React.JSX.Element {
  const p = usePalette();
  return (
    <Text maxScale={1.15} style={[big ? styles.big : styles.score, { color: p.text }]}>
      <Ltr>{text}</Ltr>
    </Text>
  );
}

/** Words in a cell's number's place: ״אין ממוצע״, or a grade in words (״עבר״). */
function Words({ children }: { children: string }): React.JSX.Element {
  const p = usePalette();
  return <Text maxScale={1.15} numberOfLines={2} style={[styles.words, { color: p.textMuted }]}>{children}</Text>;
}

/** The chevron that opens a row, or its room on a row that does not open, so every row's cells line up. */
function Chevron({ open, shown = true }: { open: boolean; shown?: boolean }): React.JSX.Element {
  const p = usePalette();
  if (!shown) return <View style={styles.chevronRoom} />;
  return (
    <View style={open ? styles.flip : null}>
      <AppIcon name="chevronDown" color={p.textMuted} size={CHEVRON} />
    </View>
  );
}

/** A subject's average in words, for its cell and for the screen reader. */
const averageText = (average: number | null): string => (average === null ? BUDDY_COPY.noAverage : formatAverage(average));

/** A grade as its cell says it: the number, else its words. */
const gradeText = (grade: BuddyGrade): string => (grade.value !== undefined ? String(grade.value) : grade.text ?? '');

/**
 * A subject's row and, open, its grades under it. `theirsOnly`: a subject
 * only they have grades in, with their column alone.
 */
function SubjectLines({ subject: s, page, theirsOnly, open, onToggle }: {
  subject: GradeSubjectCompare;
  page: BuddyPage;
  theirsOnly: boolean;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const p = usePalette();
  // One word over both numbers: ״ציון״ only when each is one grade. Their box cut (`from`): their count is not what their average is over, so ״ממוצע״.
  const count = theirsOnly ? s.theirsCount : Math.max(s.mineCount, s.theirsCount);
  const label = averageLabel(page.grades.from !== null ? Math.max(count, 2) : count);
  const average = (value: number | null) => (value === null ? <Words>{BUDDY_COPY.noAverage}</Words> : <Score text={formatAverage(value)} big />);
  // A subject whose grades their box cut away still has its average, and nothing to open.
  const opens = s.rows.length > 0;
  // Grades an average leaves out (at 0%): said when the subject is open, over its grades, or 98.3 beside a 70 reads as a mistake.
  const mineUncounted = theirsOnly ? 0 : s.mineUncounted;
  const uncounted = mineUncounted > 0 || s.theirsUncounted > 0 ? BUDDY_COPY.gradesUncounted(mineUncounted, s.theirsUncounted, page.name) : null;
  return (
    <>
      <Row
        title={s.subject}
        titleLines={2}
        end={(
          <View style={styles.end}>
            <View style={styles.numbers}>
              <Text maxScale={1.15} style={[styles.numbersLabel, { color: p.textMuted }]}>{label}</Text>
              <View style={styles.cells}>
                {theirsOnly ? null : <Cell who={BUDDY_COPY.yours}>{average(s.mine)}</Cell>}
                <Cell who={page.name}>{average(s.theirs)}</Cell>
              </View>
            </View>
            <Chevron open={open} shown={opens} />
          </View>
        )}
        onPress={opens ? onToggle : undefined}
        accessible
        accessibilityState={opens ? { expanded: open } : undefined}
        accessibilityLabel={[
          s.subject, label, theirsOnly ? null : `${BUDDY_COPY.yours} ${averageText(s.mine)}`, `${page.name} ${averageText(s.theirs)}`,
        ].filter((part): part is string => part !== null).join(', ')}
      />
      {open && opens && uncounted ? <Text style={[styles.uncounted, { color: p.textMuted }]}>{uncounted}</Text> : null}
      {open && opens ? s.rows.map((row, i) => <GradeLine key={`${row.date}|${row.name ?? ''}|${i}`} row={row} page={page} theirsOnly={theirsOnly} />) : null}
    </>
  );
}

/**
 * One line of an open subject: the assessment, its date, and each side's
 * grade in its column (blank for a side without one). ״רק לך״ or ״רק לנועה״
 * only in a subject both have, and only where the model says (`onlyOne`): in
 * one of theirs alone every line is theirs.
 */
function GradeLine({ row, page, theirsOnly }: { row: GradeRow; page: BuddyPage; theirsOnly: boolean }): React.JSX.Element {
  const p = usePalette();
  const title = row.name ? isolateRanges(row.name) : BUDDY_COPY.gradeUnnamed;
  const date = formatShortDate(row.date);
  const only = theirsOnly ? null : row.onlyOne === 'mine' ? BUDDY_COPY.onlyMine : row.onlyOne === 'theirs' ? BUDDY_COPY.onlyTheirs(page.name) : null;
  const cell = (grade: BuddyGrade | null) => {
    if (!grade) return null;
    return grade.value !== undefined ? <Score text={String(grade.value)} /> : <Words>{gradeText(grade)}</Words>;
  };
  return (
    <Row
      title={title}
      titleStyle={styles.childTitle}
      subtitle={(
        <Text style={[styles.line, { color: p.textMuted }]}>
          <Ltr style={[styles.line, { color: p.textMuted }]}>{date}</Ltr>
          {only ? `, ${only}` : ''}
        </Text>
      )}
      end={(
        <View style={styles.end}>
          <View style={styles.cells}>
            {theirsOnly ? null : <Cell>{cell(row.mine)}</Cell>}
            <Cell>{cell(row.theirs)}</Cell>
          </View>
          <Chevron open={false} shown={false} />
        </View>
      )}
      style={styles.childRow}
      accessible
      accessibilityLabel={[
        title, date,
        row.mine && !theirsOnly ? `${BUDDY_COPY.yours} ${gradeText(row.mine)}` : null,
        row.theirs ? `${page.name} ${gradeText(row.theirs)}` : null,
        only,
      ].filter((part): part is string => part !== null).join(', ')}
    />
  );
}

/**
 * The bagrut part (2.3), under the subjects, and only once their box is here
 * (`list` or `empty`): asked for, waiting for them, or the questionnaires,
 * those both of us sat first. None when nobody chose it or this phone has no
 * bagrut (`'none'`).
 */
function BagrutPart({ page, open, onToggle }: {
  page: BuddyPage;
  open: Record<string, boolean>;
  onToggle: (key: string) => void;
}): React.JSX.Element | null {
  const p = usePalette();
  const { state, bagrut, compare } = page.grades;
  if ((state !== 'list' && state !== 'empty') || bagrut === 'none') return null;
  const rows = bagrut === 'list' ? [...(compare?.bagrut.shared ?? []), ...(compare?.bagrut.others ?? [])] : [];
  // Their box has the part, and no questionnaire in it: nothing to show under a heading.
  if (bagrut === 'list' && rows.length === 0) return null;
  return (
    <View>
      <Text accessibilityRole="header" style={[styles.label, { color: p.textMuted }]}>{BUDDY_COPY.bagrutHead}</Text>
      {bagrut === 'theirs' ? <StateLine page={page} line={BUDDY_COPY.bagrutTheirs(page.name)} button={BUDDY_COPY.turnOnToo} which="bagrut" /> : null}
      {bagrut === 'mine' ? <BuddyTabNote>{BUDDY_COPY.bagrutMine(page.name)}</BuddyTabNote> : null}
      {rows.length > 0 ? (
        <View style={[styles.list, { borderTopColor: p.border }]}>
          {rows.map((row) => {
            const key = rowKey(row.mine === null, `bagrut${row.semel}`);
            return <BagrutLines key={key} row={row} page={page} open={open[key] === true} onToggle={() => onToggle(key)} />;
          })}
        </View>
      ) : null}
    </View>
  );
}

/** A questionnaire's parts, as a tap shows them and as a cell says them when there is no final grade. */
const PARTS = [
  { key: 'school', word: BUDDY_COPY.bagrutSchool },
  { key: 'exam', word: BUDDY_COPY.bagrutExam },
] as const;

/** One side of a questionnaire in words, for the screen reader: the final grade, else the parts there are (״מגן 92, בחינה 85״). */
function bagrutSaid(side: BuddyBagrutRow): string {
  if (side.final !== undefined) return String(side.final);
  return PARTS.flatMap(({ key, word }) => (side[key] !== undefined ? [`${word} ${side[key]}`] : [])).join(', ');
}

/**
 * A questionnaire's row: its name as Mashov gives it, each side's final grade,
 * or without one the parts there are (״מגן 92״, ״בחינה 85״: no final is
 * worked out of them, 2.3). A tap shows the school's and the exam's grades on
 * lines of their own, when a final grade hides them. One of theirs alone has
 * their column only, and no ״רק ל…״.
 */
function BagrutLines({ row, page, open, onToggle }: {
  row: BagrutRow;
  page: BuddyPage;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const { mine, theirs } = row;
  const sides = mine ? [mine, theirs] : [theirs];
  const parts = PARTS.filter(({ key }) => sides.some((side) => side[key] !== undefined));
  const opens = parts.length > 0 && sides.some((side) => side.final !== undefined);
  const title = isolateRanges(row.name);
  const finalCell = (side: BuddyBagrutRow) => (side.final !== undefined ? <Score text={String(side.final)} big /> : (
    <View style={styles.parts}>
      {PARTS.map(({ key, word }) => {
        const grade = side[key];
        return grade === undefined ? null : (
          <Text key={key} maxScale={1.15} style={[styles.part, { color: p.text }]}>
            {`${word} `}
            <Ltr>{String(grade)}</Ltr>
          </Text>
        );
      })}
    </View>
  ));
  return (
    <>
      <Row
        title={title}
        titleLines={2}
        end={(
          <View style={styles.end}>
            <View style={styles.cells}>
              {mine ? <Cell who={BUDDY_COPY.yours}>{finalCell(mine)}</Cell> : null}
              <Cell who={page.name}>{finalCell(theirs)}</Cell>
            </View>
            <Chevron open={open} shown={opens} />
          </View>
        )}
        onPress={opens ? onToggle : undefined}
        accessible
        accessibilityState={opens ? { expanded: open } : undefined}
        accessibilityLabel={[title, mine ? `${BUDDY_COPY.yours} ${bagrutSaid(mine)}` : null, `${page.name} ${bagrutSaid(theirs)}`]
          .filter((part): part is string => part !== null).join(', ')}
      />
      {open && opens ? parts.map(({ key, word }) => {
        const grade = (side: BuddyBagrutRow | null) => {
          const value = side?.[key];
          return value === undefined ? null : <Score text={String(value)} />;
        };
        return (
          <Row
            key={key}
            title={word}
            titleStyle={styles.childTitle}
            end={(
              <View style={styles.end}>
                <View style={styles.cells}>
                  {mine ? <Cell>{grade(mine)}</Cell> : null}
                  <Cell>{grade(theirs)}</Cell>
                </View>
                <Chevron open={false} shown={false} />
              </View>
            )}
            style={styles.childRow}
            accessible
            accessibilityLabel={[
              word,
              mine?.[key] !== undefined ? `${BUDDY_COPY.yours} ${mine[key]}` : null,
              theirs[key] !== undefined ? `${page.name} ${theirs[key]}` : null,
            ].filter((part): part is string => part !== null).join(', ')}
          />
        );
      }) : null}
    </>
  );
}

/** One side's column: ״אין ממוצע״ fits it, and the start of a name. */
const CELL = 64;
const CHEVRON = 18;

const styles = StyleSheet.create({
  content: { paddingBottom: space.xxl },
  // As the headings of ״חיסורים״.
  label: { fontFamily: font.bodySemi, fontSize: type.caption, paddingHorizontal: ROW_GUTTER, paddingTop: space.lg, paddingBottom: space.xs },
  list: { borderTopWidth: 1 },
  firstList: { marginTop: space.sm },
  // The text button's own padding taken back, so its words start where the line above does.
  action: { alignItems: 'flex-start', paddingStart: ROW_GUTTER - space.md, paddingTop: space.xs },
  end: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  numbers: { alignItems: 'center', gap: 2 },
  numbersLabel: { fontFamily: font.body, fontSize: type.caption },
  cells: { flexDirection: 'row', gap: space.sm },
  cell: { width: CELL, alignItems: 'center' },
  who: { fontFamily: font.body, fontSize: type.caption },
  big: { fontFamily: font.headingSemi, fontSize: type.heading, fontVariant: ['tabular-nums'] },
  score: { fontFamily: font.headingSemi, fontSize: type.title, fontVariant: ['tabular-nums'] },
  words: { fontFamily: font.bodySemi, fontSize: type.caption, textAlign: 'center' },
  parts: { alignItems: 'center' },
  part: { fontFamily: font.bodySemi, fontSize: type.caption },
  chevronRoom: { width: CHEVRON },
  flip: { transform: [{ rotate: '180deg' }] },
  // An open subject's lines, set in as on the School screen.
  childRow: { paddingStart: ROW_GUTTER + space.lg },
  childTitle: { fontSize: type.body },
  line: { fontFamily: font.body, fontSize: type.small },
  // Over an open subject's lines, set in as they are.
  uncounted: { fontFamily: font.body, fontSize: type.caption, lineHeight: 20, paddingStart: ROW_GUTTER + space.lg, paddingEnd: ROW_GUTTER, paddingVertical: space.sm },
  note: { fontFamily: font.body, fontSize: type.caption, lineHeight: 20, paddingHorizontal: ROW_GUTTER, paddingTop: space.lg },
});
