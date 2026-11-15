/**
 * Headless widget task — trigger 1 of the three refresh paths (design-doc §4).
 * Android runs this on the widget's own update period (~30 min minimum), with
 * the app closed. It fetches the feed, writes MMKV and renders from it.
 *
 * It also answers taps: the schedule widget's day paging is a `WIDGET_CLICK`
 * with one of the `CLICK` actions, moves that widget's cursor in MMKV and
 * re-renders from the cached feed — no network on a tap.
 */
import React from 'react';
import type { WidgetInfo, WidgetRepresentation, WidgetTaskHandlerProps } from 'react-native-android-widget';
import type { WidgetFeed } from '@sederyom/shared';
import { cacheWidgetFeed, clearDayCursor, readDayCursor, readWidgetFeed, writeDayCursor } from './src/widget/feedCache';
import { backgroundRefresh } from './src/background/refresh';
import { loadLocalSources } from './src/local/source';
import { localWidgetFeed } from './src/local/views';
import { stepCursor } from './src/widget/model';
import { CLICK, OverviewWidget, ScheduleWidget, TasksWidget, type Scheme } from './src/widget/widgets';

/** Every widget, by the provider name in `app.json`. */
export function renderWidgetFor(info: WidgetInfo, feed: WidgetFeed | null): WidgetRepresentation {
  const height = info.height;
  const render = (scheme: Scheme): React.JSX.Element => {
    switch (info.widgetName) {
      case 'TasksExams':
        return <TasksWidget feed={feed} scheme={scheme} heightDp={height} />;
      case 'Overview':
        return <OverviewWidget feed={feed} scheme={scheme} heightDp={height} />;
      case 'Today':
      default:
        return <ScheduleWidget feed={feed} scheme={scheme} heightDp={height} cursor={readDayCursor(info.widgetId)} />;
    }
  };
  return { light: render('light'), dark: render('dark') };
}

const STEP: Record<string, number> = {
  [CLICK.prev]: -1,
  [CLICK.next]: 1,
  [CLICK.today]: 0,
};

/**
 * The feed for a periodic update, built from what the phone keeps (plan
 * Phase 2e). The widget's periodic update is a second way to refresh with
 * the app closed: the same refresh the background task runs, the class feed
 * included, so a change on the site reaches the widget without opening the app.
 */
async function nextFeed(): Promise<WidgetFeed> {
  await backgroundRefresh('widget');
  return localWidgetFeed(loadLocalSources());
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const { widgetInfo } = props;

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      // Render the cached feed first so the widget never blanks while fetching.
      props.renderWidget(renderWidgetFor(widgetInfo, readWidgetFeed()));
      try {
        const feed = await nextFeed();
        cacheWidgetFeed(feed);
        props.renderWidget(renderWidgetFor(widgetInfo, feed));
      } catch {
        // Keep the cached render; its footer already says how old it is.
      }
      break;
    }
    case 'WIDGET_CLICK': {
      const delta = props.clickAction !== undefined ? STEP[props.clickAction] : undefined;
      const feed = readWidgetFeed();
      if (delta === undefined || !feed) break;
      writeDayCursor(widgetInfo.widgetId, stepCursor(feed, readDayCursor(widgetInfo.widgetId), delta));
      props.renderWidget(renderWidgetFor(widgetInfo, feed));
      break;
    }
    case 'WIDGET_DELETED':
      clearDayCursor(widgetInfo.widgetId);
      break;
    default:
      break;
  }
}
