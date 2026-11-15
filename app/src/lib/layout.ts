/**
 * The tab bar's geometry (plan §16.1), top to bottom: the bar's top padding,
 * the tab button's own padding (5 on each side, as bottom-tabs drew it before
 * the tabs could be swiped), the 30-point highlighter pill behind the icon, the gap,
 * the label's line, the button's padding again, then the bar's bottom
 * padding, which is at least the phone's navigation-bar inset.
 *
 * TabBar.tsx draws the bar from these numbers, so the measure and the drawing
 * agree; app/test/layout.test.cjs checks the content fits at every size.
 */
export const TAB_BAR = {
  paddingTop: 6,
  /** The tab button's padding, on each side: bottom-tabs' `tabVerticalUiKit`, kept. */
  itemPadding: 5,
  pill: { width: 56, height: 30 },
  /** Between the pill and the label. */
  gap: 4,
  /** The label: `type.caption` on an 18-point line, before any text scaling. */
  labelSize: 14,
  labelLine: 18,
  /** The least bottom padding, with no navigation bar under the app. */
  minPaddingBottom: 8,
  /** The in-app text size reaches the labels up to this factor: a 1.3 label does not fit five tabs. */
  maxAppScale: 1.15,
} as const;

/**
 * The factor the tab labels are drawn at: the phone's font scale (Android
 * scales the label's size and line with it) times the in-app text size,
 * capped at `TAB_BAR.maxAppScale`. TabBar.tsx sizes the bar with it, and the
 * toast floats above the bar it gives.
 */
export function tabBarScale(fontScale: number, appScale = 1): number {
  return fontScale * Math.min(Math.max(appScale, 1), TAB_BAR.maxAppScale);
}

/** The height a tab's content needs at `scale` (`tabBarScale`): the button's padding, the pill, the gap and the label's line. */
export function tabContentHeight(scale: number): number {
  const t = TAB_BAR;
  return 2 * t.itemPadding + t.pill.height + t.gap + t.labelLine * Math.max(scale, 1);
}

/**
 * Where the highlighter sits under tab `index`: the bar draws one pill,
 * anchored at the row's start edge (`insetInlineStart: 0`), and moves it by
 * this `translateX` as the pages slide. The tabs share the row equally and
 * the pill is centred in its tab. A transform is physical, so in a
 * right-to-left row, where the first tab is on the right, the pill moves left:
 * the shift is negative.
 */
export function tabPillShift(index: number, barWidth: number, count: number, direction: 'rtl' | 'ltr'): number {
  if (barWidth <= 0 || count <= 0) return 0;
  const tab = barWidth / count;
  const offset = index * tab + (tab - TAB_BAR.pill.width) / 2;
  return direction === 'rtl' ? -offset : offset;
}

/**
 * The tab under a finger on the bar, at `x` from the bar's left edge
 * (physical, as a gesture reports it): whole at a tab's middle, a fraction
 * between two, held at the end tabs. The highlighter follows it as the
 * finger drags along the bar, and the nearest whole tab is where it lands.
 */
export function tabAtPoint(x: number, barWidth: number, count: number, direction: 'rtl' | 'ltr'): number {
  if (barWidth <= 0 || count <= 1) return 0;
  const tab = barWidth / count;
  const fromStart = direction === 'rtl' ? barWidth - x : x;
  return Math.min(Math.max(fromStart / tab - 0.5, 0), count - 1);
}

/**
 * The tab bar's height and padding. Android's three-button bar consumes
 * ~48dp: it is ADDED under the content, never subtracted from a fixed bar.
 * The content area grows with the labels' line at `scale`, so a larger text
 * size never clips them.
 */
export function bottomBarLayout(bottomInset: number, scale: number): { height: number; paddingBottom: number; paddingTop: number } {
  const paddingBottom = Math.max(bottomInset, TAB_BAR.minPaddingBottom);
  const paddingTop = TAB_BAR.paddingTop;
  return { height: paddingTop + Math.ceil(tabContentHeight(scale)) + paddingBottom, paddingBottom, paddingTop };
}
