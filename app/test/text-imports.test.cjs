const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Plan W4-2: the in-app text size reaches only text drawn by `components/ui`'s
 * `Text` and `TextInput`. A file that imports either straight from
 * 'react-native' draws at the phone's size whatever the setting says, and the
 * setting looks broken on that screen.
 *
 * `node test/text-imports.test.cjs --list` prints the files that still
 * import them.
 */
const SRC = path.join(__dirname, '..', 'src');
const ALLOWED = new Set([path.join(SRC, 'components', 'ui.tsx')]);

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** The value names a file imports from 'react-native' that should come from ui. */
function rawTextImports(source) {
  const found = [];
  for (const match of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*'react-native'/g)) {
    if (match[1]) continue;
    for (const part of match[2].split(',')) {
      const name = part.trim();
      if (name.startsWith('type ')) continue;
      const imported = name.split(/\s+as\s+/)[0];
      if (imported === 'Text' || imported === 'TextInput') found.push(imported);
    }
  }
  return found;
}

function offenders() {
  return sourceFiles(SRC)
    .filter((file) => !ALLOWED.has(file))
    .map((file) => ({ file: path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/'), names: rawTextImports(fs.readFileSync(file, 'utf8')) }))
    .filter((entry) => entry.names.length > 0);
}

test('the import scanner tells value imports from type imports', () => {
  assert.deepEqual(rawTextImports("import { Pressable, Text, View } from 'react-native';"), ['Text']);
  assert.deepEqual(rawTextImports("import {\n  ScrollView,\n  TextInput,\n  type TextStyle,\n} from 'react-native';"), ['TextInput']);
  assert.deepEqual(rawTextImports("import { Text as RNText } from 'react-native';"), ['Text']);
  assert.deepEqual(rawTextImports("import type { Text } from 'react-native';"), []);
  assert.deepEqual(rawTextImports("import { type TextProps, View } from 'react-native';"), []);
  assert.deepEqual(rawTextImports("import { Text } from '../components/ui';"), []);
});

test('Text and TextInput come from components/ui', () => {
  assert.deepEqual(offenders(), []);
});

if (process.argv.includes('--list')) {
  for (const { file, names } of offenders()) console.log(`${file}: ${names.join(', ')}`);
}
