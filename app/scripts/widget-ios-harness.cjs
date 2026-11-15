/**
 * Runs the iPhone widgets the way the extension does, without a Mac:
 *
 * 1. compiles kit.tsx and the three widget files with the app's Babel config
 *    (so the expo-widgets plugin turns each `'widget'` function into its
 *    source string, exactly as Metro does) and composes the layouts;
 * 2. evaluates `ExpoWidgets.bundle` — the extension's own JS runtime, built
 *    by `node node_modules/expo-widgets/scripts/build-bundle.mjs <app dir>` —
 *    in a fresh context, and calls its `__expoWidgetRender` /
 *    `__expoWidgetHandlePress` on props from `props.ts`;
 * 3. writes the node trees SwiftUI would get as JSON, and draws them as HTML
 *    (a rough SwiftUI-to-CSS reading: stacks are flexboxes, `frame`,
 *    `padding`, `font`, `foregroundStyle`, `background`, `strikethrough`)
 *    for a look in a browser in both schemes.
 *
 * Usage: node scripts/widget-ios-harness.cjs <out dir> [feed.json]
 * Without a feed it uses the test fixture's day (Sunday 1.11, 09:00).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const APP = path.join(__dirname, '..');
if (!process.argv[2]) {
  console.error('Usage: node scripts/widget-ios-harness.cjs <out dir> [feed.json]');
  process.exit(1);
}
const OUT = path.resolve(process.argv[2]);
fs.mkdirSync(OUT, { recursive: true });

// ---- 1. the layouts, compiled as Metro compiles them ----

const compiled = new Map();
function loadTs(file) {
  if (compiled.has(file)) return compiled.get(file);
  const { code } = babel.transformFileSync(file, {
    cwd: APP, root: APP, filename: file,
    caller: { name: 'metro', platform: 'ios', bundler: 'metro', isDev: false, engine: 'hermes' },
  });
  const module = { exports: {} };
  compiled.set(file, module.exports);
  const req = (spec) => {
    if (spec.startsWith('.')) {
      const base = path.resolve(path.dirname(file), spec);
      const found = ['.tsx', '.ts'].map((ext) => base + ext).find((f) => fs.existsSync(f));
      return found ? loadTs(found) : {};
    }
    if (spec === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: 'fragment' };
    return {}; // @expo/ui: only names inside the layout strings, which never run here
  };
  new Function('module', 'exports', 'require', code)(module, module.exports, req);
  return module.exports;
}

const kitModule = loadTs(path.join(APP, 'src/widget/ios/kit.tsx'));
const layouts = {
  Today: kitModule.composeLayout(kitModule.kit, loadTs(path.join(APP, 'src/widget/ios/schedule.tsx')).scheduleLayout),
  TasksExams: kitModule.composeLayout(kitModule.kit, loadTs(path.join(APP, 'src/widget/ios/tasks.tsx')).tasksLayout),
  Overview: kitModule.composeLayout(kitModule.kit, loadTs(path.join(APP, 'src/widget/ios/overview.tsx')).overviewLayout),
};

// ---- 2. the extension's runtime ----

const bundlePath = path.join(path.dirname(require.resolve('expo-widgets/package.json', { paths: [APP] })), 'bundle/build/ExpoWidgets.bundle');
if (!fs.existsSync(bundlePath)) {
  console.error(`No ${bundlePath}: run node node_modules/expo-widgets/scripts/build-bundle.mjs <app dir> first`);
  process.exit(1);
}
const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(bundlePath, 'utf8'), context, { filename: 'ExpoWidgets.bundle' });

/** One render, as `WidgetsJSRuntime.render` does it. */
function render(name, props, environment) {
  context.__expoWidgetLayout = vm.runInContext(`(${layouts[name]})`, context);
  return JSON.parse(JSON.stringify(context.__expoWidgetRender(props, environment)));
}
/** One button press, as `WidgetUserInteraction.perform` does it: the new props to merge, or undefined. */
function press(name, props, environment, target) {
  context.__expoWidgetLayout = vm.runInContext(`(${layouts[name]})`, context);
  const out = context.__expoWidgetHandlePress(props, { ...environment, target });
  return out === undefined ? undefined : JSON.parse(JSON.stringify(out));
}

