import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const manifestPath = join(root, 'src', 'manifest.json');
const REQUIRED_MODULES = ['Bluetooth', 'Camera', 'Barcode', 'Record'];
const REQUIRED_PRIVACY_KEYS = [
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription'
];

const readPngHeader = (filePath) => {
  const buffer = readFileSync(filePath).subarray(0, 33);
  const isPng = buffer.toString('ascii', 1, 4) === 'PNG';
  if (!isPng) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer.readUInt8(25);
  return { width, height, colorType };
};

const collectIconPaths = (node, output = []) => {
  if (typeof node === 'string') {
    output.push(node);
    return output;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectIconPaths(value, output);
  }
  return output;
};

const errors = [];
const warnings = [];

if (!existsSync(manifestPath)) {
  throw new Error(`manifest.json not found: ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const appPlus = manifest['app-plus'] || {};
const distribute = appPlus.distribute || {};
const ios = distribute.ios || {};
const icons = distribute.icons || {};

if (!`${manifest.versionName || ''}`.trim()) {
  errors.push('manifest.versionName is empty');
}

for (const moduleName of REQUIRED_MODULES) {
  if (!appPlus.modules || !appPlus.modules[moduleName]) {
    errors.push(`app-plus.modules.${moduleName} is missing`);
  }
}

if (!Array.isArray(ios.UIBackgroundModes) || !ios.UIBackgroundModes.includes('bluetooth-central')) {
  errors.push('ios.UIBackgroundModes must include "bluetooth-central"');
}

const privacy = ios.privacyDescription || {};
for (const key of REQUIRED_PRIVACY_KEYS) {
  if (!`${privacy[key] || ''}`.trim()) {
    errors.push(`ios.privacyDescription.${key} is missing`);
  }
}

const plistcmds = Array.isArray(ios.plistcmds) ? ios.plistcmds.join('') : '';
if (!plistcmds.includes('ITSAppUsesNonExemptEncryption')) {
  errors.push('ios.plistcmds must set ITSAppUsesNonExemptEncryption');
}

if (ios.idfa !== false) {
  warnings.push('ios.idfa is not explicitly false (no ads in this app)');
}

const iconPaths = collectIconPaths(icons);
if (!iconPaths.length) {
  errors.push('distribute.icons is empty');
}

for (const iconPath of iconPaths) {
  const absolute = join(root, ...iconPath.split(/[\\/]/));
  if (!existsSync(absolute)) {
    errors.push(`icon file missing: ${iconPath}`);
    continue;
  }
  const header = readPngHeader(absolute);
  if (!header) {
    errors.push(`icon is not a valid PNG: ${iconPath}`);
    continue;
  }
  const match = /(\d+)x(\d+)\.png$/i.exec(iconPath);
  if (match) {
    const expected = Number(match[1]);
    if (header.width !== expected || header.height !== expected) {
      errors.push(`icon size mismatch: ${iconPath} is ${header.width}x${header.height}`);
    }
  }
}

const appStoreIcon = icons.ios && icons.ios.appstore;
if (appStoreIcon) {
  const absolute = join(root, ...appStoreIcon.split(/[\\/]/));
  if (existsSync(absolute) && readPngHeader(absolute).colorType === 6) {
    errors.push(`App Store icon must not contain alpha channel: ${appStoreIcon}`);
  }
}

const androidPackage = distribute.android && distribute.android.package;
if (!androidPackage) {
  warnings.push('android.package is missing; cannot cross-check Bundle ID naming');
}

console.log('iOS packaging preflight');
console.log(`  manifest: ${manifestPath}`);
console.log(`  versionName: ${manifest.versionName} (versionCode ${manifest.versionCode} is Android-only)`);
console.log(`  Android package: ${androidPackage || '-'}`);
console.log(`  iOS background modes: ${(ios.UIBackgroundModes || []).join(', ') || '-'}`);
console.log(`  iOS icons referenced: ${iconPaths.length}`);

for (const warning of warnings) {
  console.log(`  WARN ${warning}`);
}
for (const error of errors) {
  console.error(`  FAIL ${error}`);
}

if (errors.length) {
  console.error(`\n${errors.length} error(s) found`);
  process.exit(1);
}

console.log('\nAll iOS packaging checks passed');
