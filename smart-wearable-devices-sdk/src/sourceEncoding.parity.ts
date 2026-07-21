import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const projectRoot = process.cwd();
const sourceRoot = join(projectRoot, 'src');
const ignoredPathParts = new Set(['uni_modules']);
const checkedExtensions = new Set(['.js', '.json', '.md', '.ts', '.vue']);
const fromCodePoints = (...values: number[]) => String.fromCodePoint(...values);
const mojibakeSentinels = [
  // Common page-visible mojibake from business pages: today, choose date, page titles, edit card, refresh errors.
  fromCodePoints(0x6d60, 0x5a42, 0x3049),
  fromCodePoints(0x95ab, 0x590b, 0x5ae8),
  fromCodePoints(0x93c3, 0x30e6, 0x6e61),
  fromCodePoints(0x7f02, 0x682c, 0x7deb, 0x9357, 0xff04, 0x5896),
  fromCodePoints(0x9352, 0x950b, 0x67ca, 0x6fb6, 0x8fab, 0x89e6),
  fromCodePoints(0x9422, 0x71b7, 0x61e1, 0x6d63, 0x64b3, 0x7ddb),
  fromCodePoints(0x942b, 0xff04, 0x6e62),
  fromCodePoints(0x5a32, 0x8bf2, 0x59e9),
  fromCodePoints(0x93c0, 0x70ac, 0x6f97, 0x9418, 0x8235, 0x20ac),
  fromCodePoints(0x741b, 0x20ac, 0x7eef),
  fromCodePoints(0x741b, 0x20ac, 0x9358),
  fromCodePoints(0x63b3, 0x43),
  fromCodePoints(0x93c8),
  fromCodePoints(0x934f),
  fromCodePoints(0x9428, 0x52ee, 0x8a),
  `${fromCodePoints(0x765b)}W`,
  `${fromCodePoints(0xe64f)}D`,
  fromCodePoints(0x63b3, 0x43),
  fromCodePoints(0x93ba, 0x77ef),
  fromCodePoints(0x93c8, 0xe045, 0x6),
  fromCodePoints(0x934f, 0x547, 0x96fb),
  fromCodePoints(0x6d63, 0x256),
  fromCodePoints(0x5a34, 0x5b2e),
  fromCodePoints(0x7efb, 0x4f5),
  fromCodePoints(0x93b7, 0xfe31, 0x62e6, 0x622a),
  fromCodePoints(0x934d, 0x5db6, 0x7c32),
  fromCodePoints(0x6f36, 0x52fe, 0x60ca, 0x93c8),
  fromCodePoints(0x95ba, 0x5831, 0x4e9d, 0x6f79),
  fromCodePoints(0x6fb6, 0x8fab, 0x89e6),
  fromCodePoints(0x93b5, 0xe0a3, 0x5f3f),
  fromCodePoints(0x95b2, 0x5d88, 0x7e5b),
  fromCodePoints(0x9350, 0x6b0f, 0x53c6),
  fromCodePoints(0x68e3, 0x682d),
  fromCodePoints(0x934b, 0x30e5, 0x608d),
  fromCodePoints(0x93b4, 0x6220, 0x6b91),
  fromCodePoints(0x7481, 0x60e7),
  fromCodePoints(0x59ab, 0x20ac, 0x5a34),
  fromCodePoints(0x93c5, 0x9e3f),
  fromCodePoints(0x93b0, 0x71ba, 0x7161),
  fromCodePoints(0x6d60, 0x5a42, 0x3049),
  fromCodePoints(0x95ab, 0x590b, 0x5ae8),
  fromCodePoints(0x93c3, 0x30e6, 0x6e61),
  fromCodePoints(0x93b5, 0x2541, 0x774d),
  fromCodePoints(0x741b, 0x20ac, 0x7eef),
  fromCodePoints(0x741b, 0x20ac, 0x9358),
  fromCodePoints(0x7f02, 0x682c, 0x7deb),
  fromCodePoints(0x59dd, 0xff45, 0x6e6a),
  fromCodePoints(0x6fb6, 0x52ed, 0x608a),
  fromCodePoints(0x9352, 0x950b, 0x67ca),
  fromCodePoints(0x6d93, 0x5a41, 0x7d36),
  fromCodePoints(0x9422, 0x71b7, 0x61e1, 0x6d63, 0x64b3, 0x7ddb),
  fromCodePoints(0x9354, 0x71bb, 0x5158, 0x947f, 0x6ec3, 0x5d1f),
  fromCodePoints(0x9352, 0x6fc6),
  fromCodePoints(0x7481, 0x5267),
  fromCodePoints(0x7459, 0xff46),
  fromCodePoints(0x9477),
  fromCodePoints(0x9427, 0x8bf2),
  fromCodePoints(0x7f03, 0x6220),
  fromCodePoints(0x947e, 0x5cf0, 0x5f47, 0x7f01, 0x621d, 0x757e, 0x6dc7, 0x2103, 0x4f05),
  fromCodePoints(0x765b),
  fromCodePoints(0xe64f),
  fromCodePoints(0x941c),
  fromCodePoints(0x952b),
  fromCodePoints(0x95b2)
];

const hasCheckedExtension = (filePath: string) => {
  return [...checkedExtensions].some((extension) => filePath.endsWith(extension));
};

const shouldIgnore = (filePath: string) => {
  if (filePath.endsWith('sourceEncoding.parity.ts')) return true;
  return relative(sourceRoot, filePath)
    .split(/[\\/]/)
    .some((part) => ignoredPathParts.has(part));
};

const findEncodingIssues = (dir: string): string[] => {
  const issues: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (shouldIgnore(fullPath)) continue;

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      issues.push(...findEncodingIssues(fullPath));
      continue;
    }

    if (!hasCheckedExtension(fullPath)) continue;

    const source = readFileSync(fullPath, 'utf8');
    source.split(/\r?\n/).forEach((line, index) => {
      const matched = mojibakeSentinels.find((sentinel) => line.includes(sentinel));
      if (!matched) return;
      issues.push(`${relative(projectRoot, fullPath)}:${index + 1}: ${matched}`);
    });
  }

  return issues;
};

const issues = findEncodingIssues(sourceRoot);

if (issues.length > 0) {
  throw new Error(`Source files contain mojibake text that can leak into pages or protocol status copy:\n${issues.join('\n')}`);
}

export const sourceEncodingParityPassed = true;