// ---- the props, from props.ts as the app builds them ----

function loadPlain(file) {
  if (compiled.has(file)) return compiled.get(file);
  const { code } = babel.transformFileSync(file, {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  compiled.set(file, module.exports);
  const req = (spec) => (spec.startsWith('.') ? loadPlain(`${path.resolve(path.dirname(file), spec)}.ts`) : require(spec));
  new Function('module', 'exports', 'require', code)(module, module.exports, req);
  return module.exports;
}
const props = loadPlain(path.join(APP, 'src/widget/ios/props.ts'));

const fixture = process.argv[3]
  ? { feed: JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), now: new Date() }
  : require(path.join(APP, 'test/fixtures/widget-ios-feed.cjs'));
const input = {
  feed: fixture.feed, now: fixture.now, slots: {},
  updated: 'עודכן 09:12', staleAt: fixture.now.getTime() + 3 * 3600 * 1000,
};
const built = {
  Today: props.buildSchedule(input),
  TasksExams: props.buildTasks(input),
  Overview: props.buildOverview(input),
};
const FAMILY = { Today: 'systemMedium', TasksExams: 'systemSmall', Overview: 'systemLarge' };
/** iPhone 15 sizes, pt — the common phone; the SE's are smaller still (148 / 321×148 / 321×324). */
const SIZE = { systemSmall: [158, 158], systemMedium: [338, 158], systemLarge: [338, 354] };

const results = {};
for (const name of Object.keys(layouts)) {
  for (const scheme of ['light', 'dark']) {
    const env = { widgetFamily: FAMILY[name], colorScheme: scheme, timestamp: fixture.now.getTime() };
    results[`${name}-${scheme}`] = render(name, built[name], env);
  }
}

// WidgetKit's placeholder, and a widget placed before the app ran: no props at all.
for (const name of Object.keys(layouts)) {
  results[`${name}-placeholder`] = render(name, {}, { widgetFamily: FAMILY[name], colorScheme: 'dark', timestamp: fixture.now.getTime() });
}

// Paging: find the chevrons' targets and press them.
const paging = {};
{
  const env = { widgetFamily: 'systemMedium', colorScheme: 'light', timestamp: fixture.now.getTime() };
  const targets = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'Button' && node.props?.target) targets.push(node.props.target);
    walk(node.props?.children);
  };
  walk(results['Today-light']);
  paging.targets = targets;
  paging.presses = targets.map((target) => ({ target, merged: press('Today', built.Today, env, target) }));
  const next = paging.presses.find((p) => p.merged && p.merged.offset === 1);
  if (next) {
    const paged = { ...built.Today, ...next.merged };
    results['Today-light-next'] = render('Today', paged, env);
    results['Today-dark-next'] = render('Today', paged, { ...env, colorScheme: 'dark' });
  }
}

fs.writeFileSync(path.join(OUT, 'trees.json'), JSON.stringify({ paging, results }, null, 1));
fs.writeFileSync(path.join(OUT, 'layouts.json'), JSON.stringify(layouts, null, 1));

