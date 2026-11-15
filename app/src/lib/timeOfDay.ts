/**
 * Wall-clock times as the settings store them: `HH:mm`, 00:00–23:59. The
 * pattern is the server's own (`PUT /settings` answers 400 on anything else),
 * so nothing the app lets through is refused there.
 *
 * Pure, and free of runtime imports, so app/test can load it as is.
 */

/** The exact check `PUT /settings` runs on quiet hours and both reminder times. */
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(value: string): boolean {
  return TIME_OF_DAY.test(value);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `HH:mm` from an hour and a minute; `null` when either is out of range. */
export function joinTime(hour: number, minute: number): string | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

/** `"07:30"` → `{ hour: 7, minute: 30 }`; `null` for anything that is not a valid `HH:mm`. */
export function splitTime(value: string): { hour: number; minute: number } | null {
  if (!isValidTime(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return { hour: h ?? 0, minute: m ?? 0 };
}

/**
 * What a person types, as `HH:mm`: "7" → "07:00", "7:30" / "7.30" → "07:30",
 * "730" / "0730" → "07:30". `null` when it is not a time of day ("24:00",
 * "7:60", "abc").
 */
export function normalizeTime(input: string): string | null {
  const text = input.trim().replace(/[.\s]/g, ':');
  let m = /^(\d{1,2})$/.exec(text);
  if (m) return joinTime(Number(m[1]), 0);
  m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (m) return joinTime(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})(\d{2})$/.exec(text);
  if (m) return joinTime(Number(m[1]), Number(m[2]));
  return null;
}

/**
 * The minutes a picker offers: every `step` minutes from 0, plus `current`
 * when it falls between steps — so a stored "07:42" is still shown as chosen.
 */
export function minuteOptions(current: number | null, step = 5): number[] {
  const out: number[] = [];
  for (let m = 0; m < 60; m += step) out.push(m);
  if (current !== null && current >= 0 && current < 60 && !out.includes(current)) {
    out.push(current);
    out.sort((a, b) => a - b);
  }
  return out;
}

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Whether `time` falls inside quiet hours `from`–`to` (start inclusive, end
 * exclusive, may wrap past midnight). Mirrors the server's
 * `isSuppressedByQuietHours`: equal ends mean no quiet hours at all.
 */
export function isWithinQuietHours(time: string, from: string, to: string): boolean {
  const t = toMinutes(time);
  const a = toMinutes(from);
  const b = toMinutes(to);
  return a <= b ? t >= a && t < b : t >= a || t < b;
}
