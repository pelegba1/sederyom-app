import { readSubjectSlots } from '../lib/subjectColorStore';
import { readWidgetFeed, STALE_AFTER_MS, updatedLabel } from './feedCache';
import { buildOverview, buildSchedule, buildTasks, entryTimes, type BuildInput } from './ios/props';
import { iosWidgets } from './ios/widgets';
import { WIDGET_NAMES } from './names';

export { WIDGET_NAMES };

/**
 * Re-draws the iPhone widgets from whatever is currently in MMKV: a
 * timeline for each, one entry per moment it changes (`entryTimes`), every
 * entry built against its own clock. The extension never reads MMKV; it
 * steps through these entries until the app writes the next ones.
 */
export async function requestWidgetUpdate(): Promise<void> {
  const feed = readWidgetFeed();
  const slots = readSubjectSlots();
  const generated = feed ? Date.parse(feed.generatedAt) : Number.NaN;
  const staleAt = Number.isFinite(generated) ? generated + STALE_AFTER_MS : Number.POSITIVE_INFINITY;
  const updated = feed ? updatedLabel(feed) : '';
  const times = entryTimes(feed, new Date(), staleAt);
  const input = (now: Date): BuildInput => ({ feed, now, slots, updated, staleAt });

  const widgets = iosWidgets();
  const builders = { Today: buildSchedule, TasksExams: buildTasks, Overview: buildOverview } as const;
  for (const name of WIDGET_NAMES) {
    try {
      const build = builders[name];
      widgets[name].updateTimeline(times.map((date) => ({ date, props: build(input(date)) })));
    } catch {
      // One widget's failure (no layout yet, a full App Group) leaves the others drawn.
    }
  }
}