// ---- 3. a rough drawing ----

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const FONTS = {
  'Assistant-Regular': "font-family:'Assistant';font-weight:400",
  'Assistant-SemiBold': "font-family:'Assistant';font-weight:600",
  'Assistant-Bold': "font-family:'Assistant';font-weight:700",
  'Assistant-ExtraBold': "font-family:'Assistant';font-weight:800",
  'SecularOne-Regular': "font-family:'Secular One'",
};
function color(c) {
  if (c && typeof c === 'object') c = c.color;
  if (typeof c !== 'string') return 'currentColor';
  const m = /^#([0-9A-F]{6})([0-9A-F]{2})$/i.exec(c);
  if (!m) return c;
  return `#${m[1]}${m[2]}`;
}
/** `axis`: the parent stack's direction, which decides what an unbounded frame grows along. */
function mods(list = [], kind, axis = 'col') {
  const css = [];
  let outer = [];
  for (const m of list) {
    switch (m.$type) {
      case 'font': css.push(FONTS[m.family] ?? '', `font-size:${m.size}px`); break;
      case 'foregroundStyle': {
        const v = color(m.style ?? m.color ?? m.value);
        css.push(kind === 'shape' ? `background:${v}` : `color:${v}`);
        break;
      }
      case 'frame':
        if (m.width !== undefined) css.push(`width:${m.width}px;flex:none`);
        if (m.height !== undefined) css.push(`height:${m.height}px`);
        if (m.minHeight !== undefined) css.push(`min-height:${m.minHeight}px`);
        if (m.maxHeight !== undefined && m.maxHeight < 10000) css.push(`max-height:${m.maxHeight}px`, axis === 'col' ? 'flex:1 1 0' : '');
        if (m.maxWidth >= 10000) css.push(axis === 'row' ? 'flex:1 1 0;min-width:0' : axis === 'z' ? 'width:100%' : 'align-self:stretch');
        if (m.maxHeight >= 10000) css.push(axis === 'col' ? 'flex:1 1 0' : axis === 'z' ? 'height:100%' : 'align-self:stretch');
        if (m.alignment === 'leading' || m.alignment === 'topLeading') css.push('justify-content:flex-start');
        break;
      case 'padding': {
        const v = (k) => (m[k] === undefined ? 0 : m[k]);
        const top = v('top') || v('vertical') || v('all'), bottom = v('bottom') || v('vertical') || v('all');
        const lead = v('leading') || v('horizontal') || v('all'), trail = v('trailing') || v('horizontal') || v('all');
        css.push(`padding:${top}px ${lead}px ${bottom}px ${trail}px`); // rtl: right=leading
        break;
      }
      case 'background': css.push(`background:${color(m.style ?? m.color)};border-radius:${m.cornerRadius ?? 0}px`); break;
      case 'containerBackground': css.push(`background:${color(m.style ?? m.color)}`); break;
      case 'strikethrough': css.push(`text-decoration:line-through;text-decoration-color:${color(m.color)}`); break;
      case 'opacity': css.push(`opacity:${m.value}`); break;
      case 'clipped': css.push('overflow:hidden'); break;
      case 'strokeBorder': css.push(`box-shadow:inset 0 0 0 ${m.style?.lineWidth ?? 1}px ${color(m.content ?? m.color)};border-radius:${m.cornerRadius ?? 0}px`); break;
      case 'lineLimit': css.push('white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0'); break;
      case 'monospacedDigit': css.push('font-variant-numeric:tabular-nums'); break;
      case 'fixedSize': if (m.horizontal) css.push('flex-shrink:0;min-width:auto;overflow:visible'); break;
      default: break;
    }
  }
  return css.join(';');
}
/**
 * Whether a view takes all the room it is offered along `dir` ('h' or 'v'),
 * as SwiftUI sizes it: an unbounded frame, a Spacer along its stack, or a
 * child that does — unless a fixed frame says otherwise.
 */
