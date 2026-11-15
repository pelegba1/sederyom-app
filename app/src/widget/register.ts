// Every platform but Android and iOS (Metro picks `register.android.ts` and
// `register.ios.ts` there); this keeps both widget libraries out of the
// other bundles.
export function registerWidgets(): void {}
