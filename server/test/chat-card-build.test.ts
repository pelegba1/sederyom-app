/**
 * The day card's page (chat day card plan, Task 2): one self-contained HTML document, built from
 * `server/src/chat/card/view.ts` by `scripts/build-day-card.mjs` and committed as `dayCard.generated.ts`.
 */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildDayCard, scriptSafe } from '../../scripts/build-day-card.mjs';
import { dark, light } from '../../app/src/theme';
import { DAY_CARD_HTML } from '../src/chat/card/dayCard.generated.js';

describe('the generated page', () => {
  it('is what the source builds to (run `npm run chat:card` when this fails)', async () => {
    expect(await buildDayCard()).toBe(DAY_CARD_HTML);
  });

  it('builds the same page every time', async () => {
    const [a, b] = [await buildDayCard(), await buildDayCard()];
    expect(a).toBe(b);
  });

  it('cannot close its script early, whatever the script holds', () => {
    expect(scriptSafe('a="</script>"; b=\'</SCRIPT >\'')).toBe('a="<\\/script>"; b=\'<\\/SCRIPT >\'');
    expect(scriptSafe('no tag here')).toBe('no tag here');
  });

  it('starts with <!doctype html>, and has dir="rtl" and lang="he"', () => {
    expect(DAY_CARD_HTML.startsWith('<!doctype html>')).toBe(true);
    expect(DAY_CARD_HTML).toContain('<html lang="he" dir="rtl">');
    expect(DAY_CARD_HTML).toContain('<meta charset="utf-8">');
    expect(DAY_CARD_HTML).toContain('name="viewport"');
  });

  it('holds the empty card the script fills, before the script', () => {
    expect(DAY_CARD_HTML).toContain('<div id="card"></div>');
    expect(DAY_CARD_HTML.indexOf('<div id="card"></div>')).toBeLessThan(DAY_CARD_HTML.indexOf('<script>'));
  });

  it('is one script, closed once', () => {
    expect(DAY_CARD_HTML.match(/<script/gi)).toHaveLength(1);
    expect(DAY_CARD_HTML.match(/<\/script/gi)).toHaveLength(1);
    expect(DAY_CARD_HTML.endsWith('</script></body></html>')).toBe(true);
  });

  it('asks for nothing outside', () => {
    for (const outside of ['http://', 'https://', 'fetch(', 'XMLHttpRequest', '<link', '@import', 'url(', 'src=', 'WebSocket', 'sendBeacon', 'importScripts']) {
      expect(DAY_CARD_HTML, outside).not.toContain(outside);
    }
  });

  it('holds both palettes', () => {
    for (const key of ['cancel', 'change', 'margin'] as const) {
      expect(DAY_CARD_HTML, `light.${key}`).toContain(light[key]);
      expect(DAY_CARD_HTML, `dark.${key}`).toContain(dark[key]);
    }
  });

  it('says nothing with an emoji or a check mark', () => {
    // the copy rules about dots and dashes are held by the markup test: this page also carries the
    // subject matcher's regular expressions, which name both characters
    expect(DAY_CARD_HTML).not.toContain('✓');
    expect(DAY_CARD_HTML).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('has no carriage return, so a clone with another line ending builds the same page', () => {
    expect(DAY_CARD_HTML).not.toContain('\r');
  });

  it('runs: the script in the page opens the handshake and draws a day, in a window of its own', () => {
    const script = DAY_CARD_HTML.slice(DAY_CARD_HTML.indexOf('<script>') + '<script>'.length, DAY_CARD_HTML.lastIndexOf('</script>'));
    const sent: { message: any; target: string }[] = [];
    const listeners: ((event: { source: unknown; data: unknown }) => void)[] = [];
    const styles: { textContent?: string }[] = [];
    const card = { innerHTML: '' };
    const root = { dataset: {} as Record<string, string>, getBoundingClientRect: () => ({ width: 320, height: 10 }) };
    const parent = { postMessage: (message: unknown, target: string) => { sent.push({ message, target }); } };
    const timers: number[] = [];
    const win = {
      parent,
      setTimeout: (_run: () => void, ms: number) => { timers.push(ms); },
      addEventListener: (_type: string, listener: (event: { source: unknown; data: unknown }) => void) => { listeners.push(listener); },
      document: {
        documentElement: root,
        head: { appendChild: () => {} },
        createElement: () => { const style = {}; styles.push(style); return style; },
        getElementById: (id: string) => (id === 'card' ? card : null),
      },
    };
    runInContext(script, createContext(win));

    expect(sent).toHaveLength(1);
    expect(sent[0]!.target).toBe('*');
    expect(sent[0]!.message).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'ui/initialize' });
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toContain(`--cancel:${light.cancel}`);
    expect(listeners).toHaveLength(1);
    // it will look at window.openai again a second on
    expect(timers).toEqual([1000]);

    listeners[0]!({ source: parent, data: { jsonrpc: '2.0', id: 1, result: { hostContext: { theme: 'dark' } } } });
    expect(root.dataset.theme).toBe('dark');
    const day = {
      date: '2026-11-10', found: true, weekdayName: 'יום שלישי', isSchoolDay: true, holidayName: null, projected: false, exams: [], events: [],
      lessons: [{ date: '2026-11-10', hourIndex: 1, subject: 'מתמטיקה', status: 'regular', startTime: null, endTime: null, teacher: null, room: null }],
      updatedAt: '2026-11-09T14:40:00Z', old: false,
    };
    listeners[0]!({ source: parent, data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [], structuredContent: day } } });
    expect(card.innerHTML).toContain('מתמטיקה');
  });

  it('stays small', () => {
    expect(DAY_CARD_HTML.length).toBeLessThan(40000);
  });
});