function greedy(node, dir) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => greedy(n, dir));
  const frames = (node.props?.modifiers ?? []).filter((m) => m.$type === 'frame');
  if (frames.some((f) => (dir === 'h' ? f.width : f.height) !== undefined)) return false;
  if (frames.some((f) => (dir === 'h' ? f.maxWidth : f.maxHeight) >= 10000)) return true;
  const kids = [].concat(node.props?.children ?? []).flat(Infinity);
  const along = (node.type === 'HStackView' && dir === 'h') || (node.type === 'VStackView' && dir === 'v');
  if (along && kids.some((k) => k && k.type === 'SpacerView' && !(k.props?.modifiers ?? []).some((f) => f.$type === 'frame'))) return true;
  return kids.some((k) => greedy(k, dir));
}
function grow(node, axis) {
  const css = [];
  if (greedy(node, 'h')) css.push(axis === 'row' ? 'flex:1 1 0;min-width:0' : 'align-self:stretch');
  if (greedy(node, 'v')) css.push(axis === 'col' ? 'flex:1 1 0' : 'align-self:stretch');
  return css.join(';');
}
function draw(node, axis = 'col') {
  if (node === null || node === undefined || node === false) return '';
  if (Array.isArray(node)) return node.map((n) => draw(n, axis)).join('');
  if (typeof node !== 'object') return esc(node);
  const p = node.props ?? {};
  const inner = node.type === 'HStackView' || node.type === 'Button' ? 'row' : node.type === 'ZStackView' ? 'z' : 'col';
  const kids = draw(p.children, inner);
  const m = p.modifiers ?? [];
  switch (node.type) {
    case 'HStackView': return `<div style="display:flex;flex-direction:row;align-items:center;gap:${p.spacing ?? 8}px;${grow(node, axis)};${mods(m, undefined, axis)}">${kids}</div>`;
    case 'VStackView': return `<div style="display:flex;flex-direction:column;align-items:${p.alignment === 'leading' ? 'flex-start' : 'center'};gap:${p.spacing ?? 8}px;${grow(node, axis)};${mods(m, undefined, axis)}">${kids}</div>`;
    case 'ZStackView': return `<div style="display:grid;${mods(m, undefined, axis)}">${kids}</div>`;
    case 'TextView': return `<span style="flex:0 1 auto;${mods(m, undefined, axis)}">${esc(p.text ?? '')}${kids}</span>`;
    case 'SpacerView': return `<div style="flex:1 1 0;min-width:${p.minLength ?? 0}px;${mods(m, undefined, axis)}"></div>`;
    case 'RectangleView': case 'RoundedRectangleView':
      return `<div style="flex:none;${axis === 'row' && !m.some((f) => f.$type === 'frame' && f.height !== undefined) ? 'align-self:stretch;' : ''}border-radius:${p.cornerRadius ?? 0}px;${mods(m, 'shape', axis)}"></div>`;
    case 'ImageView': return `<span style="flex:none;font-weight:700;${mods(m, undefined, axis)}">${p.systemName === 'chevron.right' ? '&gt;' : '&lt;'}</span>`;
    case 'Button': return `<div style="display:flex;cursor:pointer;${mods(m, undefined, axis)}" title="${esc(p.target)}">${kids}</div>`;
    default: return `<div data-type="${esc(node.type)}">${kids}</div>`;
  }
}

const cards = Object.entries(results).map(([key, tree]) => {
  const [name] = key.split('-');
  const [w, h] = SIZE[FAMILY[name]];
  const html = draw(tree, 'z').replace('display:grid;', "display:grid;grid-template-areas:'a';grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);");
  return `<figure><figcaption>${esc(key)}</figcaption><div class="w" style="width:${w}px;height:${h}px">${html}</div></figure>`;
}).join('\n');
fs.writeFileSync(path.join(OUT, 'widgets.html'), `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>iOS widgets harness</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700;800&family=Secular+One&display=swap">
<style>
body{margin:0;padding:16px;background:#56657A;display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;font-family:Assistant}
figure{margin:0}figcaption{color:#fff;font:12px monospace;margin-bottom:4px;direction:ltr}
.w{border-radius:22px;overflow:hidden;position:relative}
.w>div{height:100%}
.w>div>*{grid-area:a}
</style></head><body>${cards}
<script>/* #Today-light shows that one widget alone. */
const k = decodeURIComponent(location.hash.slice(1));
if (k) for (const f of document.querySelectorAll('figure')) if (f.querySelector('figcaption').textContent !== k) f.remove();
</script></body></html>`);

console.log(JSON.stringify({ out: OUT, paging, keys: Object.keys(results) }, null, 1));
