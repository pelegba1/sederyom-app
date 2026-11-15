/**
 * The authorize page (chat connection spec 4.1): where the student types the
 * code from the app. Everything on it that came from a chat (its name, the host
 * it sends the student back to, the OAuth parameters in the form) is the chat's
 * own text, so every value goes through `escapeHtml`, and the page says plainly
 * when the host is not a chat we know.
 */
import { describe, expect, it } from 'vitest';
import { escapeHtml, renderAuthorizePage, renderErrorPage } from '../src/chat/page.js';

const ACTION = 'https://api.example.test/oauth/authorize';
/** The copy as it is in the markup: the apostrophe of צ'אט goes through `escapeHtml` with the rest. */
const WARNING = escapeHtml("זה לא ChatGPT, Claude או Gemini. מתחברים רק אם הוספת את סדר יום לצ'אט הזה בעצמך.");

const page = (over: Partial<Parameters<typeof renderAuthorizePage>[0]> = {}) =>
  renderAuthorizePage({ action: ACTION, name: 'ChatGPT', host: 'chatgpt.com', known: true, fields: {}, ...over });

describe('escapeHtml', () => {
  it('escapes the five characters that matter in text and in a quoted attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    expect(escapeHtml('שלום')).toBe('שלום');
  });
});

describe('renderAuthorizePage', () => {
  it('escapes the chat\'s name and host', () => {
    const html = page({ name: '<script>x</script>', host: 'a"b.example', known: false });
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>x');
    expect(html).toContain('a&quot;b.example');
    expect(html).not.toContain('a"b.example');
    // No script of its own at all.
    expect(html).not.toMatch(/<script/i);
  });

  it('asks for the age with a required box, and no birth date', () => {
    const html = renderAuthorizePage({ action: ACTION, name: 'ChatGPT', host: 'chatgpt.com', known: true, fields: {} });
    expect(html).toMatch(/<input type="checkbox" name="age13" value="yes" required>/);
    expect(html).toContain('מלאו לי 13');
  });

  it('escapes every hidden field, names and values', () => {
    const html = page({ fields: { state: '"><img src=x onerror=alert(1)>', redirect_uri: "https://x.example/cb?a=1&b='2'" } });
    expect(html).not.toContain('<img');
    expect(html).toContain('name="state" value="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"');
    expect(html).toContain('value="https://x.example/cb?a=1&amp;b=&#39;2&#39;"');
  });

  it('is Hebrew, right to left, with the title, the line, the field and the button', () => {
    const html = page({ name: 'ChatGPT', host: 'chatgpt.com' });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain('חיבור לסדר יום');
    expect(html).toContain('‏ChatGPT (chatgpt.com) מבקש לקרוא את המידע שבחרת לשתף בסדר יום.');
    expect(html).toContain('הקוד מהאפליקציה');
    expect(html).toContain(escapeHtml("פותחים את סדר יום ← הגדרות ← חיבור לצ'אט ← להתחבר לצ'אט"));
    expect(html).toContain('פותחים את סדר יום ← הגדרות ← חיבור לצ&#39;אט ← להתחבר לצ&#39;אט');
    expect(html).toContain('לאשר');
    expect(html).toContain(`action="${ACTION}"`);
    expect(html).toContain('method="post"');
  });

  it('shows ✓ and the chat\'s name for a known host, and no warning', () => {
    for (const [host, label] of [['chatgpt.com', 'ChatGPT'], ['chat.openai.com', 'ChatGPT'], ['claude.ai', 'Claude'], ['claude.com', 'Claude'], ['gemini.google.com', 'Gemini']]) {
      const html = page({ host, known: true });
      expect(html, host).toContain(`✓ ${label}`);
      expect(html, host).not.toContain(WARNING);
    }
  });

  it('warns for a host it does not know, and shows no ✓', () => {
    const html = page({ name: 'My chat', host: 'evil.example', known: false });
    expect(html).toContain(WARNING);
    expect(html).not.toContain('✓');
    expect(html).toContain('‏My chat (evil.example)');
  });

  it('shows an error when it has one, escaped', () => {
    expect(page()).not.toContain('role="alert"');
    const html = page({ error: 'הקוד לא נכון <b>' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('הקוד לא נכון &lt;b&gt;');
  });
});

describe('renderErrorPage', () => {
  it('is a Hebrew page with the message, escaped, and no form', () => {
    const html = renderErrorPage('<oops>');
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain('&lt;oops&gt;');
    expect(html).not.toContain('<form');
  });
});
