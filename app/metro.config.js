// Expo monorepo setup: the app lives in a workspace next to `shared`, so Metro
// has to watch the repo root and look in both node_modules trees.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Without this, a package hoisted to the root can be resolved twice and React
// ends up duplicated.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
