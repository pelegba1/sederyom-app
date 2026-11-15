/**
 * מראה: the colours (בהיר / כהה / לפי הטלפון) and the text size, with a sample
 * line drawn in the app's own Text so it resizes the moment a size is chosen.
 * Both change how every screen looks, so they have a page of their own. Under
 * them, how Today draws lessons of one subject in a row. The page's title is
 * the heading, so there is no section heading over them.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTodayLessonsApart } from '../../api/hooks';
import { ROW_GUTTER } from '../../components/notebook';
import { Text, usePalette, useTextScalePreference, useThemePreference } from '../../components/ui';
import {
  LESSON_ROWS_LABELS, LESSON_ROWS_ORDER, LESSON_ROWS_TITLE, TEXT_SCALE_ORDER, TEXT_SIZE_NOTE, TEXT_SIZE_SAMPLE, THEME_LABELS, lessonRowsNote,
} from '../../lib/onboarding';
import { TEXT_SCALE_LABELS, THEME_PREFERENCES, font, space, type } from '../../theme';
import type { RootNavigation } from '../../navigation/types';
import { Segments, SettingsPage } from './parts';

export function AppearanceSettingsScreen(_props: { navigation: RootNavigation }): React.JSX.Element {
  const p = usePalette();
  const appearance = useThemePreference();
  const textSize = useTextScalePreference();
  const [lessonsApart, setLessonsApart] = useTodayLessonsApart();
  return (
    <SettingsPage>
      {(data) => (
        <View style={[styles.gutter, { gap: space.xl }]}>
          <Segments
            label="צבעים"
            options={THEME_PREFERENCES}
            labels={THEME_LABELS}
            value={appearance.preference}
            onChange={appearance.setPreference}
          />
          <View>
            <Segments
              label="גודל טקסט"
              options={TEXT_SCALE_ORDER}
              labels={TEXT_SCALE_LABELS}
              value={textSize.scale}
              onChange={textSize.setScale}
            />
            {/* Drawn with the app's Text, so it resizes the moment a size is chosen. */}
            <View style={styles.sample}>
              <Text style={{ fontFamily: font.bodySemi, fontSize: type.title, color: p.text }}>{TEXT_SIZE_SAMPLE}</Text>
              <Text style={[styles.hint, { color: p.textMuted }]}>כך ייראה הטקסט באפליקציה</Text>
            </View>
            <Text style={[styles.hint, { color: p.textMuted, marginTop: space.md }]}>{TEXT_SIZE_NOTE}</Text>
          </View>
          <View>
            <Segments
              label={LESSON_ROWS_TITLE}
              options={LESSON_ROWS_ORDER}
              labels={LESSON_ROWS_LABELS}
              value={lessonsApart ? 'apart' : 'together'}
              onChange={(rows) => setLessonsApart(rows === 'apart')}
            />
            <Text style={[styles.hint, { color: p.textMuted, marginTop: space.md }]}>{lessonRowsNote(data.settings.audience)}</Text>
          </View>
        </View>
      )}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  /** The page's gutter, where the rows' text starts; the top is the room a section heading would have left. */
  gutter: { paddingHorizontal: ROW_GUTTER, paddingTop: space.xl },
  hint: { fontFamily: font.body, fontSize: type.small, lineHeight: 20 },
  sample: { marginTop: space.lg, gap: 2 },
});
