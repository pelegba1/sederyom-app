const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');

/**
 * The iPhone widgets' layouts run inside the widget extension as strings of
 * their own source (src/widget/ios/kit.tsx explains why). A layout that uses
 * a constant or a helper of its module still compiles and still type-checks,
 * and then fails on the phone with a ReferenceError. So: compile each file as
 * Metro does, take the layout strings the expo-widgets Babel plugin made, and
 * check that every name they use without defining it is one the extension
 * provides — an `@expo/ui` component or modifier the file imports, the JSX
 * runtime, or the JavaScript built-ins.
 */
const APP = path.join(__dirname, '..');
const DIR = path.join(APP, 'src/widget/ios');
const LAYOUT_FILES = ['kit.tsx', 'schedule.tsx', 'tasks.tsx', 'overview.tsx'];
const BUILT_INS = new Set(['Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'JSON', 'Date', 'undefined', 'NaN', 'Infinity']);
const JSX_RUNTIME = new Set(['_jsx', '_jsxs', '_Fragment']);

function compile(file) {
  return babel.transformFileSync(file, {
    cwd: APP, root: APP, filename: file,
    caller: { name: 'metro', platform: 'ios', bundler: 'metro', isDev: false, engine: 'hermes' },
  }).code;
}

/** The names a file imports from @expo/ui — the ones the extension installs as globals. */
function uiImports(file) {
  const ast = babel.parseSync(fs.readFileSync(file, 'utf8'), { filename: file, cwd: APP, root: APP });
  const names = new Set();
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration' && node.source.value.startsWith('@expo/ui/swift-ui') && node.importKind !== 'type') {
      for (const s of node.specifiers) if (s.importKind !== 'type') names.add(s.local.name);
    }
  }
  return names;
}

/** The layout strings in a compiled module: the template literals that hold a function's source. */
function layoutStrings(code) {
  const ast = babel.parseSync(code, { configFile: false, babelrc: false, sourceType: 'script' });
  const out = [];
  babel.traverse(ast, {
    TemplateLiteral(p) {
      if (p.node.expressions.length > 0) return; // composeLayout's own template, not a layout
      const raw = p.node.quasis[0].value.cooked;
      if (raw.startsWith('function(')) out.push(raw);
    },
  });
  return out;
}

function freeNames(source) {
  const ast = babel.parseSync(`(${source})`, { configFile: false, babelrc: false, sourceType: 'script' });
  let globals = [];
  babel.traverse(ast, { Program(p) { globals = Object.keys(p.scope.globals); } });
  return globals;
}

for (const name of LAYOUT_FILES) {
  test(`${name}: the layout uses nothing the widget extension lacks`, () => {
    const file = path.join(DIR, name);
    const layouts = layoutStrings(compile(file));
    assert.equal(layouts.length, 1, 'one \'widget\' function per file');
    const allowed = uiImports(file);
    const unknown = freeNames(layouts[0]).filter((n) => !allowed.has(n) && !JSX_RUNTIME.has(n) && !BUILT_INS.has(n));
    assert.deepEqual(unknown, [], `${name} uses ${unknown.join(', ')} from outside its function`);
  });
}

test('composeLayout glues the kit in front of a widget, as one function', () => {
  const kitCode = compile(path.join(DIR, 'kit.tsx'));
  const [kit] = layoutStrings(kitCode);
  const [schedule] = layoutStrings(compile(path.join(DIR, 'schedule.tsx')));
  // composeLayout, taken from the compiled module rather than re-written here.
  const module = { exports: {} };
  new Function('module', 'exports', 'require', kitCode)(module, module.exports, () => ({}));
  const composed = module.exports.composeLayout(kit, schedule);
  assert.match(composed, /^function\(props,environment\)\{/);
  assert.doesNotThrow(() => babel.parseSync(`(${composed})`, { configFile: false, babelrc: false, sourceType: 'script' }));
  assert.throws(() => module.exports.composeLayout(() => null, schedule), /Babel plugin/);
});
