/**
 * The widget never touches the network (design-doc §4). The app fetches
 * `/widget-feed`, stores it in MMKV, and the widget renders from MMKV — which
 * is also readable from the headless task that runs on the widget's own
 * periodic update.
 */
import { createMMKV } from 'react-native-mmkv';
import type { WidgetFeed } from '@sederyom/shared';
import type { DayCursor } from './model';

export const storage = createMMKV({ id: 'sederyom' });

const FEED_KEY = 'widget.feed';

/** Anything older than this renders its footer in the warning colour. */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export function cacheWidgetFeed(feed: WidgetFeed): void {
  storage.set(FEED_KEY, JSON.stringify(feed));
}

export function readWidgetFeed(): WidgetFeed | null {
  const raw = storage.getString(FEED_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WidgetFeed;
  } catch {
    return null;
  }
}

/**
 * Where each schedule widget is paged to, by Android widget id — two copies of
 * the widget on two home screens page independently. Stored with the feed
 * date it was chosen against, so a stale cursor resets to today by itself.
 */
const CURSOR_PREFIX = 'widget.cursor.';

export function readDayCursor(widgetId: number): DayCursor | null {
  const raw = storage.getString(`${CURSOR_PREFIX}${widgetId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DayCursor>;
    if (typeof parsed.date !== 'string' || typeof parsed.offset !== 'number') return null;
    return { date: parsed.date, offset: parsed.offset };
  } catch {
    return null;
  }
}

export function writeDayCursor(widgetId: number, cursor: DayCursor): void {
  storage.set(`${CURSOR_PREFIX}${widgetId}`, JSON.stringify(cursor));
}

export function clearDayCursor(widgetId: number): void {
  storage.remove(`${CURSOR_PREFIX}${widgetId}`);
}

export function feedAgeMs(feed: WidgetFeed, now: number = Date.now()): number {
  const generated = Date.parse(feed.generatedAt);
  return Number.isFinite(generated) ? now - generated : Number.POSITIVE_INFINITY;
}

export function isStale(feed: WidgetFeed, now: number = Date.now()): boolean {
  return feedAgeMs(feed, now) > STALE_AFTER_MS;
}

/** "עודכן 07:42" — always shown, never faked. */
export function updatedLabel(feed: WidgetFeed): string {
  const at = new Date(feed.generatedAt);
  if (Number.isNaN(at.getTime())) return 'עודכן —';
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `עודכן ${hh}:${mm}`;
}
