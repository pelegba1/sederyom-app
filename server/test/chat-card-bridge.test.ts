/**
 * The day card's handshake with the chat (chat day card plan, Task 2): the MCP Apps wire format of
 * 2026-01-26 over a fake host that records what the page asks of the window. No window here.
 */
import { describe, expect, it } from 'vitest';
import { cardBody, sizeNotification, startCardBridge, type CardHost } from '../src/chat/card/bridge.js';
import type { DayCardData } from '../src/chat/card/markup.js';

const NOW = new Date('2026-11-09T18:00:00Z');

const DAY: DayCardData = {
  date: '2026-11-10',
  found: true,
  weekdayName: 'יום שלישי',
  isSchoolDay: true,
  holidayName: null,
  projected: false,
  exams: [],
  lessons: [{
    date: '2026-11-10', hourIndex: 1, startTime: '08:00', endTime: '08:45', subject: 'מתמטיקה', teacher: 'כהן', room: '12',
    status: 'regular', substitute: null, note: null, source: 'shahaf', changeSeenAt: null,
  }],
  events: [],
  updatedAt: '2026-11-09T14:40:00Z',
  old: false,
};
const OTHER_DAY: DayCardData = { ...DAY, lessons: [{ ...DAY.lessons[0]!, subject: 'פיזיקה' }] };

const text = (t: string) => ({ type: 'text', text: t });

