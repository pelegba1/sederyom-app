/**
 * The day card's handshake with the chat (chat connection spec 2.3), in the MCP Apps wire format of
 * 2026-01-26: JSON-RPC 2.0 between the page and the window that frames it. Pure: every touch of the
 * window goes through a `CardHost`, which `view.ts` makes and the tests fake.
 *
 *   view   request  ui/initialize (id 1)
 *   host   answer   hostContext.theme: 'light' or 'dark'
 *   view   notify   ui/notifications/initialized
 *   host   notify   ui/notifications/tool-input (ignored), then ui/notifications/tool-result
 *   host   notify   ui/notifications/host-context-changed (a partial context), later
 *   view   notify   ui/notifications/size-changed, whenever the page changes size (`sizeNotification`)
 *   host   request  ui/resource-teardown, or ping: answered `{}` with the same id
 *
 * A result with a day is drawn as the day card; any other result (no copy, not approved, a day outside
 * the copy, an error) shows its text, so the frame is never blank: the text of `content`, else a `text`
 * in `structuredContent` (`{ found: false, text }`). A result with none of these shows nothing.
 * ChatGPT also puts a tool's `structuredContent` alone in `window.openai.toolOutput`, and a host may
 * deliver only that, or answer the handshake late or never. So the card reads it three times: at start,
 * when the handshake ends, and once more a second after start (`host.later`). A read draws only while
 * no tool result has drawn anything. A tool result that has something to show replaces what is there;
 * one that has nothing to show leaves the card as it was, and does not stop the reads.
 *
 * This file runs in the chat's frame: it imports the markup only, and nothing from outside is trusted.
 * `handle` and the reads of `window.openai` catch what they call (a message that is not JSON-RPC, a
 * window that throws, a day the markup cannot draw), so a host that sends rubbish gets a card that
 * ignores it. The opening request, sent as the bridge starts, is not guarded: a `host.post` that throws
 * there throws out of `startCardBridge`.
 */
import { dayCardMarkup, isDayCardData, plainCardMarkup } from './markup.js';

export interface CardHost {
  /** Sends a JSON-RPC message to the window that frames the page. */
  post(message: object): void;
  /** Replaces the card's markup. */
  show(html: string): void;
  /** Sets the colour scheme. */
  theme(name: 'light' | 'dark'): void;
  now(): Date;
  /** `window.openai.toolOutput`, which is a tool's `structuredContent`; anything when the window has none. */
  openaiOutput(): unknown;
  /** Runs `run` once, `ms` milliseconds from now (the window's timer; the tests' own clock). */
  later(run: () => void, ms: number): void;
}

const PROTOCOL_VERSION = '2026-01-26';
/** The id of the one request the page makes. */
const INITIALIZE_ID = 1;
/** JSON-RPC: the method does not exist. */
const METHOD_NOT_FOUND = -32601;
/** How long after the start the card reads `window.openai` once more. */
const OPENAI_RECHECK_MS = 1000;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isTheme = (value: unknown): value is 'light' | 'dark' => value === 'light' || value === 'dark';

/** The text parts of a tool result's `content`, one to a line. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((part) => (isObject(part) && part.type === 'text' && typeof part.text === 'string' && part.text.trim() !== '' ? [part.text] : []))
    .join('\n');
}

/** The `text` a tool puts in its structured content, for a result that is not a day. */
function structuredText(structured: unknown): string {
  return isObject(structured) && typeof structured.text === 'string' && structured.text.trim() !== '' ? structured.text : '';
}

/**
 * The markup for a tool result: the day card when `structuredContent` is a day (and the result is not
 * an error), else the text of `content`, else a `text` in `structuredContent`, else `null` for a result
 * with nothing to show.
 */
export function cardBody(result: unknown, now: Date): string | null {
  if (!isObject(result)) return null;
  if (result.isError !== true && isDayCardData(result.structuredContent)) {
    try {
      return dayCardMarkup(result.structuredContent, now);
    } catch {
      // a day the card cannot draw shows its text, like any other
    }
  }
  const text = textOf(result.content) || structuredText(result.structuredContent);
  return text ? plainCardMarkup(text) : null;
}

/** The page's size, which the host sizes its frame to: whole pixels, rounded up. */
export function sizeNotification(width: number, height: number): object {
  return { jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: Math.ceil(width), height: Math.ceil(height) } };
}

/**
 * Starts the handshake (the request goes out now) and returns the handler for what the window gets,
 * which must already be only what the framing window sent.
 */
export function startCardBridge(host: CardHost): { handle(message: unknown): void } {
  let answered = false;
  /** Whether a tool result has drawn something: after that, `window.openai` is not read again. */
  let gotResult = false;
  /** What the card shows now, so a read that finds the same thing does not redraw it. */
  let shown: string | null = null;

  /** Draws a result, unless the card already shows exactly that. Whether the result had anything to show. */
  const draw = (result: unknown): boolean => {
    const html = cardBody(result, host.now());
    if (html === null) return false;
    if (html !== shown) {
      host.show(html);
      shown = html;
    }
    return true;
  };

  /** `window.openai.toolOutput` is `structuredContent` alone, so it is wrapped as a result. */
  const readWindow = (): void => {
    if (gotResult) return;
    try {
      const output = host.openaiOutput();
      if (output !== undefined && output !== null) draw({ structuredContent: output });
    } catch {
      // a window whose bridge throws has nothing to read
    }
  };

  const onAnswer = (message: Record<string, unknown>): void => {
    if (answered) return;
    answered = true;
    // A host that refuses the handshake gets no theme and no `initialized`; the frame still may hold
    // the result in `window.openai`, and a blank frame helps nobody.
    if (isObject(message.result)) {
      const context = message.result.hostContext;
      host.theme(isObject(context) && isTheme(context.theme) ? context.theme : 'light');
      host.post({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
    }
    readWindow();
  };

  const onNotification = (method: string, params: unknown): void => {
    if (method === 'ui/notifications/tool-result') {
      if (draw(params)) gotResult = true;
    } else if (method === 'ui/notifications/host-context-changed') {
      if (isObject(params) && isTheme(params.theme)) host.theme(params.theme);
    }
  };

  const onRequest = (id: string | number, method: string): void => {
    if (method === 'ui/resource-teardown' || method === 'ping') host.post({ jsonrpc: '2.0', id, result: {} });
    else host.post({ jsonrpc: '2.0', id, error: { code: METHOD_NOT_FOUND, message: `Method not found: ${method}` } });
  };

  const handle = (message: unknown): void => {
    try {
      if (!isObject(message) || message.jsonrpc !== '2.0') return;
      const { id, method } = message;
      const hasId = typeof id === 'string' || typeof id === 'number';
      if (typeof method === 'string') {
        if (hasId) onRequest(id, method);
        else onNotification(method, message.params);
      } else if (id === INITIALIZE_ID && ('result' in message || 'error' in message)) {
        onAnswer(message);
      }
    } catch {
      // a host that sends rubbish, or one whose window throws, leaves the card as it was
    }
  };

  host.post({
    jsonrpc: '2.0',
    id: INITIALIZE_ID,
    method: 'ui/initialize',
    params: { protocolVersion: PROTOCOL_VERSION, appInfo: { name: 'sederyom-day-card', version: '1.0.0' }, appCapabilities: {} },
  });
  readWindow();
  try {
    host.later(readWindow, OPENAI_RECHECK_MS);
  } catch {
    // no timer: the two reads that remain are the start and the end of the handshake
  }
  return { handle };
}
