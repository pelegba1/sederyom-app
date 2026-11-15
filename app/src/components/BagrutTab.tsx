/**
 * "בגרות" in the School screen (plan §14.2–14.4, §15): one table per subject,
 * the fields typed into directly — a row per questionnaire with its weight,
 * הגשה (the school's annual grade), בגרות (the exam) and the final worked out
 * from them — under the averages (plain, and weighted by an institution's
 * bonuses, with "כמה צריך?").
 *
 * Mashov's grades fill the fields, and any of them can be typed over: what
 * the owner enters wins, and says so in one word under it — "שינית" over
 * Mashov's, "משוער" where Mashov has nothing and the sitting is ahead, "שלך"
 * where it is behind — always drawn dashed, never colour alone. A subject's
 * other entries (in the average or not, the split, the way back to the
 * table, removing what the owner added) sit in its "⋮" menu, not in a sheet
 * one has to open to edit a grade. A subject Mashov does not list yet can be
 * added under the tables.
 *
 * Wave 9 (plan §16): the averages are the tab's one raised surface. Each
 * subject is a section of the page, its table on the page in ruled rows. A
 * cell one types into looks like a field (`fieldLook`), a worked-out cell is
 * plain text, and an empty value has one mark, "–" (`EMPTY_MARK`).
 *
 * Rendered inside the School screen's own ScrollView, in its page gutter: no
 * ScrollView here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useBagrut } from '../api/hooks';
import {
  addableSubjects, averageUnitsParts, buildSubjects, changedGrades, disconnectedLine, EMPTY_MARK, estimatedGrades, formatAverage,
  gradeWord, isCodeId, needParts, NO_BAGRUT_YET, ORIGIN_WORD, partsText, plainAverage, requiredExamGrade, subjectGap, subjectKeyFor,
  subjectLevels, tableChanges, upcomingDate, weightedAverage,
  type AverageResult, type BagrutPrefs, type GradeField, type GradeOrigin, type Goal, type Parts, type Questionnaire, type Subject,
} from '../lib/bagrut';
import { INSTITUTIONS, institution as findInstitution, type Institution } from '../lib/bagrutBonus';
import { CATALOG } from '../lib/bagrutCatalog';
import {
  addRow, addSubject, clearGrades, isUnits, parseNumberInput, readBagrutPrefs, removeRow, removeSubject, resetToTable, restoreRow,
  restoreSubject, setGrade, setInstitution, setQuestionnaireShare, setQuestionnaireWeight, setSubjectExcluded, setSubjectUnits,
  writeBagrutPrefs, type NewRow,
} from '../lib/bagrutStore';
import { isolateRanges, plural, todayStr } from '../lib/format';
import { connectLabel, staleBanner, type MashovLink } from '../lib/school';
import { font, space, type } from '../theme';
import { AppIcon } from './AppIcon';
import { fieldLook } from './fieldLook';
import { FilterChip, ROW_MIN_HEIGHT } from './notebook';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Card, EmptyState, ErrorState, Loading, Ltr, MIN_TOUCH, Switch, Text, TextInput, usePalette } from './ui';

export interface BagrutTabProps {
  /** The School screen's Mashov state: what to say when Mashov is not connected. */
  link: MashovLink;
  onConnect: () => void;
}

type Update = (change: (prefs: BagrutPrefs) => BagrutPrefs) => void;

/** The owner's entries, read once and written through on every change. */
function useBagrutPrefs(): [BagrutPrefs, Update] {
  const [prefs, setPrefs] = useState<BagrutPrefs>(readBagrutPrefs);
  const update = useCallback<Update>((change) => {
    setPrefs((prev) => {
      const next = change(prev);
      if (next !== prev) writeBagrutPrefs(next);
      return next;
    });
  }, []);
  return [prefs, update];
}

/**
 * The table's columns, so that five fit 375 points at the usual text size:
 * 375 − 40 (the page's gutters) leaves 335, and the fixed columns and their
 * gaps take 212 of it. The first column takes the rest and wraps at 1.3.
 */
const COL = { weight: 56, grade: 50, final: 40, gap: 4 } as const;
const WEIGHT_FIELD = 42;

/** A cell of fixed width, and the fields in it: never bigger than 1.15, or they would not fit. */
const CELL_SCALE = 1.15;

/** The isolate pair `Ltr` puts around a number, for a chip's plain-string label. */
const LTR_START = '⁦';
const LTR_END = '⁩';

