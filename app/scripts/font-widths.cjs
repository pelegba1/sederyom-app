#!/usr/bin/env node
/**
 * Prints the advance-width tables `lib/planning.ts` measures text with
 * (`textWidth`), read straight from the font files the app ships: the
 * TrueType `cmap` (character to glyph) and `hmtx` (glyph to advance) tables,
 * in thousandths of an em.
 *
 *   node app/scripts/font-widths.cjs            # Assistant 500 and 600, from node_modules
 *   node app/scripts/font-widths.cjs <a.ttf> …  # any other files
 *
 * Paste the output over `ASSISTANT_MEDIUM` and `ASSISTANT_SEMIBOLD` in
 * planning.ts; `app/test/planning.test.cjs` checks them letter for letter
 * against the same files.
 */
const fs = require('node:fs');
const path = require('node:path');

/** Every character a grid label or a tab label can hold. */
const CHARS = [...'אבגדהוזחטיךכלםמןנסעףפץצקרשת׳״', ...' +\'"-.,·():', ...'0123456789'];

/** Advance widths (thousandths of an em) of `chars` in the TrueType font at `file`. */
function fontAdvances(file, chars = CHARS) {
  const buf = fs.readFileSync(file);
  const tables = {};
  for (let i = 0; i < buf.readUInt16BE(4); i += 1) {
    const o = 12 + i * 16;
    tables[buf.toString('latin1', o, o + 4)] = buf.readUInt32BE(o + 8);
  }
  for (const t of ['head', 'hhea', 'cmap', 'hmtx']) {
    if (tables[t] === undefined) throw new Error(`${file}: no ${t} table`);
  }
  const unitsPerEm = buf.readUInt16BE(tables.head + 18);
  const metrics = buf.readUInt16BE(tables.hhea + 34);
  // The format 4 subtable maps the Basic Multilingual Plane, which is all a label holds.
  let sub = null;
  for (let i = 0; i < buf.readUInt16BE(tables.cmap + 2); i += 1) {
    const off = tables.cmap + buf.readUInt32BE(tables.cmap + 8 + i * 8);
    if (buf.readUInt16BE(off) === 4) { sub = off; break; }
  }
  if (sub === null) throw new Error(`${file}: no format 4 cmap`);
  const segX2 = buf.readUInt16BE(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  const glyph = (cp) => {
    for (let s = 0; s < segX2 / 2; s += 1) {
      if (cp > buf.readUInt16BE(ends + s * 2)) continue;
      const start = buf.readUInt16BE(starts + s * 2);
      if (cp < start) return 0;
      const delta = buf.readInt16BE(deltas + s * 2);
      const range = buf.readUInt16BE(ranges + s * 2);
      if (range === 0) return (cp + delta) & 0xffff;
      const g = buf.readUInt16BE(ranges + s * 2 + range + (cp - start) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
  const out = {};
  for (const ch of chars) {
    const g = glyph(ch.codePointAt(0));
    if (g === 0) throw new Error(`${file}: no glyph for "${ch}"`);
    // Glyphs past the last full metric share its advance.
    out[ch] = Math.round((buf.readUInt16BE(tables.hmtx + Math.min(g, metrics - 1) * 4) * 1000) / unitsPerEm);
  }
  return out;
}

/** The table as planning.ts writes it: in `CHARS` order (an object would put the digits first), ten a line. */
function tableSource(name, widths) {
  const entries = CHARS.map((ch) => `${ch === "'" ? '"\'"' : `'${ch}'`}: ${widths[ch]}`);
  const lines = [];
  for (let i = 0; i < entries.length; i += 10) lines.push(`  ${entries.slice(i, i + 10).join(', ')},`);
  return `const ${name}: Readonly<Record<string, number>> = {\n${lines.join('\n')}\n};`;
}

function main(args) {
  const files = args.length > 0
    ? args.map((f) => [path.basename(f, '.ttf').replace(/\W+/g, '_').toUpperCase(), f])
    : (() => {
      const dir = path.dirname(require.resolve('@expo-google-fonts/assistant', { paths: [path.join(__dirname, '..')] }));
      return [
        ['ASSISTANT_MEDIUM', path.join(dir, '500Medium', 'Assistant_500Medium.ttf')],
        ['ASSISTANT_SEMIBOLD', path.join(dir, '600SemiBold', 'Assistant_600SemiBold.ttf')],
      ];
    })();
  for (const [name, file] of files) console.log(tableSource(name, fontAdvances(file)));
}

module.exports = { CHARS, fontAdvances, tableSource };

if (require.main === module) main(process.argv.slice(2));
