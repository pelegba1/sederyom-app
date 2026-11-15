/**
 * Push text in a right-to-left notification: every numeric range is pinned
 * left-to-right with the isolate pair, so "08:00–10:30" never shows as
 * "10:30–08:00" in the drawer or in the bell.
 */
import { describe, expect, it } from 'vitest';
import type { PushPayload } from '@sederyom/shared';
import { isolatePush, isolateRanges } from '../src/notify/text.js';

const LRI = '⁦';
const PDI = '⁩';
const pinned = (run: string) => `${LRI}${run}${PDI}`;

describe('isolateRanges', () => {
  it('wraps clock and number ranges', () => {
    expect(isolateRanges('08:00–10:30 · פיזיקה')).toBe(`${pinned('08:00–10:30')} · פיזיקה`);
    expect(isolateRanges('היסטוריה: שאלות 1–5')).toBe(`היסטוריה: שאלות ${pinned('1–5')}`);
    expect(isolateRanges('פרקים 3-4 ו־7 - 9')).toBe(`פרקים ${pinned('3-4')} ו־${pinned('7 - 9')}`);
    expect(isolateRanges('שבוע 18–23.10')).toBe(`שבוע ${pinned('18–23.10')}`);
  });

  it('leaves single numbers, times and dates alone', () => {
    for (const text of ['נגמר ב־10:30 · 4 בוטלו', 'מבחן חדש · יום א׳ 1.11', 'שיעור 7 היסטוריה מבוטל']) {
      expect(isolateRanges(text)).toBe(text);
    }
  });

  it('wraps every range in a line, and changes nothing the second time', () => {
    const once = isolateRanges('08:00–10:30 · שאלות 1–5');
    expect(once).toBe(`${pinned('08:00–10:30')} · שאלות ${pinned('1–5')}`);
    expect(isolateRanges(once)).toBe(once);
  });

  it('leaves a run already isolated and still wraps the rest', () => {
    expect(isolateRanges(`${pinned('1–5')} ואז 6–8`)).toBe(`${pinned('1–5')} ואז ${pinned('6–8')}`);
  });
});

describe('isolatePush', () => {
  it('pins the title and the body, and keeps the payload', () => {
    const payload: PushPayload = { type: 'morning_summary', deepLink: 'today', date: '2026-10-08', refreshWidget: true };
    expect(isolatePush({ title: '08:00–14:10 · 7 שיעורים', body: 'שאלות 10–14', payload })).toEqual({
      title: `${pinned('08:00–14:10')} · 7 שיעורים`,
      body: `שאלות ${pinned('10–14')}`,
      payload,
    });
  });
});
