#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const EXPECTED_BUILD_TAG = 'rw-visible-build-tag-20260720-2048';
const ANY_BUILD_TAG_RE = /rw-visible-build-tag-\d{8}-\d+/g;
const distRoot = join(process.cwd(), 'dist', 'build', 'mp-weixin');
const appJsonPath = join(distRoot, 'app.json');
const releaseDocs = [
  join(process.cwd(), 'docs', 'RING_BLE_RELEASE_CHECKLIST.md'),
  join(process.cwd(), 'docs', 'RW_TEST_RELEASE_2026-07-20.md'),
  join(process.cwd(), 'docs', 'RW_TEST_UPLOAD_GUIDE_2026-07-20.md')
];

const visibleNonMineMarkers = [
  '复制日志',
  '清空日志',
  '未适命令自检',
  'RW 读取测试',
  'RW 冒烟测试',
  'RW诊断',
  '诊断：',
  'rw-visible-build-tag',
  '可点击测试'
];

const encodedArrowMarkers = ['&gt;', '&lt;'];

const collectFiles = (dir) => {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) files.push(...collectFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
};

const readText = (filePath) => readFileSync(filePath, 'utf8');
const rel = (filePath) => relative(process.cwd(), filePath).replace(/\\/g, '/');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(existsSync(appJsonPath), `mp-weixin artifact is missing app.json: ${appJsonPath}`);

const appJson = JSON.parse(readText(appJsonPath));
const routes = [
  ...(appJson.pages || []),
  ...(appJson.subPackages || []).flatMap((group) =>
    (group.pages || []).map((page) => `${`${group.root || ''}`.replace(/\/$/, '')}/${page}`)
  )
].filter(Boolean);

for (const route of routes) {
  for (const extension of ['js', 'wxml', 'json']) {
    const routeFile = join(distRoot, `${route}.${extension}`);
    assert(existsSync(routeFile), `built route file is missing: ${rel(routeFile)}`);
  }
}

const artifactFiles = collectFiles(distRoot).filter((file) => /\.(js|json|wxml|wxss)$/.test(file));
let expectedBuildTagFound = false;
const staleTags = new Set();
for (const file of artifactFiles) {
  const tags = readText(file).match(ANY_BUILD_TAG_RE) || [];
  if (tags.includes(EXPECTED_BUILD_TAG)) expectedBuildTagFound = true;
  tags.filter((tag) => tag !== EXPECTED_BUILD_TAG).forEach((tag) => staleTags.add(tag));
}
assert(expectedBuildTagFound, `artifact does not contain expected build tag: ${EXPECTED_BUILD_TAG}`);
assert(staleTags.size === 0, `artifact contains stale build tags: ${[...staleTags].join(', ')}`);

const nonMineVisibleFiles = artifactFiles.filter((file) => {
  const relativePath = relative(distRoot, file).replace(/\\/g, '/');
  return /\.(wxml|json)$/.test(relativePath) && !relativePath.startsWith('pages/mine/mine.');
});

const visibleMarkerHits = [];
for (const file of nonMineVisibleFiles) {
  const text = readText(file);
  for (const marker of visibleNonMineMarkers) {
    if (text.includes(marker)) visibleMarkerHits.push(`${rel(file)} -> ${marker}`);
  }
}
assert(
  visibleMarkerHits.length === 0,
  `formal pages contain visible RW diagnostic/test markers:\n${visibleMarkerHits.slice(0, 20).join('\n')}`
);

const arrowHits = [];
for (const file of artifactFiles.filter((file) => file.endsWith('.wxml'))) {
  const text = readText(file);
  for (const marker of encodedArrowMarkers) {
    if (text.includes(marker)) arrowHits.push(`${rel(file)} -> ${marker}`);
  }
}
assert(arrowHits.length === 0, `built WXML contains encoded arrow text:\n${arrowHits.slice(0, 20).join('\n')}`);

const staticRefs = [];
for (const file of artifactFiles) {
  const text = readText(file);
  for (const match of text.matchAll(/["'](\/static\/[^"']+)["']/g)) {
    staticRefs.push({ file, ref: match[1] });
  }
}
const missingStaticRefs = staticRefs.filter(({ ref }) => !existsSync(join(distRoot, ref.replace(/^\//, ''))));
assert(
  missingStaticRefs.length === 0,
  `built artifact contains missing static refs:\n${missingStaticRefs
    .slice(0, 20)
    .map((item) => `${rel(item.file)} -> ${item.ref}`)
    .join('\n')}`
);

for (const docPath of releaseDocs) {
  assert(existsSync(docPath), `release doc is missing: ${rel(docPath)}`);
  const text = readText(docPath);
  assert(text.includes(EXPECTED_BUILD_TAG), `release doc missing expected build tag: ${rel(docPath)}`);
  const staleDocTags = [...new Set((text.match(ANY_BUILD_TAG_RE) || []).filter((tag) => tag !== EXPECTED_BUILD_TAG))];
  assert(staleDocTags.length === 0, `release doc contains stale build tags: ${rel(docPath)} -> ${staleDocTags.join(', ')}`);
}

const mineBundle = join(distRoot, 'pages', 'mine', 'mine.js');
assert(existsSync(mineBundle), 'mine bundle is missing');
const mineText = readText(mineBundle);
assert(mineText.includes(EXPECTED_BUILD_TAG), 'mine page does not contain current RW build tag');
assert(mineText.includes('清空日志'), 'mine page diagnostic log controls are unexpectedly missing');

console.log(
  [
    `RW test release audit passed: ${EXPECTED_BUILD_TAG}`,
    `routes=${routes.length}`,
    `staticRefs=${staticRefs.length}`,
    `formalVisibleMarkerHits=0`,
    `docs=${releaseDocs.map((file) => rel(file)).join(', ')}`
  ].join('\n')
);
