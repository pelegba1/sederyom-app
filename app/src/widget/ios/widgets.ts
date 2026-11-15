/**
 * The three iPhone widgets as `expo-widgets` objects, by the names in the
 * `expo-widgets` plugin's options in `app.json` — the same names as the
 * Android providers. Creating one stores its layout in the App Group, where
 * the extension reads it; a timeline written before that is refused, so
 * `register.ios.ts` creates them at launch.
 */
import { createWidget, type Widget } from 'expo-widgets';
import { composeLayout, kit } from './kit';
import { overviewLayout } from './overview';
import { scheduleLayout } from './schedule';
import { tasksLayout } from './tasks';

export type IosWidgetName = 'Today' | 'TasksExams' | 'Overview';

let widgets: Record<IosWidgetName, Widget<object>> | null = null;

export function iosWidgets(): Record<IosWidgetName, Widget<object>> {
  if (widgets) return widgets;
  // Each layout reaches here as its own source (see `kit.tsx`); `createWidget`
  // is typed for a function and hands the native side whatever it is given.
  const layout = (source: unknown) => composeLayout(kit, source) as unknown as () => React.JSX.Element;
  widgets = {
    Today: createWidget('Today', layout(scheduleLayout)),
    TasksExams: createWidget('TasksExams', layout(tasksLayout)),
    Overview: createWidget('Overview', layout(overviewLayout)),
  };
  return widgets;
}