export function BagrutTab({ link, onConnect }: BagrutTabProps): React.JSX.Element {
  const bagrut = useBagrut();
  const [prefs, update] = useBagrutPrefs();
  const toast = useToast();
  const today = todayStr();
  const exams = bagrut.data?.exams;
  const subjects = useMemo(() => (exams ? buildSubjects(exams, prefs, CATALOG, today) : []), [exams, prefs, today]);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [needOpen, setNeedOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  if (bagrut.isLoading) return <Loading />;
  if (bagrut.isError || !bagrut.data) {
    return <ErrorState message={(bagrut.error as Error | undefined)?.message ?? 'שגיאה'} onRetry={() => void bagrut.refetch()} />;
  }

  const shown = new Set(subjects.map((s) => s.key));
  const addSheet = (
    <AddSubjectSheet visible={adding} shown={shown} onClose={() => setAdding(false)} onAdd={(change) => {
      update(change);
      setAdding(false);
    }} />
  );

  if (subjects.length === 0) {
    if (!link.connected) {
      return <EmptyState icon="grade" text={disconnectedLine(link)} action={{ label: connectLabel(link), onPress: onConnect }} />;
    }
    return (
      <View>
        <EmptyState icon="grade" text={NO_BAGRUT_YET} action={{ label: 'להוסיף מקצוע', onPress: () => setAdding(true) }} />
        {addSheet}
      </View>
    );
  }

  const chosen = findInstitution(prefs.institution);
  const menuSubject = menuKey ? subjects.find((s) => s.key === menuKey) ?? null : null;
  const estimates = estimatedGrades(subjects);

  const removeAdded = (key: string): void => {
    const before = prefs;
    setMenuKey(null);
    update((prev) => removeSubject(prev, key));
    toast.show('המקצוע הוסר', { onAction: () => update((prev) => restoreSubject(prev, before, key)) });
  };
  const removeQuestionnaire = (key: string, id: string): void => {
    const before = prefs;
    update((prev) => removeRow(prev, key, id));
    toast.show('השאלון הוסר', { onAction: () => update((prev) => restoreRow(prev, before, key, id)) });
  };

  return (
    <View>
      {!link.connected ? <StaleLine link={link} onConnect={onConnect} /> : null}
      <AveragesCard
        subjects={subjects}
        chosen={chosen}
        onChoose={(id) => update((prev) => setInstitution(prev, prev.institution === id ? null : id))}
        onNeed={() => setNeedOpen(true)}
      />
      {subjects.map((s) => (
        <SubjectSection key={s.key} subject={s} today={today} update={update} onMenu={() => setMenuKey(s.key)} />
      ))}
      <View style={styles.bottomActions}>
        <Button title="להוסיף מקצוע" variant="ghost" onPress={() => setAdding(true)} />
        {estimates.length > 0 ? (
          <Button title="לנקות את המשוערים" variant="ghost" onPress={() => update((prev) => clearGrades(prev, estimates))} />
        ) : null}
      </View>
      <SubjectMenu
        subject={menuSubject}
        update={update}
        onClose={() => setMenuKey(null)}
        onRemoveSubject={removeAdded}
        onRemoveRow={removeQuestionnaire}
      />
      <NeedSheet visible={needOpen} subjects={subjects} chosen={chosen} onClose={() => setNeedOpen(false)} />
      {addSheet}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Small parts

/** A line with numbers in it: each number through `Ltr`. */
function PartsText({ parts, style }: { parts: Parts; style: React.ComponentProps<typeof Text>['style'] }): React.JSX.Element {
  return (
    <Text style={style}>
      {parts.map((part, i) => (typeof part === 'string' ? part : <Ltr key={i} style={style}>{part.ltr}</Ltr>))}
    </Text>
  );
}

/** The tab's one mark for "nothing here" (plan §16): "–" in `textFaint`. */
function Empty({ size = type.body }: { size?: number }): React.JSX.Element {
  const p = usePalette();
  return <Text maxScale={CELL_SCALE} style={{ fontFamily: font.body, fontSize: size, color: p.textFaint }}>{EMPTY_MARK}</Text>;
}

/** "משוער": dashed, in words — never colour alone (plan §14.4). */
function EstimateMark(): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={[styles.estimateMark, { borderColor: p.textMuted }]}>
      <Text style={{ fontFamily: font.bodyMedium, fontSize: type.caption, color: p.textMuted }}>{ORIGIN_WORD.estimate}</Text>
    </View>
  );
}

/** Over data Mashov can no longer refresh: how old it is, and the way back. A ruled line, not a box. */
function StaleLine({ link, onConnect }: { link: MashovLink; onConnect: () => void }): React.JSX.Element {
  const p = usePalette();
  const b = staleBanner('grades', link);
  const action = connectLabel(link);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${b.lead}${b.date ?? ''}${b.tail}. ${action}`}
      onPress={onConnect}
      style={({ pressed }) => [styles.banner, { borderBottomColor: p.border, opacity: pressed ? 0.75 : 1 }]}
    >
      <Text style={{ flex: 1, fontFamily: font.body, fontSize: type.small, color: p.text }}>
        {b.lead}
        {b.date ? <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.text }}>{b.date}</Ltr> : null}
        {b.tail}
      </Text>
      <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.accent }}>{action}</Text>
      <AppIcon name="chevronLeft" color={p.accent} size={16} />
    </Pressable>
  );
}

/**
 * A number field that commits when editing ends, so clearing it to type a
 * new number does not snap back on the way. Cleared and left, it shows
 * what Mashov or the table says again. Drawn as a field (`fieldLook`), so
 * it never reads as a worked-out value; empty, it shows the one empty mark.
 */
function NumberField({
  value, onCommit, label, dashed, width, autoFocus, onDone, placeholder = EMPTY_MARK,
}: {
  value: number | null;
  onCommit: (value: number | null) => void;
  /** What a screen reader says: the field and the questionnaire or subject by name. */
  label: string;
  /** Drawn dashed: the owner's value, not Mashov's or the table's. */
  dashed?: boolean;
  width: number;
  autoFocus?: boolean;
  /** After it commits: the units field folds back into its line. */
  onDone?: () => void;
  placeholder?: string;
}): React.JSX.Element {
  const p = usePalette();
  const shown = value === null ? '' : String(value);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(shown);
  }, [shown]);
  const commit = (): void => {
    if (!editing.current) return;
    editing.current = false;
    setFocused(false);
    const next = parseNumberInput(text);
    if (next !== value) onCommit(next);
    // Cleared: what is under it comes back (through `value` when the entry goes).
    setText(next === null ? shown : String(next));
    onDone?.();
  };
  return (
    <TextInput
      accessibilityLabel={label}
      value={text}
      autoFocus={autoFocus}
      onFocus={() => {
        editing.current = true;
        setFocused(true);
      }}
      onChangeText={setText}
      onEndEditing={commit}
      onSubmitEditing={commit}
      onBlur={commit}
      keyboardType="decimal-pad"
      returnKeyType="done"
      selectTextOnFocus
      placeholder={placeholder}
      placeholderTextColor={p.textFaint}
      maxLength={5}
      maxScale={CELL_SCALE}
      style={[styles.field, { width, color: p.text }, fieldLook(p, { focused, dashed })]}
    />
  );
}

/** The one word under a value the owner entered. */
function Word({ text }: { text: string | null }): React.JSX.Element | null {
  const p = usePalette();
  if (!text) return null;
  return (
    <Text maxScale={CELL_SCALE} numberOfLines={1} style={{ fontFamily: font.bodyMedium, fontSize: type.caption, color: p.textMuted, textAlign: 'center' }}>
      {text}
    </Text>
  );
}

const isOwner = (origin: GradeOrigin | null): boolean => origin === 'override' || origin === 'estimate' || origin === 'own';

// ---------------------------------------------------------------------------
// The averages

/** An average: the plain one is the tab's hero number, in the display face (plan §16.1); the institution's beside it is quieter. */
function AverageValue({ avg, hero }: { avg: AverageResult; hero: boolean }): React.JSX.Element {
  const p = usePalette();
  const style = hero
    ? { fontFamily: font.display, fontSize: type.display, lineHeight: Math.round(type.display * 1.3), color: p.text }
    : { fontFamily: font.headingSemi, fontSize: type.heading, color: p.text };
  if (avg.value === null) return <Empty size={hero ? type.display : type.heading} />;
  return (
    <View style={styles.averageLine}>
      <Ltr style={style}>{formatAverage(avg.value)}</Ltr>
      {avg.estimated ? <EstimateMark /> : null}
    </View>
  );
}

/** The averages, the tab's one raised surface: the plain one with its units, the institution's beside it, and "כמה צריך?". */
function AveragesCard({
  subjects, chosen, onChoose, onNeed,
}: {
  subjects: Subject[];
  chosen: Institution | null;
  onChoose: (id: Institution['id']) => void;
  onNeed: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  const [help, setHelp] = useState(false);
  const [picking, setPicking] = useState(false);
  const plain = plainAverage(subjects);
  const weighted = chosen ? weightedAverage(subjects, chosen.rules) : null;
  // A subject whose bonus the institution does not state is left out of its average (the Technion at 4 units).
  const noBonus = weighted ? weighted.missing - plain.missing : 0;
  const source = chosen?.source ?? null;
  const muted = { fontFamily: font.body, fontSize: type.small, color: p.textMuted } as const;

  return (
    <Card style={styles.averages}>
      <View style={styles.averagesRow}>
        <View style={{ flex: 1 }}>
          <Text style={muted}>ממוצע</Text>
          <AverageValue avg={plain} hero />
          <PartsText parts={averageUnitsParts(plain)} style={muted} />
        </View>
        {/* The institution: a text control with its chevron, not a box inside the card. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={chosen
            ? `ממוצע משוקלל, ${chosen.name}${weighted?.value != null ? `: ${formatAverage(weighted.value)}` : ''}`
            : 'ממוצע משוקלל: לבחור מוסד'}
          accessibilityState={{ expanded: picking }}
          onPress={() => setPicking((v) => !v)}
          style={({ pressed }) => [styles.weighted, { opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={styles.weightedLabel}>
            <Text style={muted}>{chosen ? chosen.short : 'משוקלל'}</Text>
            <View style={picking ? styles.flip : null}>
              <AppIcon name="chevronDown" color={p.textMuted} size={14} />
            </View>
          </View>
          {weighted ? <AverageValue avg={weighted} hero={false} /> : (
            <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.accent }}>לבחור מוסד</Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="איך מחשבים"
          accessibilityState={{ expanded: help }}
          onPress={() => setHelp((v) => !v)}
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <AppIcon name="help" color={help ? p.accent : p.textMuted} size={22} />
        </Pressable>
      </View>

      {picking ? (
        <View style={styles.chips} accessibilityRole="radiogroup">
          {INSTITUTIONS.map((inst) => (
            <FilterChip
              key={inst.id}
              role="radio"
              label={inst.short}
              selected={inst.id === chosen?.id}
              accessibilityLabel={inst.name}
              onPress={() => {
                onChoose(inst.id);
                setPicking(false);
              }}
            />
          ))}
        </View>
      ) : null}

      {help ? (
        <View style={styles.help}>
          <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.text, lineHeight: 21 }}>
            ממוצע לפי יח״ל. משוקלל: עם הבונוס של המוסד.
          </Text>
          {chosen && source ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`לפי כללי ${chosen.name} לשנת ${source.year}. כדאי לוודא באתר המוסד`}
              onPress={() => void Linking.openURL(encodeURI(source.url)).catch(() => toast.show('לא הצלחנו לפתוח את האתר'))}
              style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.text, lineHeight: 21 }}>
                {`לפי כללי ${chosen.name} לשנת `}
                <Ltr style={{ fontFamily: font.body, fontSize: type.small, color: p.text }}>{source.year}</Ltr>
                {'. '}
                <Text style={{ fontFamily: font.bodySemi, color: p.accent }}>כדאי לוודא באתר המוסד</Text>
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {noBonus > 0 ? (
        <Text style={muted}>
          {plural(noBonus, 'בלי מקצוע אחד: הבונוס שלו לא ידוע', 'מקצועות בלי בונוס ידוע')}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="כמה צריך"
        accessibilityHint="פותח חישוב של הציון שצריך כדי להגיע ליעד"
        onPress={onNeed}
        style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.accent }}>כמה צריך?</Text>
        <AppIcon name="chevronLeft" color={p.accent} size={16} />
      </Pressable>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// A subject: its table

/** "5 יח״ל" in muted words beside the subject's name, tapped into a small number field and back. */
function UnitsControl({ subject, update }: { subject: Subject; update: Update }): React.JSX.Element {
  const p = usePalette();
  const [editing, setEditing] = useState(false);
  const word = subject.unitsOrigin === 'override' ? ORIGIN_WORD.override : null;
  if (editing) {
    return (
      <View style={styles.unitsEdit}>
        <NumberField
          value={subject.units}
          width={52}
          autoFocus
          label={`יחידות לימוד, ${subject.name}`}
          dashed={subject.unitsOrigin === 'override'}
          onCommit={(v) => update((prev) => setSubjectUnits(prev, subject.key, v))}
          onDone={() => setEditing(false)}
        />
        <Text style={{ fontFamily: font.body, fontSize: type.small, color: p.textMuted }}>יח״ל</Text>
      </View>
    );
  }
  // Missing where it counts; out of the average (the theory test), it is just not there.
  const missing = subject.units === null && !subject.excluded;
  const muted = { fontFamily: font.body, fontSize: type.small, color: p.textMuted } as const;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${subject.units === null ? 'חסר יח״ל' : `${subject.units} יחידות לימוד`}${word ? `, ${word}` : ''}. לשנות`}
      onPress={() => setEditing(true)}
      hitSlop={{ top: 12, bottom: 12 }}
      style={({ pressed }) => [styles.units, { opacity: pressed ? 0.7 : 1 }]}
    >
      {missing ? (
        <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.change }}>חסר יח״ל</Text>
      ) : subject.units === null ? (
        <Text style={muted}>
          <Text style={{ color: p.textFaint }}>{EMPTY_MARK}</Text>
          {' יח״ל'}
        </Text>
      ) : (
        <Text style={muted}>
          <Ltr style={muted}>{String(subject.units)}</Ltr>
          {` יח״ל${word ? `, ${word}` : ''}`}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * One subject, a section of the page: its name with its units under it in
 * muted words, the subject's final in the display face, the "⋮" menu, and
 * its table in ruled rows.
 */
function SubjectSection({
  subject, today, update, onMenu,
}: {
  subject: Subject;
  today: string;
  update: Update;
  onMenu: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const final = subject.final.kind === 'ok' ? subject.final : null;
  // Missing units say so on the units themselves, where they are entered.
  const gap = subject.units === null && !subject.excluded ? null : subjectGap(subject);
  const changed = changedGrades(subject);
  const [adding, setAdding] = useState(false);
  const key = subject.key;
  const caption = { fontFamily: font.bodyMedium, fontSize: type.caption, color: p.textMuted } as const;

  return (
    <View style={[styles.subject, { opacity: subject.excluded ? 0.8 : 1 }]}>
      <View style={styles.header}>
        <View style={styles.headerName}>
          <Text accessibilityRole="header" style={{ fontFamily: font.headingSemi, fontSize: type.title, color: p.text }}>
            {isolateRanges(subject.name)}
          </Text>
          <View style={styles.headerLine}>
            <UnitsControl subject={subject} update={update} />
            {subject.added ? <Text style={caption}>{ORIGIN_WORD.added}</Text> : null}
          </View>
        </View>
        <View style={styles.headerFinal} accessible accessibilityLabel={final ? `סופי ${final.value}${final.estimated ? `, ${ORIGIN_WORD.estimate}` : ''}` : 'סופי: עוד אין'}>
          <Text style={caption}>סופי</Text>
          {final ? (
            <Ltr style={{ fontFamily: font.display, fontSize: type.heading, lineHeight: Math.round(type.heading * 1.35), color: p.text }}>
              {String(final.value)}
            </Ltr>
          ) : <Empty size={type.heading} />}
          {final?.estimated ? <EstimateMark /> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`עוד, ${subject.name}`}
          accessibilityHint="בממוצע או לא, חלק ההגשה, לחזור לטבלה"
          onPress={onMenu}
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <AppIcon name="moreVert" color={p.textMuted} size={22} />
        </Pressable>
      </View>

      {gap ? <PartsText parts={gap} style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.change }} /> : null}

      {subject.questionnaires.length > 0 ? (
        <View>
          <View style={[styles.tableHead, { borderBottomColor: p.border }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text maxScale={CELL_SCALE} style={[caption, { flex: 1 }]}>שאלון</Text>
            <Text maxScale={CELL_SCALE} style={[caption, styles.headCell, { width: COL.weight }]}>משקל %</Text>
            <Text maxScale={CELL_SCALE} style={[caption, styles.headCell, { width: COL.grade }]}>הגשה</Text>
            <Text maxScale={CELL_SCALE} style={[caption, styles.headCell, { width: COL.grade }]}>בגרות</Text>
            <Text maxScale={CELL_SCALE} style={[caption, styles.headCell, { width: COL.final }]}>סופי</Text>
          </View>
          {subject.questionnaires.map((q) => (
            <QuestionnaireRow key={q.id} q={q} today={today} subjectKey={key} update={update} />
          ))}
        </View>
      ) : null}

      {adding ? (
        <AddRowForm
          subjectName={subject.name}
          onCancel={() => setAdding(false)}
          onAdd={(row) => {
            update((prev) => addRow(prev, key, row));
            setAdding(false);
          }}
        />
      ) : (
        <View style={styles.footRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`להוסיף שאלון, ${subject.name}`}
            onPress={() => setAdding(true)}
            style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.accent }}>+ שאלון</Text>
          </Pressable>
          {changed.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`לחזור למשוב, ${subject.name}`}
              onPress={() => update((prev) => clearGrades(prev, changed))}
              style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.accent }}>לחזור למשוב</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** One questionnaire, a ruled row: its code (or name), weight, הגשה, בגרות as fields, and the final they make as plain text. */
function QuestionnaireRow({
  q, today, subjectKey, update,
}: {
  q: Questionnaire;
  today: string;
  subjectKey: string;
  update: Update;
}): React.JSX.Element {
  const p = usePalette();
  const date = upcomingDate(q, today);
  const share = q.share ?? 50;
  const who = `שאלון ${q.label}`;
  const labelStyle = { fontFamily: font.bodySemi, fontSize: type.small, color: p.text } as const;
  const setField = (field: GradeField) => (v: number | null): void => update((prev) => setGrade(prev, q.id, field, v));

  const grade = (field: GradeField, title: string): React.JSX.Element => {
    const value = q[field];
    // The part a split leaves out (the exam of a school-assessed questionnaire): nothing to type.
    if ((field === 'school' && share <= 0) || (field === 'exam' && share >= 100)) {
      return (
        <View style={[styles.finalCell, { width: COL.grade }]} accessible accessibilityLabel={`${title}: לא חלק מהציון, ${who}`}>
          <Empty />
        </View>
      );
    }
    const word = gradeWord(value.origin);
    return (
      <View style={[styles.cell, { width: COL.grade }]}>
        <NumberField
          value={value.value}
          width={COL.grade}
          label={`${title}, ${who}${word ? `, ${word}` : ''}`}
          dashed={isOwner(value.origin)}
          onCommit={setField(field)}
        />
        <Word text={word} />
      </View>
    );
  };

  return (
    <View style={[styles.row, { borderBottomColor: p.border, opacity: q.counts ? 1 : 0.6 }]}>
      <View style={styles.labelCell}>
        {q.semel !== null ? (
          <Ltr style={labelStyle}>{q.part ? `${q.label} (${q.part})` : q.label}</Ltr>
        ) : (
          <Text style={labelStyle}>{isolateRanges(q.label)}</Text>
        )}
        {date ? <Ltr style={{ fontFamily: font.body, fontSize: type.caption, color: p.textMuted }}>{date}</Ltr> : null}
      </View>
      <View style={[styles.cell, { width: COL.weight }]}>
        {/* The "%" lives in the column's title: beside the field it read as "% 1261", glued to the code. */}
        <NumberField
          value={q.weight}
          width={WEIGHT_FIELD}
          label={`משקל במקצוע, ${who}${q.weightOrigin === 'override' ? `, ${ORIGIN_WORD.override}` : ''}`}
          dashed={q.weightOrigin === 'override'}
          onCommit={(v) => update((prev) => setQuestionnaireWeight(prev, subjectKey, q.id, v))}
        />
        <Word text={q.weightOrigin === 'override' ? ORIGIN_WORD.override : null} />
      </View>
      {grade('school', 'הגשה')}
      {grade('exam', 'בגרות')}
      {/* Worked out, not typed: plain text, no field (plan §16). */}
      <View
        style={[styles.finalCell, { width: COL.final }]}
        accessible
        accessibilityLabel={`סופי, ${who}: ${q.final.value ?? 'עוד אין'}${q.final.estimated ? `, ${ORIGIN_WORD.estimate}` : ''}`}
      >
        {q.final.value === null ? <Empty /> : (
          <Ltr style={{ fontFamily: font.headingSemi, fontSize: type.body, color: p.text }}>{String(q.final.value)}</Ltr>
        )}
      </View>
    </View>
  );
}

/** "+ שאלון": a code or a name, and its weight; the split is the table's for a code it knows, else 30. */
function AddRowForm({ subjectName, onAdd, onCancel }: { subjectName: string; onAdd: (row: NewRow) => void; onCancel: () => void }): React.JSX.Element {
  const p = usePalette();
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');
  const text = name.trim();
  const add = (): void => {
    if (!text) return;
    const known = isCodeId(text) && CATALOG.entries[Number(text)] !== undefined;
    onAdd({ name: text, weight: parseNumberInput(weight), share: known ? null : DEFAULT_SHARE });
  };
  const input = [styles.input, { color: p.text }, fieldLook(p)];
  return (
    <View style={styles.addRow}>
      <TextInput
        accessibilityLabel={`שם או סמל של שאלון חדש, ${subjectName}`}
        value={name}
        onChangeText={setName}
        autoFocus
        placeholder="שם או סמל"
        placeholderTextColor={p.textFaint}
        maxLength={40}
        style={[input, { flex: 1, minWidth: 110 }]}
      />
      <TextInput
        accessibilityLabel="משקל במקצוע, באחוזים"
        value={weight}
        onChangeText={setWeight}
        keyboardType="decimal-pad"
        placeholder="משקל %"
        placeholderTextColor={p.textFaint}
        maxLength={5}
        maxScale={CELL_SCALE}
        style={[input, { width: 76, textAlign: 'center' }]}
      />
      <Button title="להוסיף" onPress={add} disabled={!text} />
      <Pressable accessibilityRole="button" accessibilityLabel="לא להוסיף" onPress={onCancel} style={styles.iconButton}>
        <AppIcon name="close" color={p.textMuted} size={18} />
      </Pressable>
    </View>
  );
}

/** The split of a questionnaire the owner names, until they say otherwise: 30% הגשה, 70% בגרות (the reform's). */
const DEFAULT_SHARE = 30;

// ---------------------------------------------------------------------------
// A subject: its "⋮" menu

function SubjectMenu({
  subject, update, onClose, onRemoveSubject, onRemoveRow,
}: {
  subject: Subject | null;
  update: Update;
  onClose: () => void;
  onRemoveSubject: (key: string) => void;
  onRemoveRow: (key: string, id: string) => void;
}): React.JSX.Element {
  const p = usePalette();
  const toast = useToast();
  // The last subject stays drawn while the sheet slides away.
  const last = useRef<Subject | null>(subject);
  if (subject) last.current = subject;
  const s = subject ?? last.current;
  if (!s) return <Sheet visible={false} onClose={onClose}><View /></Sheet>;

  const key = s.key;
  const changes = tableChanges(s);
  const source = s.questionnaires.find((q) => q.source)?.source ?? null;
  const muted = { fontFamily: font.body, fontSize: type.small, color: p.textMuted } as const;
  const footer = changes || s.added ? (
    <View style={{ gap: space.sm }}>
      {changes ? <Button title="לחזור לטבלה" variant="ghost" onPress={() => update((prev) => resetToTable(prev, key, changes))} /> : null}
      {s.added ? <Button title="להסיר את המקצוע" variant="danger" onPress={() => onRemoveSubject(key)} /> : null}
    </View>
  ) : undefined;

  return (
    <Sheet visible={subject !== null} onClose={onClose} title={s.name} footer={footer}>
      <View style={{ gap: space.md }}>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: !s.excluded }}
          accessibilityLabel={`נספר בממוצע, ${s.name}`}
          onPress={() => update((prev) => setSubjectExcluded(prev, key, !s.excluded))}
          style={[styles.switchRow, { borderBottomColor: p.border }]}
        >
          <Text style={{ flex: 1, fontFamily: font.bodySemi, fontSize: type.title, color: p.text }}>נספר בממוצע</Text>
          <Switch value={!s.excluded} />
        </Pressable>

        {s.questionnaires.length > 0 ? (
          <View>
            <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.textMuted }}>חלק ההגשה בציון</Text>
            {s.questionnaires.map((q) => {
              const word = q.share === null ? 'לא ידוע' : q.shareOrigin === 'override' ? ORIGIN_WORD.override : null;
              return (
                <View key={q.id} style={[styles.menuRow, { borderBottomColor: p.border }]}>
                  <View style={{ flex: 1 }}>
                    {q.semel !== null ? (
                      <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text }}>{q.part ? `${q.label} (${q.part})` : q.label}</Ltr>
                    ) : (
                      <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text }}>{isolateRanges(q.label)}</Text>
                    )}
                    {word ? <Text style={{ fontFamily: font.bodyMedium, fontSize: type.caption, color: q.share === null ? p.change : p.textMuted }}>{word}</Text> : null}
                  </View>
                  <View style={styles.weightLine}>
                    <Text style={muted}>%</Text>
                    <NumberField
                      value={q.share}
                      width={COL.grade}
                      placeholder="50"
                      label={`חלק ההגשה בציון, שאלון ${q.label}${word ? `, ${word}` : ''}`}
                      dashed={q.shareOrigin === 'override' || q.shareOrigin === 'own'}
                      onCommit={(v) => update((prev) => setQuestionnaireShare(prev, key, q.id, v))}
                    />
                  </View>
                  {q.added ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`להסיר את שאלון ${q.label}`}
                      onPress={() => onRemoveRow(key, q.id)}
                      style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
                    >
                      <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.cancel }}>להסיר</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {source ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`מקור הטבלה, ${source.year}`}
            onPress={() => void Linking.openURL(encodeURI(source.url)).catch(() => toast.show('לא הצלחנו לפתוח את האתר'))}
            style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.accent }}>
              {'מקור הטבלה, '}
              <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.accent }}>{source.year}</Ltr>
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Adding a subject

