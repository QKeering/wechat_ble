import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const distRoot = join(process.cwd(), 'dist', 'build', 'mp-weixin');
const appJsonPath = join(distRoot, 'app.json');
const MAIN_PACKAGE_SIZE_LIMIT_BYTES = 2 * 1024 * 1024;

if (!existsSync(appJsonPath)) {
  throw new Error(`mp-weixin artifact is missing app.json: ${appJsonPath}`);
}

const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
const subPackageRoots = (appJson.subPackages || []).map((group) =>
  `${group.root || ''}`.replace(/\\/g, '/').replace(/\/?$/, '/')
);

const collectFiles = (dir) => {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else {
      const rel = relative(distRoot, fullPath).replace(/\\/g, '/');
      files.push({ path: fullPath, rel, size: stat.size });
    }
  }
  return files;
};

const isInSubPackage = (rel) => subPackageRoots.some((root) => rel.startsWith(root));
const formatKB = (bytes) => `${Math.round(bytes / 1024)} KB`;

const files = collectFiles(distRoot);
const mainFiles = files.filter((file) => !isInSubPackage(file.rel));
const mainPackageBytes = mainFiles.reduce((sum, file) => sum + file.size, 0);
const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
const headroomBytes = MAIN_PACKAGE_SIZE_LIMIT_BYTES - mainPackageBytes;

console.log(`mp-weixin dist: ${distRoot}`);
console.log(`subPackages: ${subPackageRoots.join(', ') || '(none)'}`);
console.log(`main package: ${mainPackageBytes} bytes (${formatKB(mainPackageBytes)})`);
console.log(`main package limit: ${MAIN_PACKAGE_SIZE_LIMIT_BYTES} bytes (${formatKB(MAIN_PACKAGE_SIZE_LIMIT_BYTES)})`);
console.log(`main package headroom: ${headroomBytes} bytes (${formatKB(headroomBytes)})`);
console.log(`total artifact: ${totalBytes} bytes (${formatKB(totalBytes)})`);
console.log('');
console.log('largest main-package files:');
for (const file of mainFiles.sort((a, b) => b.size - a.size).slice(0, 30)) {
  console.log(`${String(Math.round(file.size / 1024)).padStart(5)} KB  ${file.rel}`);
}

if (mainPackageBytes > MAIN_PACKAGE_SIZE_LIMIT_BYTES) {
  process.exitCode = 1;
}
