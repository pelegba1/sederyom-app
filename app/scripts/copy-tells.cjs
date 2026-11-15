#!/usr/bin/env node
/**
 * Finds the copy habits plan §16.2 retires, in the strings of source files:
 *
 *   node app/scripts/copy-tells.cjs <file>…
 *
 * prints `file:line  rule  text` for every string that breaks a rule, and
 * exits 1 if anything was found (0 if not). It reads string literals,
 * template literals (their text parts, joined) and JSX text; comments,
 * regular expressions and an object's keys (a width table's "·") are not
 * copy, so they never count. Text from a source passes through variables,
 * never literals, so it never counts either. The rules:
 *
 *   tick    a ✓ or ✔ (a drawn tick is an AppIcon)
 *   dash    " — " in a string with Hebrew in it (a comma, a full stop, or two lines)
 *   dots    any "·" (Wave 9 re-rate: a comma or a second line, never a middle dot)
 *   quotes  ׳…׳, "…" or “…” used as quotation marks around Hebrew (only ״…״);
 *           a geresh or a double quote inside a word (מתמ׳, יח"ל) is not a quote
 *
 * The files are parsed with @babel/parser, so a quote inside a regex or a
 * comment is never mistaken for a string.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@babel/parser');

const HEBREW = /[֐-׿]/;
const LETTER = 'א-ת';

/** Each rule: its name and a test over one string's text. */
const RULES = [
  { rule: 'tick', test: (s) => /[✓✔]/.test(s) },
  { rule: 'dash', test: (s) => /\s—\s/.test(s) && HEBREW.test(s) },
  { rule: 'dots', test: (s) => s.includes('·') },
  {
    rule: 'quotes',
    test: (s) => [
      // An opening mark not glued to a letter before it, a Hebrew letter right after it, and the closing mark after a Hebrew letter.
      new RegExp(`(^|[^${LETTER}])׳[${LETTER}][^׳]*[${LETTER}]׳`),
      new RegExp(`(^|[^${LETTER}])"[${LETTER}][^"]*[${LETTER}]"`),
      new RegExp(`“[^”]*[${LETTER}][^”]*”`),
    ].some((re) => re.test(s)),
  },
];

/** The parser's plugins for a file: JSX only where a file may hold it (`<T>x` is a cast in a .ts file). */
function pluginsFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return ['typescript'];
  if (ext === '.tsx') return ['typescript', 'jsx'];
  return ['jsx'];
}

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens']);

/** An object's key, `{ '·': 253 }` or `{ ['·']: 253 }` written as a string: a name, not copy. */
function isObjectKey(parent, key) {
  return key === 'key' && parent && (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod');
}

/** Every string in `code`: `{ line, text }`, a template's text parts joined around `${…}`. Object keys are left out. */
function strings(code, file = 'x.tsx') {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: pluginsFor(file),
    errorRecovery: true,
    allowReturnOutsideFunction: true,
  });
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node.type === 'StringLiteral' || node.type === 'JSXText') {
      out.push({ line: node.loc.start.line, text: node.value });
    } else if (node.type === 'TemplateLiteral') {
      out.push({ line: node.loc.start.line, text: node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('${…}') });
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key) || isObjectKey(node, key)) continue;
      visit(node[key]);
    }
  };
  visit(ast.program);
  return out;
}

/** The findings in one file's source: `{ file, line, rule, text }`, one per string and rule. */
function scan(code, file = 'x.tsx') {
  const findings = [];
  for (const { line, text } of strings(code, file)) {
    for (const { rule, test } of RULES) {
      if (test(text)) findings.push({ file, line, rule, text });
    }
  }
  return findings;
}

/** One finding as the script prints it. */
function format({ file, line, rule, text }) {
  const shown = text.replace(/\s+/g, ' ').trim();
  return `${file}:${line}  ${rule}  ${shown.length > 100 ? `${shown.slice(0, 99)}…` : shown}`;
}

function main(files) {
  if (files.length === 0) {
    console.error('usage: node app/scripts/copy-tells.cjs <file>…');
    return 2;
  }
  let found = 0;
  for (const file of files) {
    const findings = scan(fs.readFileSync(file, 'utf8'), file);
    for (const f of findings) console.log(format(f));
    found += findings.length;
  }
  return found > 0 ? 1 : 0;
}

module.exports = { RULES, strings, scan, format, pluginsFor };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
