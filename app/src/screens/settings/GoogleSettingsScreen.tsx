/**
 * Google: what the app does with the student's Google account. The switch that
 * puts exams on the calendar, and the way into the list of calendars shown in
 * the app. Both are about the same account, so they share a page.
 */
import React from 'react';
import { CALENDARS_HINT, calendarsShownLabel, settingsCounts } from '../../lib/onboarding';
import type { RootNavigation } from '../../navigation/types';
import { ExamsToCalendarSwitch } from './ExamsToCalendarSwitch';
import { LinkRow, SettingsPage } from './parts';

export function GoogleSettingsScreen({ navigation }: { navigation: RootNavigation }): React.JSX.Element {
  return (
    <SettingsPage>
      {(data) => {
        const counts = settingsCounts(data);
        return (
          <>
            <ExamsToCalendarSwitch />
            <LinkRow
              label="יומן Google"
              hint={CALENDARS_HINT}
              value={data.calendars.length > 0 ? calendarsShownLabel(counts.calendars) : 'עוד אין יומנים'}
              onPress={() => navigation.navigate('Calendars')}
            />
          </>
        );
      }}
    </SettingsPage>
  );
}
