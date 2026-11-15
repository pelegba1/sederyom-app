/**
 * "חיסורים" in the School screen: per subject, how much was missed, what the
 * semester will look like at its end, and how many more lessons may still be
 * missed under the school's rule — up to and including 15% of the semester's
 * lessons, counting unjustified absences and every `latesPerAbsence` lates
 * (Settings) as one. The arithmetic is `lib/attendance.ts`; the lessons held
 * and still ahead come from the server (`views/attendance.ts`).
 *
 * Subjects are ruled rows, most at risk first; the end says how many are
 * left, in the red pen when the limit is passed (plan §16: never colour
 * alone, the words say it too). A tap opens the subject's own record. Under
 * them, the days off the count leaves out, and the owner's own (a trip, a
 * school day off) can be added from a month calendar.
 *
 * Rendered inside the School screen's own ScrollView, in its page gutter: no
 * ScrollView here.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { AttendanceEvent, AttendanceResponse } from '@sederyom/shared';
import { useAttendance, useSaveSettings, useSettings } from '../api/hooks';
import {
  byRisk, dayOffRanges, RLM, endLine, extrasLine, nowLine, paceLine, percent, rangeLabel, safeLine, standing, toggleDayOff,
  type SubjectStanding,
} from '../lib/attendance';
import { formatDate, formatShortDate, relativeTime, todayStr } from '../lib/format';
import { connectLabel, disconnectedText, type MashovLink } from '../lib/school';
import { font, space, type } from '../theme';
import { AbsenceRules, useAbsenceRulesShown } from '../screens/settings/AbsenceRules';
import { MonthCalendar } from './MonthCalendar';
import { AppIcon } from './AppIcon';
import { Row, ROW_GUTTER, SectionHeading } from './notebook';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, EmptyState, ErrorState, Loading, MIN_TOUCH, Text, usePalette } from './ui';

export interface AttendanceTabProps {
  /** The School screen's Mashov state: what to say when Mashov is not connected. */
  link: MashovLink;
  onConnect: () => void;
}

const NO_DATA_YET = 'עוד אין ממשוב נתוני נוכחות. הם ייקראו בסנכרון הבא.';

