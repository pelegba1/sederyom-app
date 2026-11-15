/**
 * איפה המורה? (docs/superpowers/specs/2026-11-04-teacher-search-design.md):
 * type a teacher's name, see where they are now and the rest of their day.
 *
 * The server reads every class timetable on the school's Shahaf site and
 * sends today's day of every teacher (`GET /v2/teachers`); the phone filters
 * as you type (`matchTeachers`). One teacher found, or one picked from the
 * list: the answer at the top in a sentence ("עכשיו: שעה 4, ספרות, יא3"),
 * then the day on the ruled page, the period now marked, what they are not in
 * struck through. The clock moves on the minute, as Today's does.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { TeacherDay } from '@sederyom/shared';
import { matchTeachers, teacherIsThere } from '@sederyom/shared/logic/teachers';
import { nowTz, timeStrOf } from '@sederyom/shared/logic/time';
import { DateTime } from 'luxon';
import { useTeachers } from '../api/hooks';
import { MarginList, MarginRow, ROW_GUTTER, Row } from '../components/notebook';
import { SearchField } from '../components/SearchField';
import { EmptyState, ErrorState, Loading, Screen, SectionTitle, Text, usePalette } from '../components/ui';
import { TEACHER_SEARCH_COPY as COPY, isNowPeriod, nowLines, periodStatus, periodWhere, teachingToday } from '../lib/teacherSearch';
import { TIMEZONE } from '../config';
import { font, space, type } from '../theme';

/** `HH:mm` in the school's zone, on every minute boundary and on coming back to the app. */
function useMinuteTime(): string {
  const read = (): string => timeStrOf(nowTz(TIMEZONE));
  const [time, setTime] = useState(read);
  useEffect(() => {
    const tick = (): void => setTime(read());
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, 60_000 - (Date.now() % 60_000) + 50);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      sub.remove();
    };
  }, []);
  return time;
}

function hhmm(iso: string): string {
  return timeStrOf(DateTime.fromISO(iso).setZone(TIMEZONE));
}

export function TeacherSearchScreen(): React.JSX.Element {
  const p = usePalette();
  const query = useTeachers();
  const time = useMinuteTime();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  const data = query.data;
  const teachers = data && data !== 'unsupported' ? data.teachers : [];
  const found = useMemo(() => matchTeachers(teachers, text), [teachers, text]);
  const shown: TeacherDay | null =
    (picked ? found.find((t) => t.name === picked) : null) ?? (found.length === 1 ? found[0]! : null);

  const onType = (value: string): void => {
    setText(value);
    setPicked(null);
  };

  let body: React.ReactNode;
  if (query.isPending) body = <Loading label={COPY.loading} />;
  else if (query.isError && !data) body = <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />;
  else if (data === 'unsupported') body = <EmptyState text={COPY.unsupported} />;
  else if (!data) body = <EmptyState text={COPY.noClass} />;
  else if (data.date === null) body = <EmptyState text={COPY.noLessonsToday} />;
  else if (text.trim() === '') body = <Text style={[styles.hint, { color: p.textMuted }]}>{COPY.hint(teachingToday(teachers))}</Text>;
  else if (found.length === 0) {
    body = (
      <View style={styles.pad}>
        <Text style={[styles.empty, { color: p.text }]}>{COPY.noMatch}</Text>
        <Text style={[styles.hint, styles.flush, { color: p.textMuted }]}>{COPY.noMatchWhy}</Text>
      </View>
    );
  } else if (shown) body = <TeacherAnswer day={shown} time={time} />;
  else {
    body = (
      <View>
        {found.map((t) => (
          <Row
            key={t.name}
            title={t.name}
            subtitle={nowLines(t, time).now}
            chevron
            accessibilityRole="button"
            accessibilityLabel={`${t.name}, ${nowLines(t, time).now}`}
            onPress={() => setPicked(t.name)}
          />
        ))}
      </View>
    );
  }

  return (
    <Screen>
      <View style={styles.field}>
        <SearchField label={COPY.fieldLabel} placeholder={COPY.placeholder} value={text} onChangeText={onType} />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
      >
        {body}
        {data && data !== 'unsupported' && data.date !== null ? (
          <Text style={[styles.source, { color: p.textFaint }]}>{COPY.source(hhmm(data.readAt))}</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function TeacherAnswer({ day, time }: { day: TeacherDay; time: string }): React.JSX.Element {
  const p = usePalette();
  const lines = nowLines(day, time);
  return (
    <View>
      <View style={styles.pad}>
        <Text accessibilityRole="header" style={[styles.name, { color: p.text }]}>{day.name}</Text>
        <Text style={[styles.now, { color: p.text }]}>{lines.now}</Text>
        {lines.next ? <Text style={[styles.next, { color: p.textMuted }]}>{lines.next}</Text> : null}
      </View>
      {day.periods.length === 0 ? null : (
        <View style={styles.heading}>
          <SectionTitle>{COPY.todayHeading}</SectionTitle>
        </View>
      )}
      <MarginList>
        {day.periods.map((period) => {
          const status = periodStatus(period);
          const there = teacherIsThere(period);
          const where = periodWhere(period);
          return (
            <MarginRow
              key={`${period.hourIndex}|${period.subject}|${period.covering ?? ''}`}
              margin={period.startTime ?? String(period.hourIndex)}
              title={period.subject}
              subtitle={[`שעה ${period.hourIndex}`, where].filter(Boolean).join(', ')}
              tone={!there ? 'cancelled' : isNowPeriod(day, period, time) ? 'now' : 'normal'}
              end={status ? <Text style={[styles.status, { color: there ? p.textMuted : p.cancel }]}>{status}</Text> : undefined}
              accessibilityLabel={[`שעה ${period.hourIndex}`, period.subject, where, status].filter(Boolean).join(', ')}
            />
          );
        })}
      </MarginList>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', paddingHorizontal: ROW_GUTTER, paddingTop: space.md, paddingBottom: space.sm },
  scroll: { paddingBottom: space.xxl },
  heading: { paddingHorizontal: ROW_GUTTER, marginTop: space.lg },
  pad: { paddingHorizontal: ROW_GUTTER, paddingTop: space.md, paddingBottom: space.md },
  hint: { fontFamily: font.body, fontSize: type.small, paddingHorizontal: ROW_GUTTER, paddingTop: space.md },
  flush: { paddingHorizontal: 0 },
  empty: { fontFamily: font.bodySemi, fontSize: type.body },
  name: { fontFamily: font.heading, fontSize: type.heading },
  now: { fontFamily: font.bodySemi, fontSize: type.title, marginTop: space.sm },
  next: { fontFamily: font.body, fontSize: type.body, marginTop: space.xs },
  status: { fontFamily: font.bodySemi, fontSize: type.small },
  source: { fontFamily: font.body, fontSize: type.caption, paddingHorizontal: ROW_GUTTER, paddingTop: space.xl },
});
