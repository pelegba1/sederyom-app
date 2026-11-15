/**
 * מה מוצג: which lessons and which exams the app shows. Two rows, each opening
 * the screen where the student marks what is theirs, with the count under it.
 */
import React from 'react';
import { LESSONS_COPY } from '../../lib/school';
import { examsMarkedLabel, settingsCounts, subjectsShownLabel } from '../../lib/onboarding';
import type { RootNavigation } from '../../navigation/types';
import { LinkRow, SettingsPage } from './parts';

export function ShownSettingsScreen({ navigation }: { navigation: RootNavigation }): React.JSX.Element {
  return (
    <SettingsPage>
      {(data) => {
        // Said the positive way, as the screens behind them say it: what is shown, not what is hidden.
        const counts = settingsCounts(data);
        const parent = data.settings.audience === 'parent';
        return (
          <>
            <LinkRow
              label={LESSONS_COPY[parent ? 'parent' : 'student'].title}
              value={data.subjects.length > 0 ? subjectsShownLabel(counts.subjects) : undefined}
              onPress={() => navigation.navigate('MyLessons')}
            />
            <LinkRow
              label="המבחנים שלי"
              value={data.exams.length > 0 ? examsMarkedLabel(counts.exams) : 'עוד אין מבחנים'}
              onPress={() => navigation.navigate('MyExams')}
            />
          </>
        );
      }}
    </SettingsPage>
  );
}
