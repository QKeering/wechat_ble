#!/usr/bin/env node
/**
 * 校验 t('...') 字面量 key 在 en / zh-Hant 语言包里是否齐全。
 * 只做告警，不阻断构建：分批迁移期间缺失 key 会回退为简体原文。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');

// 分包边界必须与 src/pages.json 的 subPackages[].root 一致：
// src/pagesA 本身不是分包，只有 pagesA/mines 与 pagesA/healths 是。
const PACK_CATALOGS = {
  mines: 'src/pagesA/mines/i18n/locales',
  healths: 'src/pagesA/healths/i18n/locales',
  homeDetail: 'src/homeDetail/i18n/locales',
  family: 'src/pages/family/i18n/locales'
};

const CATALOG_ROOTS = ['src/i18n/locales', ...Object.values(PACK_CATALOGS)];

const CJK_PATTERN = /[㐀-鿿]/;
const KEY_PATTERN = /\btt?\(\s*['"]([^'"]+)['"]/g;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[i18n] 无法解析 ${path.relative(root, file)}: ${error.message}`);
    }
    return {};
  }
};

/**
 * 按分包分别加载语言包：主包始终可用，其余分包仅在其页面内注册。
 * 用于发现「key 存在但落在别的分包里，运行时解析不到」的问题。
 */
const loadPackCatalogs = (locale) => {
  const packs = { main: {}, mines: {}, healths: {}, homeDetail: {}, family: {} };
  const collect = (dir, target) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach((name) => {
      const full = path.join(dir, name);
      if (name === `${locale}.json`) {
        Object.assign(target, readJson(full));
        return;
      }
      if (name === locale && fs.statSync(full).isDirectory()) {
        fs.readdirSync(full).forEach((file) => {
          if (file.endsWith('.json')) Object.assign(target, readJson(path.join(full, file)));
        });
      }
    });
  };
  const mainDir = path.join(root, 'src/i18n/locales', locale);
  if (fs.existsSync(mainDir)) {
    fs.readdirSync(mainDir).forEach((name) => {
      if (name.endsWith('.json')) Object.assign(packs.main, readJson(path.join(mainDir, name)));
    });
  }
  Object.entries(PACK_CATALOGS).forEach(([pack, catalogRoot]) => {
    collect(path.join(root, catalogRoot), packs[pack]);
  });
  return packs;
};

/** 源码目录 → 运行时可用的语言包集合（与 pages.json 的分包根一致） */
const packOfFile = (file) => {
  const rel = path.relative(srcDir, file).split(path.sep).join('/');
  if (rel.startsWith('pagesA/mines/')) return 'mines';
  if (rel.startsWith('pagesA/healths/')) return 'healths';
  if (rel.startsWith('homeDetail/')) return 'homeDetail';
  if (rel.startsWith('pages/family/')) return 'family';
  // src/pagesA 其它目录（如 echartOptions）、components、utils、sdk 等都打进主包
  return 'main';
};

const loadCatalog = (locale) => {
  const merged = {};
  const mainRoot = path.join(root, 'src/i18n/locales');
  const localeDir = path.join(mainRoot, locale);
  if (fs.existsSync(localeDir)) {
    fs.readdirSync(localeDir).forEach((name) => {
      if (name.endsWith('.json')) Object.assign(merged, readJson(path.join(localeDir, name)));
    });
  }
  CATALOG_ROOTS.slice(1).forEach((catalogRoot) => {
    const dir = path.join(root, catalogRoot);
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach((name) => {
      // 支持扁平文件（en.json）与按语言分目录（en/common.json）两种布局。
      if (name === `${locale}.json`) {
        Object.assign(merged, readJson(path.join(dir, name)));
        return;
      }
      const nested = path.join(dir, name);
      if (name === locale && fs.statSync(nested).isDirectory()) {
        fs.readdirSync(nested).forEach((file) => {
          if (file.endsWith('.json')) Object.assign(merged, readJson(path.join(nested, file)));
        });
      }
    });
  });
  return merged;
};

const walk = (dir, out = []) => {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'uni_modules' || entry.name === 'node_modules') return;
      walk(full, out);
      return;
    }
    if (!/\.(vue|ts|js)$/.test(entry.name)) return;
    if (entry.name.endsWith('.parity.ts')) return;
    if (full.startsWith(path.join(srcDir, 'i18n'))) return;
    out.push(full);
  });
  return out;
};

const decodeKey = (raw) =>
  raw
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');

const usedKeys = new Map();
walk(srcDir).forEach((file) => {
  const text = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = KEY_PATTERN.exec(text)) !== null) {
    const key = decodeKey(match[1]);
    if (!key) continue;
    if (!usedKeys.has(key)) usedKeys.set(key, new Set());
    usedKeys.get(key).add(path.relative(root, file));
  }
});

const en = loadCatalog('en');
const zhHant = loadCatalog('zh-Hant');
const zhHans = loadCatalog('zh-Hans');
const enPacks = loadPackCatalogs('en');

const missingEn = [];
const missingZhHant = [];
const missingSemantic = [];
const untranslatedEn = [];
const missingInPack = [];

usedKeys.forEach((files, key) => {
  if (!en[key]) missingEn.push({ key, file: [...files][0] });
  if (!zhHant[key]) missingZhHant.push({ key, file: [...files][0] });
  if (en[key] && CJK_PATTERN.test(String(en[key]))) untranslatedEn.push({ key, value: en[key], file: [...files][0] });
  if (key.startsWith('@') && !zhHans[key]) missingSemantic.push({ key, file: [...files][0] });

  // key 存在但在该页面运行时不可达（落在别的分包），会静默回退成简体原文
  files.forEach((file) => {
    if (key in enPacks.main) return;
    const pack = packOfFile(file);
    if (pack in enPacks && key in enPacks[pack]) return;
    missingInPack.push({ key, pack, file });
  });
});

const report = (title, list, format) => {
  if (!list.length) return;
  console.log(`\n${title} (${list.length})`);
  list.slice(0, 200).forEach((item) => console.log(`  - ${format(item)}`));
  if (list.length > 200) console.log(`  ... 另有 ${list.length - 200} 条`);
};

console.log(`[i18n] 源码中使用的 key: ${usedKeys.size}；en: ${Object.keys(en).length}；zh-Hant: ${Object.keys(zhHant).length}`);
report('英文缺失', missingEn, (item) => `${item.key}  (${item.file})`);
report('繁体缺失', missingZhHant, (item) => `${item.key}  (${item.file})`);
report('en 值仍含中文', untranslatedEn, (item) => `${item.key} => ${item.value}  (${item.file})`);
report('zh-Hans 语义 key 缺失', missingSemantic, (item) => `${item.key}  (${item.file})`);
report('语言包放错分包（运行时解析不到）', missingInPack, (item) => `${item.key} → 需放进主包或 ${item.pack} 包  (${item.file})`);

const total =
  missingEn.length + missingZhHant.length + untranslatedEn.length + missingSemantic.length + missingInPack.length;
console.log(total ? `\n[i18n] 共 ${total} 条待处理（不阻断构建）。` : '\n[i18n] 全部通过。');
