/**
 * The bell's badge (plan W5-F): notifications that arrived since the log was
 * last opened. Pure, so it is tested without a phone; the hooks in
 * `api/hooks.ts` feed it the log and the saved "seen" time.
 */

/** How many of `items` were sent after `seenAt` (an ISO instant). */
export function countUnread(items: readonly { sentAt: string }[], seenAt: string): number {
  const seen = Date.parse(seenAt);
  if (Number.isNaN(seen)) return 0;
  return items.filter((item) => Date.parse(item.sentAt) > seen).length;
}

/** The badge's text: the count, or "9+" past nine; `null` when there is nothing new. */
export function unreadBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}

/** The bell's spoken label: "יומן התראות", or with what is new. */
export function bellLabel(count: number): string {
  if (count <= 0) return 'יומן התראות';
  return count === 1 ? 'יומן התראות, התראה חדשה אחת' : `יומן התראות, ${count} התראות חדשות`;
}
