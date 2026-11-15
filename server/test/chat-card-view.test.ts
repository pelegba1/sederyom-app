/**
 * The day card's page script (chat day card plan, Task 2): the only code that touches the window,
 * run here over a hand-made window, since the server has no DOM.
 */
import { describe, expect, it } from 'vitest';
import { dark, light } from '../../app/src/theme';
import { cardCss } from '../src/chat/card/styles.js';
import { startView, type FrameWindow } from '../src/chat/card/view.js';

const DAY = {
  date: '2026-11-10', found: true, weekdayName: 'יום שלישי', isSchoolDay: true, holidayName: null, projected: false, exams: [], events: [],
  lessons: [{
    date: '2026-11-10', hourIndex: 1, startTime: '08:00', endTime: '08:45', subject: 'מתמטיקה', teacher: 'כהן', room: '12',
    status: 'regular', substitute: null, note: null, source: 'shahaf', changeSeenAt: null,
  }],
  updatedAt: '2026-11-09T14:40:00Z', old: false,
};

type Listener = (event: { source: unknown; data: unknown }) => void;

function fakeWindow(options: { card?: boolean; observer?: boolean; timer?: boolean; openai?: unknown } = {}) {
  const sent: { message: any; target: string }[] = [];
  const parent = { postMessage: (message: unknown, target: string) => { sent.push({ message, target }); } };
  const card = { innerHTML: '' };
  const styles: { textContent: string }[] = [];
  const appended: unknown[] = [];
  const listeners: Listener[] = [];
  const root = { dataset: {} as Record<string, string | undefined>, size: { width: 320, height: 40 }, getBoundingClientRect() { return this.size; } };
  const observed: unknown[] = [];
  const watcher = { fire: () => {} };
  const timers: { run: () => void; ms: number }[] = [];
  class FakeObserver {
    constructor(callback: () => void) { watcher.fire = callback; }
    observe(target: unknown) { observed.push(target); }
  }
  const win: FrameWindow = {
    parent,
    addEventListener: (_type, listener) => { listeners.push(listener); },
    document: {
      documentElement: root,
      head: { appendChild: (node) => { appended.push(node); return node; } },
      createElement: () => { const style = { textContent: '' }; styles.push(style); return style; },
      getElementById: (id) => (id === 'card' && options.card !== false ? card : null),
    },
    ...(options.observer === false ? {} : { ResizeObserver: FakeObserver }),
    ...(options.timer === false ? {} : { setTimeout: (run: () => void, ms: number) => { timers.push({ run, ms }); return timers.length; } }),
    ...(options.openai === undefined ? {} : { openai: { toolOutput: options.openai } }),
  };
  /** Lets the time pass: runs what the page scheduled. */
  const tick = () => { for (const timer of timers.splice(0)) timer.run(); };
  /** A message from `source`, as the window gets it. */
  const receive = (data: unknown, source: unknown = parent) => { for (const listener of listeners) listener({ source, data }); };
  return { win, parent, sent, card, styles, appended, root, observed, watcher, listeners, timers, tick, receive };
}

