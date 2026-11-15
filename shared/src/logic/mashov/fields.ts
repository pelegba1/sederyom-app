/** Field readers shared by the Mashov normalizers. */

/** Accepts "08:00", "8:00", "0800" and full ISO datetimes. */
export function clockTime(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() || null : typeof value === 'number' ? String(value) : null;
  if (!raw) return null;
  const hhmm = /(\d{1,2}):(\d{2})/.exec(raw);
  if (hhmm) return `${hhmm[1]!.padStart(2, '0')}:${hhmm[2]}`;
  const compact = /^(\d{2})(\d{2})$/.exec(raw.trim());
  if (compact) return `${compact[1]}:${compact[2]}`;
  return null;
}
