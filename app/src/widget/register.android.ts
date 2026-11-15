import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from '../../widget-task';

/** Android starts the JS headless to refresh a widget; this is who answers. */
export function registerWidgets(): void {
  registerWidgetTaskHandler(widgetTaskHandler);
}