export function AttendanceTab({ link, onConnect }: AttendanceTabProps): React.JSX.Element {
  const attendance = useAttendance();
  const settings = useSettings();
  const save = useSaveSettings();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<'semesterStart' | 'semesterEnd' | null>(null);

  const data = attendance.data;
  const rows = useMemo(
    () => (data ? data.subjects.map((s) => ({ subject: s, standing: standing(s, data.limit, data.latesPerAbsence) })).sort(byRisk) : []),
    [data],
  );

  if (attendance.isLoading) return <Loading />;
  if (attendance.isError || !data) {
    return <ErrorState message={(attendance.error as Error | undefined)?.message ?? 'שגיאה'} onRetry={() => void attendance.refetch()} />;
  }

  const ownDays = settings.data?.settings.attendance?.daysOff ?? [];
  const setDayOff = (date: string): void => {
    save.mutate(
      { attendance: { daysOff: toggleDayOff(ownDays, date) } },
      { onError: () => toast.show('לא נשמר, אפשר לנסות שוב') },
    );
  };

  if (rows.length === 0) {
    if (!link.connected) {
      return <EmptyState icon="grade" text={disconnectedText('attendance', link)} action={{ label: connectLabel(link), onPress: onConnect }} />;
    }
    return <EmptyState icon="grade" text={NO_DATA_YET} />;
  }

  return (
    <View>
      <Intro data={data} link={link} onConnect={onConnect} />
      <Summary rows={rows} />
      <View style={styles.section}>
        {rows.map(({ subject, standing: st }) => (
          <SubjectRow
            key={subject.groupId}
            subject={subject}
            standing={st}
            latesPerAbsence={data.latesPerAbsence}
            open={open === subject.groupId}
            onPress={() => setOpen(open === subject.groupId ? null : subject.groupId)}
          />
        ))}
      </View>
      <DaysOff data={data} onAdd={() => setAdding(true)} onRemove={setDayOff} busy={save.isPending} />
      <Semester data={data} onEdit={setEditing} />
      <SemesterSheet
        field={editing}
        data={data}
        onClose={() => setEditing(null)}
        onPick={(field, date) => {
          setEditing(null);
          save.mutate({ attendance: { [field]: date } }, { onError: () => toast.show('לא נשמר, אפשר לנסות שוב') });
        }}
      />
      <AddDayOffSheet
        visible={adding}
        semesterEnd={data.semesterEnd}
        own={ownDays}
        onClose={() => setAdding(false)}
        onPick={(date) => {
          setAdding(false);
          setDayOff(date);
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------

/**
 * The rule in one line, and where the numbers come from. The sentence opens
 * the two absence settings in a sheet, also in Settings → אני ובית הספר
 * (settings spec §4.3). Where those settings are not shown (a parent's phone
 * before Mashov was read) it is plain text: a sheet with nothing in it never
 * opens. The numbers come from the server's answer, which a saved rule
 * refetches (`useSaveSettings`), so the sentence follows a change by itself.
 */
function Intro({ data, link, onConnect }: { data: AttendanceResponse; link: MashovLink; onConnect: () => void }): React.JSX.Element {
  const p = usePalette();
  const canEdit = useAbsenceRulesShown();
  const [rules, setRules] = useState(false);
  const read = data.fetchedAt ? `נקרא ממשוב ${relativeTime(data.fetchedAt)}.` : '';
  const sentence = (
    <Text style={[styles.line, styles.sentence, { color: p.text }]}>
      {`מותר לחסר עד ${percent(data.limit)} מהשיעורים בכל מקצוע במחצית, שנגמרת ב־⁦${formatDate(data.semesterEnd)}⁩. נספרים חיסורים לא מוצדקים, וכל ⁦${data.latesPerAbsence}⁩ איחורים הם חיסור אחד.`}
    </Text>
  );
  return (
    <View style={styles.intro}>
      {canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityHint="פותח את הבחירה כמה מותר לחסר וכמה איחורים הם חיסור"
          onPress={() => setRules(true)}
          style={styles.sentenceRow}
        >
          {sentence}
          <AppIcon name="chevronLeft" color={p.textFaint} size={16} />
        </Pressable>
      ) : sentence}
      {read ? <Text style={[styles.small, { color: p.textMuted }]}>{read}</Text> : null}
      {!link.connected ? (
        <Button title={`${connectLabel(link)}: המידע לא מתעדכן`} variant="ghost" onPress={onConnect} />
      ) : null}
      {canEdit ? (
        <Sheet visible={rules} onClose={() => setRules(false)} title="חיסורים">
          <AbsenceRules />
        </Sheet>
      ) : null}
    </View>
  );
}

/** One sentence over the list: how it stands overall. */
function Summary({ rows }: { rows: { subject: { subject: string }; standing: SubjectStanding }[] }): React.JSX.Element {
  const p = usePalette();
  const over = rows.filter((r) => r.standing.level === 'over');
  const pace = rows.filter((r) => r.standing.level !== 'over' && r.standing.paceOver).map((r) => r.subject.subject);
  const first = rows[0]!;
  const lead = over.length > 0
    ? over.length === 1 ? `במקצוע אחד עברת את הגבול: ${over[0]!.subject.subject}.` : `ב־⁦${over.length}⁩ מקצועות עברת את הגבול.`
    : pace.length > 0 ? 'כל המקצועות עוד בטווח.' : `כל המקצועות בטווח. הכי קרוב לגבול: ${first.subject.subject}, ${safeLine(first.standing)}.`;
  const tail = pace.length > 0 ? ` בקצב הנוכחי יעברו את הגבול: ${pace.join(', ')}.` : '';
  return <Text style={[styles.summary, { color: over.length > 0 ? p.cancel : p.textStrong }]}>{lead + tail}</Text>;
}

function SubjectRow({
  subject, standing: st, latesPerAbsence, open, onPress,
}: {
  subject: AttendanceResponse['subjects'][number];
  standing: SubjectStanding;
  latesPerAbsence: number;
  open: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const p = usePalette();
  const endColor = st.level === 'over' ? p.cancel : st.level === 'close' ? p.change : p.ok;
  // Without the subject in the weekly timetable, the lessons ahead are Mashov's weekly hours spread over the weeks: say so.
  const estimate = subject.remainingFrom === 'weeklyHours' ? 'השיעורים שנשארו: הערכה לפי שעות שבועיות' : null;
  const lines = [nowLine(subject, st), endLine(st), paceLine(st), extrasLine(subject, latesPerAbsence, st), estimate].filter(
    (l): l is string => Boolean(l),
  );
  return (
    <Row
      title={subject.subject}
      tone={st.level === 'over' ? 'late' : 'normal'}
      end={<Text style={[styles.end, { color: endColor }]}>{safeLine(st)}</Text>}
      accessibilityLabel={`${subject.subject}: ${safeLine(st)}. ${lines.join('. ')}`.replace(/[⁦⁩]/g, '')}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
    >
      {lines.map((l) => <Text key={l} style={[styles.small, { color: p.textMuted }]}>{l}</Text>)}
      {open ? <Record events={subject.events} /> : null}
    </Row>
  );
}

/** The subject's own absences and lates, newest first. */
function Record({ events }: { events: AttendanceEvent[] }): React.JSX.Element {
  const p = usePalette();
  if (events.length === 0) return <Text style={[styles.small, styles.record, { color: p.textMuted }]}>אין חיסורים ואיחורים במחצית.</Text>;
  return (
    <View style={styles.record}>
      {events.map((e, i) => {
        const what = e.kind === 'absence' ? 'חיסור' : 'איחור';
        const hour = e.hour !== null ? `, שיעור ⁦${e.hour}⁩` : '';
        const why = e.justified ? ` (מוצדק${e.justification ? `: ${e.justification}` : ''})` : '';
        return (
          <Text key={`${e.date}-${e.hour}-${e.kind}-${i}`} style={[styles.small, { color: e.justified ? p.textMuted : p.text }]}>
            {`${RLM}⁦${formatShortDate(e.date)}⁩${hour}: ${what}${why}`}
          </Text>
        );
      })}
    </View>
  );
}

function DaysOff({
  data, onAdd, onRemove, busy,
}: {
  data: AttendanceResponse;
  onAdd: () => void;
  onRemove: (date: string) => void;
  busy: boolean;
}): React.JSX.Element {
  const p = usePalette();
  const ranges = dayOffRanges(data.daysOffAhead);
  return (
    <View style={styles.section}>
      <View style={styles.gutter}>
        <SectionHeading end={<Button title="להוסיף יום" variant="ghost" onPress={onAdd} />} onPress={onAdd}>
          ימים בלי לימודים עד סוף המחצית
        </SectionHeading>
      </View>
      <Text style={[styles.small, styles.daysHint, { color: p.textMuted }]}>
        לא נספרים בשיעורים שנשארו. טיול או יום חופש של בית הספר אפשר להוסיף כאן.
      </Text>
      {ranges.length === 0 ? <Text style={[styles.small, styles.daysHint, { color: p.textMuted }]}>אין ימי חופש עד סוף המחצית.</Text> : null}
      {ranges.map((r) => (
        <Row
          key={`${r.from}-${r.name}`}
          title={r.name}
          subtitle={rangeLabel(r)}
          end={r.own ? <Button title="להסיר" variant="ghost" disabled={busy} onPress={() => onRemove(r.from)} /> : undefined}
        />
      ))}
    </View>
  );
}

/** The semester's two ends, each one tap from a calendar: the second semester needs new ones. */
function Semester({ data, onEdit }: { data: AttendanceResponse; onEdit: (field: 'semesterStart' | 'semesterEnd') => void }): React.JSX.Element {
  return (
    <View style={styles.section}>
      <View style={styles.gutter}>
        <SectionHeading>המחצית</SectionHeading>
      </View>
      <Row title="תחילת המחצית" subtitle={`${RLM}⁦${formatDate(data.semesterStart)}⁩`} chevron onPress={() => onEdit('semesterStart')} />
      <Row title="סוף המחצית" subtitle={`${RLM}⁦${formatDate(data.semesterEnd)}⁩`} chevron onPress={() => onEdit('semesterEnd')} />
    </View>
  );
}

function SemesterSheet({
  field, data, onClose, onPick,
}: {
  field: 'semesterStart' | 'semesterEnd' | null;
  data: AttendanceResponse;
  onClose: () => void;
  onPick: (field: 'semesterStart' | 'semesterEnd', date: string) => void;
}): React.JSX.Element {
  const p = usePalette();
  const [error, setError] = useState<string | null>(null);
  const current = field ? data[field] : null;
  return (
    <Sheet visible={field !== null} onClose={() => { setError(null); onClose(); }} title={field === 'semesterStart' ? 'תחילת המחצית' : 'סוף המחצית'}>
      <MonthCalendar
        date={current}
        onChange={(date) => {
          if (!field) return;
          const bad = field === 'semesterStart' ? date >= data.semesterEnd : date <= data.semesterStart;
          if (bad) {
            setError(field === 'semesterStart' ? 'התחלה צריכה להיות לפני הסוף.' : 'הסוף צריך להיות אחרי ההתחלה.');
            return;
          }
          setError(null);
          onPick(field, date);
        }}
      />
      <Text style={[styles.small, { color: error ? p.cancel : p.textMuted, marginTop: space.sm }]}>
        {error ?? 'חיסורים נספרים רק בין שני התאריכים. מספר השיעורים שהתקיימו בא ממשוב.'}
      </Text>
    </Sheet>
  );
}

function AddDayOffSheet({
  visible, semesterEnd, own, onClose, onPick,
}: {
  visible: boolean;
  semesterEnd: string;
  own: readonly string[];
  onClose: () => void;
  onPick: (date: string) => void;
}): React.JSX.Element {
  const p = usePalette();
  const today = todayStr();
  const [error, setError] = useState<string | null>(null);
  const marks = useMemo(() => Object.fromEntries(own.map((d) => [d, ['task'] as const])), [own]);
  return (
    <Sheet visible={visible} onClose={() => { setError(null); onClose(); }} title="יום בלי לימודים">
      <MonthCalendar
        date={null}
        marks={marks}
        onChange={(date) => {
          if (date <= today || date > semesterEnd) {
            setError(`אפשר לבחור יום מחר ועד ⁦${formatShortDate(semesterEnd)}⁩.`);
            return;
          }
          setError(null);
          onPick(date);
        }}
      />
      <Text style={[styles.small, { color: error ? p.cancel : p.textMuted, marginTop: space.sm }]}>
        {error ?? (own.length > 0 ? 'יום שכבר סימנת: בחירה שלו מסירה אותו.' : 'בחירה ביום מוסיפה אותו.')}
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space.xs, marginBottom: space.md, paddingHorizontal: ROW_GUTTER },
  line: { fontFamily: font.body, fontSize: type.body, lineHeight: 24 },
  sentenceRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH },
  sentence: { flex: 1 },
  small: { fontFamily: font.body, fontSize: type.small, lineHeight: 21 },
  summary: { fontFamily: font.bodySemi, fontSize: type.body, lineHeight: 24, marginBottom: space.sm, paddingHorizontal: ROW_GUTTER },
  section: { marginBottom: space.lg },
  gutter: { paddingHorizontal: ROW_GUTTER },
  end: { fontFamily: font.bodySemi, fontSize: type.small },
  record: { marginTop: space.sm, gap: 2 },
  daysHint: { paddingHorizontal: ROW_GUTTER, marginBottom: space.xs },
});
