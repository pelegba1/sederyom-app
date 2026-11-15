/**
 * The absence rules (חיסורים): how much a student may miss and how many lates
 * make an absence. Two rows of radio chips, drawn on Settings and wherever else
 * the absence tracker's rules are set.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSettings, useStatus } from '../../api/hooks';
import { FilterChip, Row } from '../../components/notebook';
import { mashovWasRead } from '../../lib/connections';
import { space } from '../../theme';
import { usePatch } from './parts';

/** The choices for how many lates make an absence (3 is the school's usual rule). */
const LATES_PER_ABSENCE = [2, 3, 4, 5] as const;
/** The usual limits in school regulations; 15% is the most common. */
const ABSENCE_LIMITS = [10, 15, 20, 25] as const;

/**
 * Whether the absence rules are shown on this phone. A parent's phone has
 * none of what only the student's Mashov brings, until the parent's own Mashov
 * was read (stage 3 of docs/parents-plan.md): then the two settings are the
 * child's. Kept in one place, so a page can hide the heading above the rules
 * exactly when the rules hide themselves.
 */
export function useAbsenceRulesShown(): boolean {
  const settings = useSettings();
  const status = useStatus();
  return settings.data?.settings.audience !== 'parent' || mashovWasRead(status.data?.sources);
}

/**
 * "כמה מותר לחסר" and "כמה איחורים הם חיסור": the percentage of a subject's
 * lessons a half-year may miss, and the lates that count as one absence.
 * Nothing while the settings have not loaded, and nothing where
 * `useAbsenceRulesShown` is false.
 */
export function AbsenceRules(): React.JSX.Element | null {
  const settings = useSettings();
  const shown = useAbsenceRulesShown();
  const { patch } = usePatch();
  if (!settings.data || !shown) return null;
  const s = settings.data.settings;
  return (
    <>
      <Row title="כמה מותר לחסר" subtitle="מהשיעורים בכל מקצוע במחצית, לפי תקנון בית הספר">
        <View accessibilityRole="radiogroup" accessibilityLabel="כמה מותר לחסר" style={[styles.chips, { marginTop: space.sm }]}>
          {ABSENCE_LIMITS.map((n) => (
            <FilterChip
              key={n}
              role="radio"
              label={`${n}%`}
              accessibilityLabel={`עד ${n} אחוז מהשיעורים`}
              selected={(s.attendance?.limitPercent ?? 15) === n}
              onPress={() => patch({ attendance: { limitPercent: n } })}
            />
          ))}
        </View>
      </Row>
      <Row title="כמה איחורים הם חיסור" subtitle="במעקב החיסורים, בלשונית בית ספר">
        <View accessibilityRole="radiogroup" accessibilityLabel="כמה איחורים הם חיסור" style={[styles.chips, { marginTop: space.sm }]}>
          {LATES_PER_ABSENCE.map((n) => (
            <FilterChip
              key={n}
              role="radio"
              label={String(n)}
              accessibilityLabel={`${n} איחורים הם חיסור`}
              selected={(s.attendance?.latesPerAbsence ?? 3) === n}
              onPress={() => patch({ attendance: { latesPerAbsence: n } })}
            />
          ))}
        </View>
      </Row>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
