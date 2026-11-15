/**
 * What the iPhone widget extension needs beyond `expo-widgets` to draw the
 * notebook page (src/widget/ios/kit.tsx):
 *
 * - The fonts. An extension is its own bundle and cannot use the app's fonts,
 *   so the TTFs are copied into `ios/ExpoWidgetsTarget/`, added to the
 *   target's Resources, and listed under `UIAppFonts` in its Info.plist. The
 *   widgets name them by their PostScript names (Assistant-Regular, …).
 * - Right to left. The extension is a Hebrew-only bundle
 *   (`CFBundleDevelopmentRegion` he, `CFBundleLocalizations` [he]), so SwiftUI
 *   lays it out right to left on any phone language, as the app does
 *   (`expo-localization`'s forcesRTL reaches the app only).
 *
 * Order: `expo-widgets` regenerates `ios/ExpoWidgetsTarget/` and its
 * Info.plist on every prebuild, and a plugin's mods run before those of the
 * plugins listed ahead of it. So this one is listed BEFORE `expo-widgets` in
 * app.json: its mods then run after, on the files `expo-widgets` wrote.
 */
const fs = require('node:fs');
const path = require('node:path');
const plist = require('@expo/plist').default;
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const TARGET = 'ExpoWidgetsTarget';

/** The faces the widgets use, from the packages the app already loads its fonts from. */
const FONTS = [
  '@expo-google-fonts/assistant/400Regular/Assistant_400Regular.ttf',
  '@expo-google-fonts/assistant/600SemiBold/Assistant_600SemiBold.ttf',
  '@expo-google-fonts/assistant/700Bold/Assistant_700Bold.ttf',
  '@expo-google-fonts/assistant/800ExtraBold/Assistant_800ExtraBold.ttf',
  '@expo-google-fonts/secular-one/400Regular/SecularOne_400Regular.ttf',
];

const fontFiles = (projectRoot) => FONTS.map((spec) => require.resolve(spec, { paths: [projectRoot] }));

function withFilesAndPlist(config) {
  return withDangerousMod(config, ['ios', async (config) => {
    const dir = path.join(config.modRequest.platformProjectRoot, TARGET);
    if (!fs.existsSync(dir)) throw new Error(`withWidgetPage: ${dir} is missing; list this plugin before expo-widgets`);
    for (const file of fontFiles(config.modRequest.projectRoot)) {
      fs.copyFileSync(file, path.join(dir, path.basename(file)));
    }
    const infoPath = path.join(dir, 'Info.plist');
    const info = plist.parse(fs.readFileSync(infoPath, 'utf8'));
    info.UIAppFonts = FONTS.map((spec) => path.basename(spec));
    info.CFBundleDevelopmentRegion = 'he';
    info.CFBundleLocalizations = ['he'];
    fs.writeFileSync(infoPath, plist.build(info));
    return config;
  }]);
}

function withFontResources(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const targets = project.pbxNativeTargetSection();
    const targetUuid = Object.keys(targets).find((key) => targets[key] && targets[key].name === TARGET);
    if (!targetUuid) throw new Error(`withWidgetPage: no ${TARGET} target; list this plugin before expo-widgets`);
    const names = FONTS.map((spec) => path.basename(spec));

    const phases = project.hash.project.objects.PBXResourcesBuildPhase ?? {};
    const hasPhase = targets[targetUuid].buildPhases.some((phase) => phases[phase.value]);
    if (!hasPhase) project.addBuildPhase(names, 'PBXResourcesBuildPhase', 'Resources', targetUuid);

    // The font files belong to the target's folder, where they were copied.
    const group = project.pbxGroupByName(TARGET);
    const refs = project.pbxFileReferenceSection();
    for (const name of names) {
      const uuid = Object.keys(refs).find((key) => {
        const ref = refs[key];
        return ref && typeof ref === 'object' && String(ref.path).replace(/"/g, '') === name;
      });
      if (!uuid) continue;
      // The xcode library knows no type for a .ttf and writes "unknown"; Xcode files a font as a plain file.
      Object.assign(refs[uuid], { lastKnownFileType: 'file' });
      delete refs[uuid].fileEncoding;
      delete refs[uuid].explicitFileType;
      if (group && !group.children.some((child) => child.value === uuid)) group.children.push({ value: uuid, comment: name });
    }
    return config;
  });
}

module.exports = function withWidgetPage(config) {
  return withFontResources(withFilesAndPlist(config));
};
