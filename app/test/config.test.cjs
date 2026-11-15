const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');
const { expoInlineEnvVars } = require('babel-preset-expo/build/plugins/inline-env-vars');

// Compile with Expo's production environment transform, then execute as a
// phone would: process.env is empty, and expo-constants has no env overrides.
test('production build keeps the backend address and never the owner token', () => {
  const values = {
    EXPO_PUBLIC_SEDERYOM_API_URL: 'https://backend.example.org/',
    EXPO_PUBLIC_SEDERYOM_API_TOKEN: 'test-device-credential',
  };
  const previous = { ...process.env };
  try {
    Object.assign(process.env, values);
    const result = transformFileSync(path.join(__dirname, '../src/config.ts'), {
      configFile: false,
      babelrc: false,
      caller: { name: 'metro', isDev: false },
      presets: ['@babel/preset-typescript'],
      plugins: [expoInlineEnvVars, '@babel/plugin-transform-modules-commonjs'],
    });
    const exports = {};
    vm.runInNewContext(result.code, {
      exports,
      process: { env: {} },
      require: (name) => {
        assert.equal(name, 'expo-constants');
        return { expoConfig: { extra: {} } };
      },
    });
    assert.equal(exports.isConfigured, true);
    assert.equal(exports.API_BASE_URL, 'https://backend.example.org');
    // No server token is read by the app: one left in the build environment is not inlined anywhere.
    assert.equal(exports.API_TOKEN, undefined);
    assert.ok(!result.code.includes('test-device-credential'));
    assert.equal(exports.MASHOV_LOGIN_URL, 'https://web.mashov.info/students/login');
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