const OTHER = 'other';

interface DraftRow {
  name: string;
  weight: string;
  share: string;
}

const firstRow = (): DraftRow => ({ name: '', weight: '100', share: String(DEFAULT_SHARE) });

/**
 * "להוסיף מקצוע": a subject from the table, or "מקצוע אחר" by name; its
 * units; and its questionnaires — the table's at that level, or rows the
 * owner names, with a weight and the split.
 */
function AddSubjectSheet({
  visible, shown, onClose, onAdd,
}: {
  visible: boolean;
  shown: ReadonlySet<string>;
  onClose: () => void;
  onAdd: (change: (prefs: BagrutPrefs) => BagrutPrefs) => void;
}): React.JSX.Element {
  const p = usePalette();
  const [choice, setChoice] = useState<string | null>(null);
  const [otherName, setOtherName] = useState('');
  const [units, setUnits] = useState<number | null>(null);
  const [unitsText, setUnitsText] = useState('');
  const [setIndex, setSetIndex] = useState<number | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([firstRow()]);
  useEffect(() => {
    if (!visible) return;
    setChoice(null);
    setOtherName('');
    setUnits(null);
    setUnitsText('');
    setSetIndex(null);
    setRows([firstRow()]);
  }, [visible]);

  const options = addableSubjects(CATALOG, shown);
  const levels = choice && choice !== OTHER ? subjectLevels(CATALOG, choice) : [];
  const level = levels.find((l) => l.units === units) ?? null;
  const sets = level?.sets ?? [];
  const set = sets.length === 1 ? sets[0]! : setIndex !== null ? sets[setIndex] ?? null : null;
  const name = choice === OTHER ? otherName.trim() : choice ? CATALOG.subjects[choice]?.name ?? '' : '';
  const key = choice === OTHER ? (name ? subjectKeyFor(name, CATALOG) : null) : choice;
  const taken = key !== null && shown.has(key);
  const freeUnits = levels.length === 0;
  const chosenUnits = freeUnits ? parseNumberInput(unitsText) : units;
  const newRows: NewRow[] = freeUnits
    // The first row left unnamed is the subject itself, as its placeholder says.
    ? rows.map((r, i) => ({ name: r.name.trim() || (i === 0 ? name : ''), weight: parseNumberInput(r.weight), share: parseNumberInput(r.share) }))
      .filter((r) => r.name)
    : (set ?? []).map((c) => ({ name: String(c), weight: null, share: null }));
  const ready = key !== null && !taken && name.length > 0 && chosenUnits !== null && isUnits(chosenUnits) && (freeUnits || set !== null);

  const add = (): void => {
    if (!ready || key === null || chosenUnits === null) return;
    onAdd((prev) => addSubject(prev, key, name, chosenUnits, newRows));
  };
  const label = { fontFamily: font.bodySemi, fontSize: type.small, color: p.textMuted } as const;
  const input = [styles.input, { color: p.text }, fieldLook(p)];
  const setRow = (i: number, change: Partial<DraftRow>): void => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...change } : r)));

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="להוסיף מקצוע"
      footer={<Button title="להוסיף" onPress={add} disabled={!ready} />}
    >
      <View style={{ gap: space.lg }}>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {[...options, { id: OTHER, name: 'מקצוע אחר' }].map((o) => (
            <FilterChip
              key={o.id}
              role="radio"
              label={o.name}
              selected={choice === o.id}
              accessibilityLabel={o.name}
              onPress={() => {
                setChoice(o.id);
                const ls = o.id === OTHER ? [] : subjectLevels(CATALOG, o.id);
                setUnits(ls.length === 1 ? ls[0]!.units : null);
                setSetIndex(null);
              }}
            />
          ))}
        </View>

        {choice === OTHER ? (
          <TextInput
            accessibilityLabel="שם המקצוע"
            value={otherName}
            onChangeText={setOtherName}
            placeholder="שם המקצוע"
            placeholderTextColor={p.textFaint}
            maxLength={40}
            style={input}
          />
        ) : null}
        {taken ? <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.change }}>כבר ברשימה</Text> : null}

        {choice ? (
          <View style={{ gap: space.sm }}>
            <Text style={label}>יח״ל</Text>
            {freeUnits ? (
              <TextInput
                accessibilityLabel="יחידות לימוד"
                value={unitsText}
                onChangeText={setUnitsText}
                keyboardType="decimal-pad"
                placeholder="2"
                placeholderTextColor={p.textFaint}
                maxLength={4}
                maxScale={CELL_SCALE}
                style={[input, { width: 76, textAlign: 'center' }]}
              />
            ) : (
              <View style={styles.chips} accessibilityRole="radiogroup">
                {levels.map((l) => (
                  <FilterChip
                    key={l.units}
                    role="radio"
                    label={`${LTR_START}${l.units}${LTR_END} יח״ל`}
                    selected={units === l.units}
                    accessibilityLabel={`${l.units} יחידות לימוד`}
                    onPress={() => {
                      setUnits(l.units);
                      setSetIndex(null);
                    }}
                  />
                ))}
              </View>
            )}
          </View>
        ) : null}

        {!freeUnits && level ? (
          <View style={{ gap: space.sm }}>
            <Text style={label}>שאלונים</Text>
            {sets.length > 1 ? (
              <View style={styles.chips} accessibilityRole="radiogroup">
                {sets.map((codes, i) => (
                  <FilterChip
                    key={codes.join('-')}
                    role="radio"
                    label={`${LTR_START}${codes.join(', ')}${LTR_END}`}
                    selected={setIndex === i}
                    accessibilityLabel={`שאלונים ${codes.join(', ')}`}
                    onPress={() => setSetIndex(i)}
                  />
                ))}
              </View>
            ) : (
              <Ltr style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text }}>{(sets[0] ?? []).join(', ')}</Ltr>
            )}
          </View>
        ) : null}

        {choice && freeUnits ? (
          <View style={{ gap: space.sm }}>
            <View style={styles.draftRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={[label, { flex: 1 }]}>שאלון</Text>
              <Text maxScale={CELL_SCALE} style={[label, styles.headCell, { width: 64 }]}>משקל %</Text>
              <Text maxScale={CELL_SCALE} style={[label, styles.headCell, { width: 64 }]}>הגשה %</Text>
            </View>
            {rows.map((r, i) => (
              <View key={i} style={styles.draftRow}>
                <TextInput
                  accessibilityLabel={`שם או סמל, שאלון ${i + 1}`}
                  value={r.name}
                  onChangeText={(v) => setRow(i, { name: v })}
                  placeholder={i === 0 && name ? name : 'שם או סמל'}
                  placeholderTextColor={p.textFaint}
                  maxLength={40}
                  style={[input, { flex: 1 }]}
                />
                <TextInput
                  accessibilityLabel={`משקל במקצוע, שאלון ${i + 1}`}
                  value={r.weight}
                  onChangeText={(v) => setRow(i, { weight: v })}
                  keyboardType="decimal-pad"
                  maxLength={5}
                  maxScale={CELL_SCALE}
                  style={[input, { width: 64, textAlign: 'center' }]}
                />
                <TextInput
                  accessibilityLabel={`חלק ההגשה בציון, שאלון ${i + 1}`}
                  value={r.share}
                  onChangeText={(v) => setRow(i, { share: v })}
                  keyboardType="decimal-pad"
                  maxLength={5}
                  maxScale={CELL_SCALE}
                  style={[input, { width: 64, textAlign: 'center' }]}
                />
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="להוסיף שאלון"
              onPress={() => setRows((all) => [...all, { name: '', weight: '', share: String(DEFAULT_SHARE) }])}
              style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.accent }}>+ שאלון</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// How much do I need — the averages

function NeedSheet({
  visible, subjects, chosen, onClose,
}: {
  visible: boolean;
  subjects: Subject[];
  chosen: Institution | null;
  onClose: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const [which, setWhich] = useState<'plain' | 'weighted'>('plain');
  const [target, setTarget] = useState('');
  const [focused, setFocused] = useState(false);
  const rules = chosen ? chosen.rules : null;
  const kind = which === 'weighted' && rules ? 'weighted' : 'plain';
  const goal: Goal = kind === 'weighted' && rules ? { kind: 'weighted', rules } : { kind: 'plain' };
  const value = parseNumberInput(target);
  const need = value !== null ? requiredExamGrade(value, goal, subjects) : null;
  const choices: { key: 'plain' | 'weighted'; label: string }[] = [
    { key: 'plain', label: 'ממוצע' },
    ...(chosen && rules ? [{ key: 'weighted' as const, label: `משוקלל (${chosen.short})` }] : []),
  ];

  // The goal and its answer are the sheet's footer, pinned under the body and over the
  // keyboard: at the bottom of the scrolling body the answer was cut at the sheet's
  // edge (run 7, Noa). The body holds only the choice of average.
  const footer = (
    <View style={{ gap: space.sm }}>
      <View style={styles.rowBetween}>
        <Text style={{ flex: 1, fontFamily: font.body, fontSize: type.body, color: p.textMuted }}>היעד</Text>
        <View style={{ width: 88 }}>
          <TextInput
            accessibilityLabel="היעד לממוצע"
            value={target}
            onChangeText={setTarget}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            keyboardType="decimal-pad"
            maxLength={6}
            maxScale={CELL_SCALE}
            placeholder={kind === 'weighted' ? '110' : '90'}
            placeholderTextColor={p.textFaint}
            style={[styles.input, { textAlign: 'center', color: p.text }, fieldLook(p, { focused })]}
          />
        </View>
      </View>
      {need ? (
        <View accessibilityLiveRegion="polite" accessible accessibilityLabel={partsText(needParts(need))}>
          <PartsText parts={needParts(need)} style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text, lineHeight: 23 }} />
        </View>
      ) : null}
    </View>
  );

  return (
    <Sheet visible={visible} onClose={onClose} title="כמה צריך?" footer={footer}>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {choices.map((c) => (
          <FilterChip
            key={c.key}
            role="radio"
            label={c.label}
            selected={c.key === kind}
            accessibilityLabel={c.label}
            onPress={() => setWhich(c.key)}
          />
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: ROW_MIN_HEIGHT,
    paddingVertical: space.sm, borderBottomWidth: 1, marginBottom: space.md,
  },
  iconButton: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  help: { gap: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: MIN_TOUCH, alignSelf: 'flex-start' },
  averages: { gap: space.sm },
  averagesRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  averageLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  weighted: { minHeight: MIN_TOUCH, minWidth: 88, justifyContent: 'center', alignItems: 'flex-start' },
  weightedLabel: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  flip: { transform: [{ rotate: '180deg' }] },
  estimateMark: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 3, paddingHorizontal: 6, paddingVertical: 1 },
  subject: { marginTop: space.xxl, gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  headerName: { flex: 1, gap: 2 },
  headerLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  headerFinal: { alignItems: 'center', minWidth: 48 },
  // 24 tall and 12 of `hitSlop` above and below: a 48-point target for a line of muted words.
  units: { alignSelf: 'flex-start', minHeight: 24, minWidth: MIN_TOUCH, justifyContent: 'center' },
  unitsEdit: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  tableHead: { flexDirection: 'row', alignItems: 'flex-end', gap: COL.gap, paddingBottom: space.xs, borderBottomWidth: 1 },
  headCell: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: COL.gap, borderBottomWidth: 1, paddingVertical: space.sm },
  labelCell: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center' },
  cell: { alignItems: 'center', minHeight: MIN_TOUCH, justifyContent: 'flex-start' },
  weightLine: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  finalCell: { minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  field: {
    minHeight: MIN_TOUCH, paddingHorizontal: 2, paddingVertical: 0,
    fontFamily: font.bodySemi, fontSize: type.body, textAlign: 'center',
  },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: space.xs },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap', paddingTop: space.sm },
  input: {
    minHeight: MIN_TOUCH, paddingHorizontal: space.sm, paddingVertical: 0,
    fontFamily: font.body, fontSize: type.body,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: ROW_MIN_HEIGHT, borderBottomWidth: 1 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderBottomWidth: 1, paddingVertical: space.sm },
  draftRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  bottomActions: { alignItems: 'center', gap: space.sm, marginTop: space.lg },
});