/** A host that records every call, with the window's tool output set per test and its own clock for `later`. */
function setup(openai: unknown = undefined) {
  const state = { openai, reads: 0 };
  const posted: any[] = [];
  const shown: string[] = [];
  const themes: string[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  const host: CardHost = {
    post: (message) => { posted.push(message); },
    show: (html) => { shown.push(html); },
    theme: (name) => { themes.push(name); },
    now: () => NOW,
    openaiOutput: () => { state.reads += 1; return state.openai; },
    later: (run, ms) => { timers.push({ run, ms }); },
  };
  const bridge = startCardBridge(host);
  /** Lets the time pass: runs what was scheduled. */
  const tick = () => { for (const timer of timers.splice(0)) timer.run(); };
  return { bridge, posted, shown, themes, state, timers, tick };
}

/** The host's answer to `ui/initialize`. */
const answer = (hostContext?: unknown) => ({
  jsonrpc: '2.0', id: 1,
  result: { protocolVersion: '2026-01-26', hostInfo: { name: 'test', version: '1' }, hostCapabilities: {}, ...(hostContext === undefined ? {} : { hostContext }) },
});
const notification = (method: string, params?: unknown) => ({ jsonrpc: '2.0', method, params });
const toolResult = (structuredContent: unknown, extra: object = {}) => notification('ui/notifications/tool-result', { content: [text('x')], structuredContent, ...extra });

describe('the handshake', () => {
  it('sends ui/initialize once, with the protocol version', () => {
    const { bridge, posted } = setup();
    expect(posted).toEqual([{
      jsonrpc: '2.0', id: 1, method: 'ui/initialize',
      params: { protocolVersion: '2026-01-26', appInfo: { name: 'sederyom-day-card', version: '1.0.0' }, appCapabilities: {} },
    }]);
    bridge.handle(answer({ theme: 'dark' }));
    bridge.handle(toolResult(DAY));
    expect(posted.filter((m) => m.method === 'ui/initialize')).toHaveLength(1);
  });

  it('sends initialized only after the host answers', () => {
    const { bridge, posted } = setup();
    expect(posted.map((m) => m.method)).toEqual(['ui/initialize']);
    bridge.handle(answer({ theme: 'light' }));
    expect(posted.map((m) => m.method)).toEqual(['ui/initialize', 'ui/notifications/initialized']);
    expect(posted[1]).toMatchObject({ jsonrpc: '2.0' });
    expect(posted[1]).not.toHaveProperty('id');
  });

  it('sends initialized once, however many times the answer comes', () => {
    const { bridge, posted } = setup();
    bridge.handle(answer());
    bridge.handle(answer());
    expect(posted.filter((m) => m.method === 'ui/notifications/initialized')).toHaveLength(1);
  });

  it('takes no answer for another request as the answer', () => {
    const { bridge, posted, themes } = setup();
    bridge.handle({ jsonrpc: '2.0', id: 2, result: { hostContext: { theme: 'dark' } } });
    expect(posted).toHaveLength(1);
    expect(themes).toEqual([]);
  });

  it('takes the theme from the answer, and from host-context-changed', () => {
    const { bridge, themes } = setup();
    bridge.handle(answer({ theme: 'dark' }));
    expect(themes).toEqual(['dark']);
    bridge.handle(notification('ui/notifications/host-context-changed', { theme: 'light' }));
    expect(themes).toEqual(['dark', 'light']);
  });

  it('leaves the theme alone when a partial context holds none, or a theme it does not know', () => {
    const { bridge, themes } = setup();
    bridge.handle(answer({ theme: 'dark' }));
    bridge.handle(notification('ui/notifications/host-context-changed', { displayMode: 'inline' }));
    bridge.handle(notification('ui/notifications/host-context-changed', { theme: 'sepia' }));
    bridge.handle(notification('ui/notifications/host-context-changed'));
    expect(themes).toEqual(['dark']);
  });

  it('stays light when the host names no theme', () => {
    for (const context of [undefined, {}, { theme: 'sepia' }, { theme: 5 }, null]) {
      const { bridge, themes } = setup();
      bridge.handle(answer(context));
      expect(themes).toEqual(['light']);
    }
  });

  it('sends neither initialized nor a theme when the host refuses to initialize, but still draws window.openai', () => {
    const { bridge, posted, shown, themes } = setup(DAY);
    bridge.handle({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no' } });
    expect(posted.map((m) => m.method)).toEqual(['ui/initialize']);
    expect(themes).toEqual([]);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('מתמטיקה');
  });

  it('shows nothing when the host refuses to initialize and the window has no output', () => {
    const { bridge, shown } = setup();
    bridge.handle({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no' } });
    expect(shown).toEqual([]);
  });
});

describe('drawing a result', () => {
  it('draws a tool-result with a day', () => {
    const { bridge, shown } = setup();
    bridge.handle(answer());
    bridge.handle(toolResult(DAY));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('מתמטיקה');
    expect(shown[0]).toContain('מחר, יום שלישי 10.11');
  });

  it('draws a tool-result that arrives before the answer', () => {
    const { bridge, shown } = setup();
    bridge.handle(toolResult(DAY));
    expect(shown[0]).toContain('מתמטיקה');
  });

  it('draws the text of a result with no day', () => {
    const results = [
      { content: [text('אין לי את 5.11.')], structuredContent: { found: false } },
      { content: [text('אין לי את 5.11.')], structuredContent: { status: 'no_copy' } },
      { content: [text('אין לי את 5.11.')], isError: true },
      { content: [text('אין לי את 5.11.')] },
    ];
    for (const params of results) {
      const { bridge, shown } = setup();
      bridge.handle(answer());
      bridge.handle(notification('ui/notifications/tool-result', params));
      expect(shown).toEqual(['<div class="plain">אין לי את 5.11.</div>']);
    }
  });

  it('draws the text of an error even when it carries a day', () => {
    const { bridge, shown } = setup();
    bridge.handle(notification('ui/notifications/tool-result', { content: [text('משהו השתבש')], structuredContent: DAY, isError: true }));
    expect(shown).toEqual(['<div class="plain">משהו השתבש</div>']);
  });

  it('joins the text parts, skips the ones that are not text, and escapes them', () => {
    const { bridge, shown } = setup();
    bridge.handle(notification('ui/notifications/tool-result', {
      content: [text('שורה א'), { type: 'image', data: 'x' }, text('<b>שורה ב</b>'), null, { type: 'text', text: 5 }, text('   ')],
    }));
    expect(shown).toEqual(['<div class="plain">שורה א<br>&lt;b&gt;שורה ב&lt;/b&gt;</div>']);
  });

  it('shows nothing for a result with neither', () => {
    const results = [{}, { content: [] }, { content: 'x' }, { structuredContent: { found: false } }, { content: [text('')] }, { isError: true }, null, 5, 'x', []];
    for (const params of results) {
      const { bridge, shown } = setup();
      bridge.handle(answer());
      bridge.handle(notification('ui/notifications/tool-result', params));
      expect(shown).toEqual([]);
    }
  });

  it('a later tool-result replaces it', () => {
    const { bridge, shown } = setup();
    bridge.handle(answer());
    bridge.handle(toolResult(DAY));
    bridge.handle(toolResult(OTHER_DAY));
    expect(shown).toHaveLength(2);
    expect(shown[0]).toContain('מתמטיקה');
    expect(shown[1]).toContain('פיזיקה');
    expect(shown[1]).not.toContain('מתמטיקה');
  });

  it('draws the text a tool puts in its structured content, after the text of content', () => {
    const { bridge, shown } = setup();
    bridge.handle(notification('ui/notifications/tool-result', { content: [], structuredContent: { found: false, text: 'אין לי את 5.11.' } }));
    bridge.handle(notification('ui/notifications/tool-result', { content: [text('מהתוכן')], structuredContent: { found: false, text: 'מהמבנה' } }));
    expect(shown).toEqual(['<div class="plain">אין לי את 5.11.</div>', '<div class="plain">מהתוכן</div>']);
  });

  it('ignores tool-input', () => {
    const { bridge, shown } = setup();
    bridge.handle(answer());
    bridge.handle(notification('ui/notifications/tool-input', { arguments: { date: '2026-11-10' } }));
    expect(shown).toEqual([]);
  });
});

describe("reading window.openai's output", () => {
  it('draws it at start, from a host that never answers', () => {
    const { shown } = setup(DAY);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('מתמטיקה');
  });

  it('asks the host for one more read, a second after the start', () => {
    const { timers } = setup();
    expect(timers.map((t) => t.ms)).toEqual([1000]);
  });

  it('draws output that appears only at the later read', () => {
    const { shown, state, tick } = setup();
    expect(shown).toEqual([]);
    state.openai = DAY;
    tick();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('מתמטיקה');
  });

  it('draws output that appears by the end of the handshake', () => {
    const { bridge, shown, state } = setup();
    state.openai = DAY;
    bridge.handle(answer({ theme: 'dark' }));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('מתמטיקה');
  });

  it('draws it when the host refuses the handshake, and when the answer comes late', () => {
    const refused = setup(DAY);
    refused.bridge.handle({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no' } });
    expect(refused.shown).toHaveLength(1);
    const late = setup();
    late.tick();
    late.state.openai = OTHER_DAY;
    late.bridge.handle(answer());
    expect(late.shown).toHaveLength(1);
    expect(late.shown[0]).toContain('פיזיקה');
  });

  it('reads at the end of the handshake after initialized has gone out', () => {
    const order: string[] = [];
    const bridge = startCardBridge({
      post: (m: any) => { order.push(m.method); },
      show: () => { order.push('show'); },
      theme: () => { order.push('theme'); },
      now: () => NOW,
      openaiOutput: () => { order.push('openai'); return undefined; },
      later: () => { order.push('later'); },
    });
    expect(order).toEqual(['ui/initialize', 'openai', 'later']);
    bridge.handle(answer({ theme: 'dark' }));
    expect(order).toEqual(['ui/initialize', 'openai', 'later', 'theme', 'ui/notifications/initialized', 'openai']);
  });

  it('draws the text of an output that has no day: { found: false, text }', () => {
    const { shown } = setup({ found: false, text: 'אין לי את 5.11.' });
    expect(shown).toEqual(['<div class="plain">אין לי את 5.11.</div>']);
  });

  it('draws the same output once, however many times it reads it', () => {
    const { bridge, shown, state, tick } = setup(DAY);
    bridge.handle(answer());
    tick();
    expect(state.reads).toBe(3);
    expect(shown).toHaveLength(1);
  });

  it('replaces what it drew when the output changes', () => {
    const { shown, state, tick } = setup(DAY);
    state.openai = OTHER_DAY;
    tick();
    expect(shown).toHaveLength(2);
    expect(shown[1]).toContain('פיזיקה');
  });

  it('is replaced by a tool-result', () => {
    const { bridge, shown } = setup(DAY);
    bridge.handle(answer());
    bridge.handle(toolResult(OTHER_DAY));
    expect(shown).toHaveLength(2);
    expect(shown[1]).toContain('פיזיקה');
  });

  it('does not overwrite a tool-result, at the end of the handshake or at the later read', () => {
    const { bridge, shown, state, tick } = setup();
    bridge.handle(toolResult(DAY));
    state.openai = OTHER_DAY;
    const reads = state.reads;
    bridge.handle(answer());
    tick();
    expect(state.reads).toBe(reads);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('מתמטיקה');
  });

  it('does not stop reading for a tool-result with nothing to show', () => {
    const { bridge, shown, state, tick } = setup();
    for (const params of [{}, { content: [] }, { structuredContent: { found: false } }, { content: [text('  ')] }, null]) {
      bridge.handle(notification('ui/notifications/tool-result', params));
    }
    expect(shown).toEqual([]);
    state.openai = DAY;
    tick();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('מתמטיקה');
  });

  it('shows nothing when the output is none, or is not a day and has no text', () => {
    for (const output of [undefined, null, {}, { found: false }, { status: 'no_copy' }, { text: '' }, { text: 5 }, 'x', 5, []]) {
      const { bridge, shown, tick } = setup(output);
      bridge.handle(answer());
      tick();
      expect(shown).toEqual([]);
    }
  });

  it('survives window.openai throwing, at start and later', () => {
    const throwing: CardHost = {
      post: () => {}, show: () => {}, theme: () => {}, now: () => NOW,
      openaiOutput: () => { throw new Error('boom'); },
      later: (run) => { run(); },
    };
    let bridge: ReturnType<typeof startCardBridge> | undefined;
    expect(() => { bridge = startCardBridge(throwing); }).not.toThrow();
    expect(() => bridge!.handle(answer())).not.toThrow();
  });

  it('survives a host with no timer', () => {
    const noTimer: CardHost = {
      post: () => {}, show: () => {}, theme: () => {}, now: () => NOW, openaiOutput: () => DAY,
      later: () => { throw new Error('no timer'); },
    };
    expect(() => startCardBridge(noTimer)).not.toThrow();
  });
});

describe('answering the host', () => {
  it('answers ui/resource-teardown and ping with the same id', () => {
    const { bridge, posted } = setup();
    bridge.handle({ jsonrpc: '2.0', id: 7, method: 'ui/resource-teardown', params: { reason: 'x' } });
    bridge.handle({ jsonrpc: '2.0', id: 'abc', method: 'ping' });
    expect(posted.slice(1)).toEqual([
      { jsonrpc: '2.0', id: 7, result: {} },
      { jsonrpc: '2.0', id: 'abc', result: {} },
    ]);
  });

  it('answers a request it does not know with method-not-found', () => {
    const { bridge, posted } = setup();
    bridge.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: {} });
    expect(posted[1]).toMatchObject({ jsonrpc: '2.0', id: 9, error: { code: -32601 } });
    expect(posted[1]).not.toHaveProperty('result');
  });

  it('does not answer a notification it does not know', () => {
    const { bridge, posted } = setup();
    bridge.handle(notification('ui/notifications/tool-cancelled', { reason: 'x' }));
    bridge.handle(notification('whatever'));
    expect(posted).toHaveLength(1);
  });
});

describe('what is not for the card', () => {
  it('ignores anything that is not JSON-RPC', () => {
    const { bridge, posted, shown, themes } = setup();
    for (const message of [null, undefined, 'ui/initialize', 5, true, [], {}, { id: 1, result: {} }, { jsonrpc: '1.0', id: 1, result: {} }, { jsonrpc: '2.0' }, { jsonrpc: '2.0', method: 5 }]) {
      expect(() => bridge.handle(message)).not.toThrow();
    }
    expect(posted).toHaveLength(1);
    expect(shown).toEqual([]);
    expect(themes).toEqual([]);
  });

  it('does not take a request for an answer', () => {
    const { bridge, posted } = setup();
    bridge.handle({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(posted.map((m) => m.method)).toEqual(['ui/initialize', undefined]);
    expect(posted[1]).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });
});

describe('a bad result never throws', () => {
  const BAD: unknown[] = [
    { content: [null, 5, 'x', [], { type: 'text' }], structuredContent: 5 },
    { content: { length: 3 }, structuredContent: [] },
    { structuredContent: { ...DAY, lessons: [{ hourIndex: 1, subject: 'x', status: 'regular', startTime: 5, endTime: {}, teacher: [], room: 7, note: 8 }] } },
    { structuredContent: { ...DAY, updatedAt: 'not a time', date: '2026-13-45' } },
    { structuredContent: { ...DAY, exams: [{ subject: 'x', originalSubject: 5, details: 7, startTime: 9 }], events: [{ title: 't', details: 5 }] } },
    { structuredContent: DAY, content: 'x', isError: 'yes' },
  ];

  it('in cardBody', () => {
    for (const result of BAD) expect(() => cardBody(result, NOW)).not.toThrow();
  });

  it('in handle', () => {
    for (const params of BAD) {
      const { bridge } = setup();
      bridge.handle(answer());
      expect(() => bridge.handle(notification('ui/notifications/tool-result', params))).not.toThrow();
    }
  });

  it('when the host throws while showing', () => {
    const host: CardHost = {
      post: () => {}, show: () => { throw new Error('boom'); }, theme: () => { throw new Error('boom'); }, now: () => NOW, openaiOutput: () => DAY,
      later: (run) => { run(); },
    };
    let bridge: ReturnType<typeof startCardBridge> | undefined;
    expect(() => { bridge = startCardBridge(host); }).not.toThrow();
    if (!bridge) throw new Error('no bridge');
    expect(() => bridge!.handle(answer({ theme: 'dark' }))).not.toThrow();
    expect(() => bridge!.handle(toolResult(DAY))).not.toThrow();
  });

  it('when the clock is broken', () => {
    expect(() => cardBody({ structuredContent: DAY }, new Date(NaN))).not.toThrow();
  });
});

describe('cardBody', () => {
  it('is the day card for a day, and the text for anything else', () => {
    expect(cardBody({ content: [text('x')], structuredContent: DAY }, NOW)).toContain('class="hd"');
    expect(cardBody({ content: [text('אין')] }, NOW)).toBe('<div class="plain">אין</div>');
    expect(cardBody({}, NOW)).toBeNull();
    expect(cardBody(null, NOW)).toBeNull();
  });

  it('goes day first, then the text of content, then a text in the structured content', () => {
    const both = { content: [text('מהתוכן')], structuredContent: { found: false, text: 'מהמבנה' } };
    expect(cardBody({ ...both, structuredContent: { ...DAY, text: 'מהמבנה' } }, NOW)).toContain('class="hd"');
    expect(cardBody(both, NOW)).toBe('<div class="plain">מהתוכן</div>');
    expect(cardBody({ structuredContent: both.structuredContent }, NOW)).toBe('<div class="plain">מהמבנה</div>');
    expect(cardBody({ content: [], structuredContent: both.structuredContent }, NOW)).toBe('<div class="plain">מהמבנה</div>');
  });

  it('draws a text in the structured content of an error too, escaped, with its line breaks', () => {
    expect(cardBody({ isError: true, structuredContent: { text: '<b>א</b>\nב' } }, NOW)).toBe('<div class="plain">&lt;b&gt;א&lt;/b&gt;<br>ב</div>');
  });

  it('ignores a structured text that is blank or not text', () => {
    for (const text of ['', '   ', 5, null, ['x'], {}]) expect(cardBody({ structuredContent: { found: false, text } }, NOW)).toBeNull();
    expect(cardBody({ structuredContent: 'text' }, NOW)).toBeNull();
    expect(cardBody({ structuredContent: ['text'] }, NOW)).toBeNull();
  });
});

describe('sizeNotification', () => {
  it('is a size-changed notification with whole pixels', () => {
    expect(sizeNotification(320.2, 187.4)).toEqual({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 321, height: 188 } });
  });
});
