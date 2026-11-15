const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('@babel/parser');
const { pluginsFor } = require('../scripts/copy-tells.cjs');

/**
 * Plan §16.1 (direction): anything one-sided is written with logical props,
 * `insetInlineStart`, `marginStart`, `paddingEnd`, `borderStartWidth` and the
 * like, never a physical side. The phone mirrors physical sides for a
 * right-to-left app and the browser preview does not, so a `left:` looks
 * right in every screenshot and lands on the wrong side of the phone. A
 * value the same on both sides takes the symmetric form (`marginHorizontal`,
 * `insetInline`).
 *
 * The check reads every `.ts` and `.tsx` file under app/src with
 * @babel/parser and finds each object property named for a physical side.
 * Not styles, so never counted: a touch area's reach (`hitSlop`,
 * `pressRetentionOffset`, the same both ways by nature), a destructured
 * value (`const { left } = insets`), a type, SVG coordinates (`x1`, `cx`:
 * attributes, not style keys), a value such as `textAlign: 'left'`, and
 * comments.
 */
const PHYSICAL = new Set([
  'left', 'right',
  'marginLeft', 'marginRight',
  'paddingLeft', 'paddingRight',
  'borderLeftWidth', 'borderRightWidth',
  'borderLeftColor', 'borderRightColor',
]);

/** Props whose objects are a touch area's reach, not a style. */
const TOUCH_REACH = new Set(['hitSlop', 'pressRetentionOffset']);

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens']);

/** A property's name, when it is written plainly (`left:` or `'left':`). */
function keyName(prop) {
  if (prop.computed) return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'StringLiteral') return prop.key.value;
  return null;
}

/** Every physical side set in `code`'s objects: `{ line, key }`. */
function physicalSides(code, file = 'x.tsx') {
  const ast = parse(code, { sourceType: 'module', plugins: pluginsFor(file), errorRecovery: true });
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    // `const { left } = insets` reads a value; it sets no style.
    if (node.type === 'ObjectPattern') return;
    // hitSlop={{ left: 4, right: 4 }}, and the same as a property of a props object.
    if (node.type === 'JSXAttribute' && node.name.type === 'JSXIdentifier' && TOUCH_REACH.has(node.name.name)) return;
    if (node.type === 'ObjectProperty' && TOUCH_REACH.has(keyName(node))) return;
    if (node.type === 'ObjectProperty' && PHYSICAL.has(keyName(node))) {
      out.push({ line: node.loc.start.line, key: keyName(node) });
    }
    for (const key of Object.keys(node)) {
      if (!SKIP_KEYS.has(key)) visit(node[key]);
    }
  };
  visit(ast.program);
  return out;
}

/** The finds in a one-file source, as `line key` pairs. */
const found = (code, file = 'fixture.tsx') => physicalSides(code, file).map((f) => `${f.line} ${f.key}`);

test('a physical side in a style is found: StyleSheet, inline, quoted, or built in a function', () => {
  assert.deepEqual(found("const s = StyleSheet.create({ fab: { position: 'absolute', left: 16, bottom: 20 } });"), ['1 left']);
  assert.deepEqual(found('const a = <View style={{ marginRight: 8 }} />;'), ['1 marginRight']);
  assert.deepEqual(found("const s = { 'paddingLeft': 4, borderRightWidth: 1, borderLeftColor: c };"), ['1 paddingLeft', '1 borderRightWidth', '1 borderLeftColor']);
  assert.deepEqual(found('const f = (x: number) => ({\n  right: x,\n});', 'fixture.ts'), ['2 right']);
});

test('logical and symmetric props, touch reach, reads, types, values, SVG and comments are not', () => {
  const code = [
    "const s = StyleSheet.create({ fab: { insetInlineEnd: 16, marginStart: 4, paddingEnd: 8, borderStartWidth: 1, marginHorizontal: -14 } });",
    'const a = <Pressable hitSlop={{ top: 4, bottom: 4, left: 12, right: 12 }} />;',
    'const b = { hitSlop: { left: 4, right: 4 }, pressRetentionOffset: { left: 8, right: 8 } };',
    'const { left, right } = insets;',
    'type Box = { left: number; right: number };',
    "const t = { textAlign: 'left', writingDirection: 'rtl' };",
    'const l = <Line x1="0" y1="1" x2="100%" y2="1" />;',
    '// left: 0, right: 0',
    '/* marginLeft: 4 */',
    'const m = insets.left + insets.right;',
  ].join('\n');
  assert.deepEqual(found(code), []);
});

const src = path.join(__dirname, '../src');

/** Every `.ts` and `.tsx` file under `dir`, at any depth. */
function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test('no style under app/src sets a physical side (plan §16.1)', () => {
  const files = sources(src);
  for (const known of ['screens/TodayScreen.tsx', 'components/notebook.tsx', 'widget/widgets.tsx', 'navigation/Root.tsx']) {
    assert.ok(files.includes(path.join(src, known)), known);
  }
  const hits = files.flatMap((file) => physicalSides(fs.readFileSync(file, 'utf8'), file)
    .map(({ line, key }) => `${path.relative(src, file).split(path.sep).join('/')}:${line}  ${key}`));
  assert.deepEqual(hits, []);
});
