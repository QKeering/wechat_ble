#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const distRoot = join(process.cwd(), 'dist', 'build', 'mp-weixin');
const appJsonPath = join(distRoot, 'app.json');
const EXPECTED_BUILD_TAG = 'rw-visible-build-tag-20260720-2048';
const MAIN_PACKAGE_SIZE_LIMIT_BYTES = 2 * 1024 * 1024;
const ANY_BUILD_TAG_RE = /rw-visible-build-tag-\d{8}-\d+/g;

if (!existsSync(appJsonPath)) throw new Error(`mp-weixin artifact is missing app.json: ${appJsonPath}`);

const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
const pages = new Set(appJson.pages || []);
const subPackageRoutes = new Set((appJson.subPackages || []).flatMap((group) => (group.pages || []).map((page) => `${group.root}/${page}`)));
const routes = new Set([...pages, ...subPackageRoutes]);
const subPackageRoots = (appJson.subPackages || []).map((group) => `${group.root || ''}`.replace(/\\/g, '/').replace(/\/?$/, '/'));

const collectFiles = (dir) => {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) files.push(...collectFiles(fullPath));
    else files.push({ path: fullPath, size: stat.size });
  }
  return files;
};

const isInSubPackage = (filePath) => {
  const rel = relative(distRoot, filePath).replace(/\\/g, '/');
  return subPackageRoots.some((root) => rel.startsWith(root));
};

const artifactFiles = collectFiles(distRoot);
const mainPackageBytes = artifactFiles.filter((file) => !isInSubPackage(file.path)).reduce((sum, file) => sum + file.size, 0);
if (mainPackageBytes > MAIN_PACKAGE_SIZE_LIMIT_BYTES) {
  throw new Error(`mp-weixin main package exceeds 2MB limit: ${mainPackageBytes} bytes > ${MAIN_PACKAGE_SIZE_LIMIT_BYTES} bytes`);
}

const requiredRoutes = [
  'pages/awareness/awareness',
  'pages/health/health',
  'pages/mine/mine',
  'pagesA/mines/connectDevice',
  'pagesA/mines/device',
  'pagesA/mines/profile',
  'pagesA/mines/editNickname',
  'homeDetail/sleepPage/sleepPage',
  'homeDetail/exercise/exercise',
  'homeDetail/relaxStatus/relaxStatus',
  'homeDetail/vitalSigns/vitalSigns',
  'homeDetail/vitalSignsEdit/vitalSignsEdit',
  'homeDetail/vitalSignsHeartDetail/vitalSignsDetail',
  'homeDetail/vitalSignsHeartDetail/oxyGenDetail',
  'homeDetail/vitalSignsHeartDetail/temperatureDetail',
  'homeDetail/vitalSignsHeartDetail/heartRateVariabilityDetail'
];

for (const route of requiredRoutes) {
  if (!routes.has(route)) throw new Error(`mp-weixin artifact is missing required route: ${route}`);
}

for (const route of routes) {
  for (const extension of ['js', 'json', 'wxml']) {
    const artifactPath = join(distRoot, `${route}.${extension}`);
    if (!existsSync(artifactPath)) throw new Error(`mp-weixin artifact is missing built route file: ${route}.${extension}`);
  }
}

const mineBundle = join(distRoot, 'pages/mine/mine.js');
if (!existsSync(mineBundle)) throw new Error('mp-weixin mine bundle is missing');

const metricFallbackBundle = join(distRoot, 'homeDetail/vitalSignsHeartDetail/metricFallback.js');
if (!existsSync(metricFallbackBundle)) throw new Error('mp-weixin vitalSignsHeartDetail metricFallback bundle is missing');

const staleTags = [];
let expectedBuildTagFound = false;
for (const file of artifactFiles) {
  const rel = relative(distRoot, file.path).replace(/\\/g, '/');
  if (!/\.(js|json|wxml|wxss)$/.test(rel)) continue;
  const tags = readFileSync(file.path, 'utf8').match(ANY_BUILD_TAG_RE) || [];
  if (tags.includes(EXPECTED_BUILD_TAG)) expectedBuildTagFound = true;
  staleTags.push(...tags.filter((tag) => tag !== EXPECTED_BUILD_TAG));
}
if (!expectedBuildTagFound) throw new Error(`mp-weixin artifact missing ${EXPECTED_BUILD_TAG}`);
if (staleTags.length > 0) throw new Error(`mp-weixin artifact contains stale build tags: ${[...new Set(staleTags)].join(', ')}`);

console.log(`mp-weixin artifact verified. main package ${mainPackageBytes} bytes, headroom ${MAIN_PACKAGE_SIZE_LIMIT_BYTES - mainPackageBytes} bytes.`);







