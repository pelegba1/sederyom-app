/**
 * The switch that puts the student's exams in a Google calendar. Drawn in two
 * places: Settings → Google, and המבחנים שלי, where the exams are marked.
 */
import React from 'react';
import { useSettings } from '../../api/hooks';
import { PARENT_GOOGLE_COPY } from '../../lib/connections';
import { DEMO_COPY } from '../../demo/mode';
import { isDemo } from '../../demo/phone';
import { SwitchRow, usePatch } from './parts';

/**
 * "המבחנים שלך ביומן Google". The demo writes nothing to Google: off there
 * (`demoSettings`), and it stays off. A parent's phone holds every child's
 * exams (`runPhoneMirror`), and says so. Nothing while the settings have not
 * loaded.
 */
export function ExamsToCalendarSwitch(): React.JSX.Element | null {
  const settings = useSettings();
  const { patch, busy } = usePatch();
  if (!settings.data) return null;
  const s = settings.data.settings;
  const demo = isDemo();
  const parent = s.audience === 'parent';
  return (
    <SwitchRow
      label={parent ? PARENT_GOOGLE_COPY.examsLabel : 'המבחנים שלך ביומן Google'}
      hint={demo ? DEMO_COPY.noGoogle : parent ? PARENT_GOOGLE_COPY.examsHint : 'נוסיף את המבחנים שלך ליומן נפרד בשם ״בית ספר״'}
      value={demo ? false : s.examsToCalendar}
      busy={busy}
      disabled={demo}
      disabledHint={demo ? DEMO_COPY.noGoogle : undefined}
      onChange={(value) => patch({ examsToCalendar: value })}
    />
  );
}
