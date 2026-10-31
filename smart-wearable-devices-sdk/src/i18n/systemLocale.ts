import type { AppLocale } from './types';

export const FALLBACK_SYSTEM_LOCALE: AppLocale = 'zh-Hans';

const TRADITIONAL_PATTERN = /(?:^|[-_])(hant|tw|hk|mo)(?:$|[-_])/i;

/**
 * 把 BCP-47 / 平台语言标识归一化为 App 支持的三种语言。
 * - zh-TW / zh-HK / zh-MO / zh-Hant → 繁体
 * - 其他 zh* → 简体
 * - 非中文 → 英文
 */
export function normalizeSystemLanguage(raw: unknown): AppLocale | null {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (!value) return null;
  if (value.startsWith('zh')) {
    return TRADITIONAL_PATTERN.test(value) ? 'zh-Hant' : 'zh-Hans';
  }
  return 'en';
}

const readSystemLanguage = (): string => {
  try {
    const baseInfo = (uni as any).getAppBaseInfo?.();
    if (baseInfo?.language) return String(baseInfo.language);
  } catch (error) {
    void error;
  }
  try {
    const systemInfo = (uni as any).getSystemInfoSync?.();
    if (systemInfo?.language) return String(systemInfo.language);
  } catch (error) {
    void error;
  }
  // #ifdef H5
  try {
    if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  } catch (error) {
    void error;
  }
  // #endif
  // 注意：uni.setLocale() 之后 getLocale() 返回的是 App 自己设置的语言，
  // 因此它只能作为最后兜底，不能当作系统语言的主要来源。
  try {
    const uniLocale = (uni as any).getLocale?.();
    if (uniLocale) return String(uniLocale);
  } catch (error) {
    void error;
  }
  return '';
};

export function resolveSystemLocale(): AppLocale {
  return normalizeSystemLanguage(readSystemLanguage()) ?? FALLBACK_SYSTEM_LOCALE;
}
