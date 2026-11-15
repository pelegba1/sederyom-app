/**
 * A Mashov message body is HTML from the teachers' rich-text editor (plan
 * §14.9): `<p><span style="…">…</span></p>`. The app shows plain text, so the
 * markup goes and the line structure stays.
 */

/** Tags that end a line. Opening tags of the same elements add nothing. */
const LINE_ENDS = /<\/(?:p|div|li|tr|h[1-6]|blockquote|ul|ol|table|pre)\s*>/gi;

/** Tags whose content is not text at all. */
const NOT_TEXT = /<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  rlm: '‏',
  lrm: '‎',
  shy: '',
  zwj: '‍',
  zwnj: '‌',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
  middot: '·',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  times: '×',
  deg: '°',
};

/** `&amp;`, `&#1488;`, `&#x5d0;`. An entity this table does not know stays as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

/**
 * Readable plain text: tags dropped; `<br>`, `</p>`, `</div>` (and the other
 * block ends) as line breaks; entities decoded; spaces collapsed within a line;
 * runs of blank lines down to one.
 *
 * In HTML a newline in the source is only a space. A body with no markup at
 * all is taken as plain text already, and its own line breaks are kept.
 */
export function htmlToText(html: string): string {
  let text = html.replace(/\r\n?/g, '\n');
  const isHtml = /<\/?[a-z!][^>]*>/i.test(text);
  if (isHtml) {
    text = text
      .replace(/\n/g, ' ')
      .replace(NOT_TEXT, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(LINE_ENDS, '\n')
      .replace(/<[^>]*>/g, '');
  }
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
