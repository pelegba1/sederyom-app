import { WIDGET_NAMES } from './names';

// Every platform but Android and iOS (Metro picks `update.android.ts` and
// `update.ios.ts` there); this keeps both widget libraries out of the other
// bundles.
export { WIDGET_NAMES };

/** Nothing to re-render: there are no home-screen widgets on this platform. */
export async function requestWidgetUpdate(): Promise<void> {}
