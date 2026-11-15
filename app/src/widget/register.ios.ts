import { iosWidgets } from './ios/widgets';
import { requestWidgetUpdate } from './update';

/**
 * iOS: hands the extension the three layouts (a timeline is refused before
 * them), then draws from whatever feed the app last kept — so a widget
 * placed before the first refresh shows the last known day, not a blank.
 */
export function registerWidgets(): void {
  try {
    iosWidgets();
  } catch {
    // An app built without the widget extension (an old dev client): nothing to draw on.
    return;
  }
  void requestWidgetUpdate();
}
