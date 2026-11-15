import { requestWidgetUpdate as nativeRequestWidgetUpdate } from 'react-native-android-widget';
import { readWidgetFeed } from './feedCache';
import { WIDGET_NAMES } from './names';
import { renderWidgetFor } from '../../widget-task';

export { WIDGET_NAMES };

/** Re-renders every placed widget from whatever is currently in MMKV. */
export async function requestWidgetUpdate(): Promise<void> {
  const feed = readWidgetFeed();
  await Promise.all(
    WIDGET_NAMES.map((widgetName) =>
      nativeRequestWidgetUpdate({
        widgetName,
        // Called once per placed copy, with its own id and size — the
        // schedule widget reads its paging cursor by that id.
        renderWidget: (info) => renderWidgetFor(info, feed),
        widgetNotFound: () => {},
      }),
    ),
  );
}
