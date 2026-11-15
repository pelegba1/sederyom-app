/**
 * The day card's page script (chat connection spec 2.3): the one file that touches the window. The
 * build script (`scripts/build-day-card.mjs`) bundles it, with the markup, the handshake and the
 * styles, into the HTML page the server hands to a chat as `ui://sederyom/day.html`.
 *
 * The server's program has no DOM library (it would clash with Node's types), so the few members of
 * the window this file uses are typed here, in `FrameWindow`, and reached through `globalThis`.
 *
 * What it does: adds the card's styles (a `<style>` built from `cardCss(light, dark)`, so the page
 * holds no CSS of its own), starts the handshake with the window that frames the page, takes only
 * messages that window sent, sets `data-theme` on `<html>` from the host's answer, writes the card
 * into `#card`, reads ChatGPT's `window.openai.toolOutput` (at start, at the end of the handshake and a
 * second after the start, through the window's timer), and tells the host the page's height whenever it
 * changes (never a height of 0: the page is empty until a result is drawn).
 */
import { dark, light } from '../../../../app/src/theme';
import { sizeNotification, startCardBridge } from './bridge.js';
import { cardCss } from './styles.js';

/** The part of `window` the page uses. */
export interface FrameWindow {
  /** The window that frames the page: the chat's. */
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  addEventListener(type: 'message', listener: (event: { source: unknown; data: unknown }) => void): void;
  /** ChatGPT's bridge, when the page is in ChatGPT. */
  openai?: { toolOutput?: unknown };
  ResizeObserver?: new (callback: () => void) => { observe(target: unknown): void };
  setTimeout?(callback: () => void, ms: number): unknown;
  document: {
    documentElement: { dataset: Record<string, string | undefined>; getBoundingClientRect(): { width: number; height: number } };
    head: { appendChild(node: unknown): unknown };
    createElement(tag: 'style'): { textContent: string };
    getElementById(id: string): { innerHTML: string } | null;
  };
}

export function startView(win: FrameWindow): void {
  const doc = win.document;
  const parent = win.parent;
  const card = doc?.getElementById('card');
  if (!doc || !parent || !card) return;

  const style = doc.createElement('style');
  style.textContent = cardCss(light, dark);
  doc.head.appendChild(style);

  const root = doc.documentElement;
  // The host picks the frame's origin, which the page cannot know; it holds nothing to keep secret.
  const post = (message: object): void => parent.postMessage(message, '*');
  const bridge = startCardBridge({
    post,
    show: (html) => { card.innerHTML = html; },
    theme: (name) => { root.dataset.theme = name; },
    now: () => new Date(),
    openaiOutput: () => win.openai?.toolOutput,
    later: (run, ms) => { win.setTimeout?.(run, ms); },
  });
  win.addEventListener('message', (event) => {
    if (event.source === parent) bridge.handle(event.data);
  });

  if (win.ResizeObserver) {
    let last = '';
    new win.ResizeObserver(() => {
      const { width, height } = root.getBoundingClientRect();
      // Before anything is drawn the card is hidden (`#card:empty`) and the page is 0 high: that is not
      // a size to give the host, whose frame would shrink to nothing. The next change reports the real one.
      if (height <= 0) return;
      const size = `${Math.ceil(width)}x${Math.ceil(height)}`;
      if (size === last) return;
      last = size;
      post(sizeNotification(width, height));
    }).observe(root);
  }
}

startView(globalThis as unknown as FrameWindow);