const answer = (hostContext?: object) => ({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2026-01-26', ...(hostContext ? { hostContext } : {}) } });
const toolResult = (structuredContent: unknown) => ({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [], structuredContent } });

describe('startView', () => {
  it("adds the card's styles in a style element, from the app's palettes", () => {
    const { win, styles, appended } = fakeWindow();
    startView(win);
    expect(styles).toHaveLength(1);
    expect(appended).toEqual(styles);
    expect(styles[0]!.textContent).toBe(cardCss(light, dark));
  });

  it('opens the handshake with the parent, to any origin', () => {
    const { win, sent, listeners } = fakeWindow();
    startView(win);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.target).toBe('*');
    expect(sent[0]!.message).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'ui/initialize' });
    expect(listeners).toHaveLength(1);
  });

  it('sets the theme the host names, and draws the tool result in the card', () => {
    const { win, sent, root, card, receive } = fakeWindow();
    startView(win);
    receive(answer({ theme: 'dark' }));
    expect(root.dataset.theme).toBe('dark');
    expect(sent.map((s) => s.message.method)).toEqual(['ui/initialize', 'ui/notifications/initialized']);
    receive(toolResult(DAY));
    expect(card.innerHTML).toContain('מתמטיקה');
    receive({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'light' } });
    expect(root.dataset.theme).toBe('light');
  });

  it('sets no theme before the host names one, so the device decides', () => {
    const { win, root } = fakeWindow();
    startView(win);
    expect(root.dataset.theme).toBeUndefined();
  });

  it('takes light when the host names none', () => {
    const { win, root, receive } = fakeWindow();
    startView(win);
    receive(answer());
    expect(root.dataset.theme).toBe('light');
  });

  it('takes only what the parent window sent', () => {
    const { win, sent, card, root, receive } = fakeWindow();
    startView(win);
    receive(answer({ theme: 'dark' }), { postMessage: () => {} });
    receive(answer({ theme: 'dark' }), null);
    receive(toolResult(DAY), 'the parent, said the message');
    expect(sent).toHaveLength(1);
    expect(card.innerHTML).toBe('');
    expect(root.dataset.theme).toBeUndefined();
  });

  it("draws window.openai's output at once, from a host that never answers", () => {
    const { win, card } = fakeWindow({ openai: DAY });
    startView(win);
    expect(card.innerHTML).toContain('מתמטיקה');
  });

  it("reads window.openai again a second after the start, with the window's own timer", () => {
    const { win, card, timers, tick } = fakeWindow();
    startView(win);
    expect(timers.map((t) => t.ms)).toEqual([1000]);
    expect(card.innerHTML).toBe('');
    win.openai = { toolOutput: DAY };
    tick();
    expect(card.innerHTML).toContain('מתמטיקה');
  });

  it('does not let that read overwrite a tool result', () => {
    const { win, card, receive, tick } = fakeWindow();
    startView(win);
    receive(answer());
    receive(toolResult(DAY));
    win.openai = { toolOutput: { ...DAY, lessons: [{ ...DAY.lessons[0]!, subject: 'פיזיקה' }] } };
    tick();
    expect(card.innerHTML).toContain('מתמטיקה');
    expect(card.innerHTML).not.toContain('פיזיקה');
  });

  it('draws what the window has, in a window with no timer', () => {
    const { win, card } = fakeWindow({ timer: false, openai: DAY });
    expect(() => startView(win)).not.toThrow();
    expect(card.innerHTML).toContain('מתמטיקה');
  });

  it('reports its size to the host, when it changes', () => {
    const { win, sent, root, observed, watcher } = fakeWindow();
    startView(win);
    expect(observed).toEqual([root]);
    watcher.fire();
    const sizes = () => sent.filter((s) => s.message.method === 'ui/notifications/size-changed');
    expect(sizes()).toHaveLength(1);
    expect(sizes()[0]!.target).toBe('*');
    expect(sizes()[0]!.message).toEqual({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 320, height: 40 } });
    watcher.fire();
    expect(sizes()).toHaveLength(1);
    root.size = { width: 320, height: 212.4 };
    watcher.fire();
    expect(sizes()).toHaveLength(2);
    expect(sizes()[1]!.message.params).toEqual({ width: 320, height: 213 });
  });

  it('does not report a height of 0, which is the page before anything is drawn', () => {
    const { win, sent, root, watcher } = fakeWindow();
    root.size = { width: 320, height: 0 };
    startView(win);
    const sizes = () => sent.filter((s) => s.message.method === 'ui/notifications/size-changed');
    watcher.fire();
    expect(sizes()).toHaveLength(0);
    // the card is drawn: the first report is the real one
    root.size = { width: 320, height: 187.2 };
    watcher.fire();
    expect(sizes()).toHaveLength(1);
    expect(sizes()[0]!.message.params).toEqual({ width: 320, height: 188 });
    // a 0 later is skipped too, and the same size after it is not told twice
    root.size = { width: 320, height: 0 };
    watcher.fire();
    root.size = { width: 320, height: 187.2 };
    watcher.fire();
    expect(sizes()).toHaveLength(1);
  });

  it('works in a frame that cannot observe sizes', () => {
    const { win, sent, card, receive } = fakeWindow({ observer: false });
    expect(() => startView(win)).not.toThrow();
    receive(answer());
    receive(toolResult(DAY));
    expect(card.innerHTML).toContain('מתמטיקה');
    expect(sent.filter((s) => s.message.method === 'ui/notifications/size-changed')).toHaveLength(0);
  });

  it('does nothing in a page that has no card, or no parent', () => {
    const noCard = fakeWindow({ card: false });
    expect(() => startView(noCard.win)).not.toThrow();
    expect(noCard.sent).toEqual([]);
    expect(noCard.listeners).toEqual([]);
    const lonely = fakeWindow();
    expect(() => startView({ ...lonely.win, parent: undefined } as unknown as FrameWindow)).not.toThrow();
    expect(() => startView({} as FrameWindow)).not.toThrow();
  });
});
