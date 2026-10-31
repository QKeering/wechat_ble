import type { AppLocale, MessageDict, MessageValue } from './types';

export type Catalog = Record<string, MessageValue>;

const catalogs: Record<AppLocale, Catalog> = {
  'zh-Hans': {},
  'zh-Hant': {},
  en: {}
};

export function getCatalog(locale: AppLocale): Catalog {
  return catalogs[locale];
}

const isValidMessage = (value: MessageValue | undefined): boolean => {
  if (typeof value === 'string') return value.length > 0;
  return Boolean(value && typeof value.other === 'string' && value.other.length > 0);
};

/**
 * 合并一个语言包。重复 key 保留先注册的值，由 `npm run i18n:check` 报告冲突。
 */
export function registerMessages(locale: AppLocale, messages: MessageDict): void {
  const target = catalogs[locale];
  Object.keys(messages).forEach((key) => {
    const value = messages[key];
    if (!isValidMessage(value)) return;
    if (target[key] === undefined) {
      target[key] = value;
    }
  });
}
