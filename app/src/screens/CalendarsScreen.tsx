/**
 * Which Google Calendar content reaches the timeline: whole calendars by
 * switch, single events or series by long-press on the Today screen — and the
 * list of what was hidden that way, with a way back.
 *
 * Ruled rows on the page (plan §16.1), edge to edge, under two headings.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSaveSettings, useSettings } from '../api/hooks';
import { Row, ROW_GUTTER, SectionHeading } from '../components/notebook';
import { useToast } from '../components/Toast';
import { Button, EmptyState, ErrorState, Loading, Screen, Text, usePalette } from '../components/ui';
import { isolateRanges } from '../lib/format';
import { font, space, type } from '../theme';
import type { RootNavigation } from '../navigation/types';
import { LOAD_ERROR_TEXT } from './ConnectionsScreen';
import { SwitchRow } from './settings/parts';

export function CalendarsScreen({ navigation }: { navigation: RootNavigation }): React.JSX.Element {
  const p = usePalette();
  const settings = useSettings();
  const save = useSaveSettings();
  const toast = useToast();

  if (settings.isLoading) return <Screen><Loading /></Screen>;
  if (settings.isError || !settings.data) {
    return (
      <Screen>
        <ErrorState message={LOAD_ERROR_TEXT} onRetry={() => void settings.refetch()} />
      </Screen>
    );
  }

  const { calendars, hiddenEvents } = settings.data;
  const { hiddenCalendarIds, hiddenEventIds } = settings.data.settings.calendars;
  const onError = { onError: () => toast.show('לא הצלחנו לשמור. אפשר לנסות שוב') };

  const toggleCalendar = (id: string, shown: boolean): void => {
    const next = shown ? hiddenCalendarIds.filter((c) => c !== id) : [...hiddenCalendarIds, id];
    save.mutate({ calendars: { hiddenCalendarIds: next } }, onError);
  };
  const restoreEvent = (id: string): void => {
    save.mutate({ calendars: { hiddenEventIds: hiddenEventIds.filter((e) => e !== id) } }, onError);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {/* What a switch does, once, in place of a paragraph about the screen (plan §16.2). */}
        <Text style={[styles.lead, styles.gutter, { color: p.textMuted }]}>
          יומן כבוי לא יופיע באפליקציה, וב־Google שום דבר לא משתנה.
        </Text>

        <View style={styles.gutter}>
          <SectionHeading>יומנים</SectionHeading>
        </View>
        {calendars.length === 0 ? (
          <EmptyState
            icon="calendar"
            text="עוד אין כאן יומנים. אחרי החיבור ל־Google הם יופיעו כאן."
            action={{ label: 'למצב החיבורים', onPress: () => navigation.navigate('Connections') }}
          />
        ) : (
          calendars.map((cal) => {
            const shown = !hiddenCalendarIds.includes(cal.id);
            // Two calendars have no switch: the one the app writes the exams
            // to, and an exam board's calendar (the class's, or the person's
            // own) the app reads as exams.
            const fixed = cal.isSchoolCalendar || cal.isExamCalendar;
            const name = (
              <>
                <Text style={{ color: shown || fixed ? p.text : p.textMuted }}>{isolateRanges(cal.name)}</Text>
                {cal.primary ? <Text style={[styles.primary, { color: p.textMuted }]}>{'  ראשי'}</Text> : null}
              </>
            );
            if (!fixed) {
              return (
                <SwitchRow
                  key={cal.id}
                  label={`להציג את ${cal.name}`}
                  value={shown}
                  busy={save.isPending}
                  onChange={(value) => toggleCalendar(cal.id, value)}
                >
                  {name}
                </SwitchRow>
              );
            }
            // Two calendars have no switch, and say why in one line.
            return (
              <Row
                key={cal.id}
                title={name}
                subtitle={cal.isSchoolCalendar
                  ? 'המבחנים שלך נוספים לכאן, ולכן הוא לא מוצג פעמיים.'
                  : 'לוח המבחנים. מה שסימנת ב״המבחנים שלי״ כבר מופיע באפליקציה.'}
              />
            );
          })
        )}

        <View style={[styles.gutter, styles.section]}>
          <SectionHeading>אירועים מוסתרים</SectionHeading>
        </View>
        {hiddenEvents.length === 0 ? (
          <View style={styles.gutter}>
            <EmptyState text="אין אירועים מוסתרים. כדי להסתיר אירוע, לוחצים עליו לחיצה ארוכה ב״היום שלי״." />
          </View>
        ) : (
          hiddenEvents.map((ev) => (
            <Row
              key={ev.id}
              title={isolateRanges(ev.summary)}
              titleLines={1}
              subtitle={ev.series ? 'כל הסדרה' : 'אירוע אחד'}
              end={<Button title="להחזיר" variant="ghost" disabled={save.isPending} onPress={() => restoreEvent(ev.id)} />}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space.md, paddingBottom: 80 },
  /** The page's gutter, where the rows' text starts. */
  gutter: { paddingHorizontal: ROW_GUTTER },
  lead: { fontFamily: font.body, fontSize: type.small, lineHeight: 20, marginBottom: space.xl },
  section: { marginTop: space.xxl },
  primary: { fontFamily: font.bodyMedium, fontSize: type.small },
});
