// 副作用引入：注册主包语言包（分包页面改用各自分包里的 pack）。
import './packs';
// 副作用引入：语言切换时同步原生 tabBar。
import './tabBar';

export {
  APP_LOCALE_CHANGED,
  DEFAULT_LOCALE,
  getLocale,
  getLocaleMode,
  getSystemLocale,
  initI18n,
  locale,
  localeMode,
  onLocaleChange,
  refreshSystemLocale,
  setLocaleMode,
  systemLocale,
  t,
  te,
  tt,
  useI18n
} from './core';
export type { I18nContext } from './core';
export { normalizeSystemLanguage, resolveSystemLocale } from './systemLocale';
export { usePageTitle } from './pageTitle';
export { syncTabBarLocale } from './tabBar';
export type { AppLocale, LocaleMode, MessageDict, MessageParams, MessageValue, PluralMessage } from './types';
