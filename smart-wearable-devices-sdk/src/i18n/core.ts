import { shallowRef } from 'vue';
import type { Ref } from 'vue';
import { getCatalog } from './registry';
import { resolveSystemLocale } from './systemLocale';
import type { AppLocale, LocaleMode, MessageParams, MessageValue } from './types';

export const APP_LOCALE_CHANGED = 'qkeer:locale-changed';

const STORAGE_KEY = 'qkeer:locale-mode:v1';

export const DEFAULT_LOCALE: AppLocale = 'zh-Hans';

export interface I18nState {
  locale: Ref<AppLocale>;
  mode: Ref<LocaleMode>;
  systemLocale: Ref<AppLocale>;
  initialized: boolean;
  listeners: Set<(locale: AppLocale) => void>;
}

type I18nGlobalScope = typeof globalThis & {
  __QKEER_I18N__?: I18nState;
};

const createState = (): I18nState => ({
  locale: shallowRef<AppLocale>(DEFAULT_LOCALE),
  mode: shallowRef<LocaleMode>('system'),
  systemLocale: shallowRef<AppLocale>(DEFAULT_LOCALE),
  initialized: false,
  listeners: new Set()
});

// 微信小程序分包可能各自打包一份模块代码，用 globalThis 单例保证语言状态不分叉。
const globalScope = (typeof globalThis !== 'undefined' ? globalThis : {}) as I18nGlobalScope;
const state: I18nState = (globalScope.__QKEER_I18N__ ??= createState());

export const locale: Ref<AppLocale> = state.locale;
export const localeMode: Ref<LocaleMode> = state.mode;
export const systemLocale: Ref<AppLocale> = state.systemLocale;

const isLocaleMode = (value: unknown): value is LocaleMode => value === 'system' || value === 'zh-Hans' || value === 'zh-Hant' || value === 'en';

const readStoredMode = (): LocaleMode => {
  try {
    const stored = uni.getStorageSync(STORAGE_KEY);
    return isLocaleMode(stored) ? stored : 'system';
  } catch (error) {
    void error;
    return 'system';
  }
};

const writeStoredMode = (mode: LocaleMode): void => {
  try {
    uni.setStorageSync(STORAGE_KEY, mode);
  } catch (error) {
    // 存储不可用时仅本次会话生效，不阻断切换。
    void error;
  }
};

const syncNativeLocale = (value: AppLocale): void => {
  try {
    (uni as any).setLocale?.(value);
  } catch (error) {
    // 部分小程序基础库不支持 setLocale。
    void error;
  }
};

const selectMessage = (value: MessageValue | undefined, params?: MessageParams): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  const count = Number(params?.count);
  if (Number.isFinite(count) && count === 1 && value.one) return value.one;
  return value.other;
};

const interpolate = (text: string, params?: MessageParams): string => {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (matched, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? matched : String(value);
  });
};

/**
 * 翻译。key 默认就是简体中文原文；缺失时原样返回，方便分批迁移。
 */
export function t(key: string, params?: MessageParams): string {
  if (!key) return '';
  const catalog = getCatalog(state.locale.value);
  return interpolate(selectMessage(catalog[key], params) ?? key, params);
}

/** 当前语言是否已有该 key 的翻译。 */
export function te(key: string): boolean {
  return getCatalog(state.locale.value)[key] !== undefined;
}

/**
 * 展示边界翻译：只翻译已知 key，未知文本（服务端文案、用户输入）原样返回。
 */
export function tt(value: string, params?: MessageParams): string {
  return value ? t(value, params) : value;
}

const resolveMode = (mode: LocaleMode): AppLocale => (mode === 'system' ? state.systemLocale.value : mode);

const notify = (): void => {
  const current = state.locale.value;
  try {
    (uni as any).$emit?.(APP_LOCALE_CHANGED, current);
  } catch (error) {
    void error;
  }
  state.listeners.forEach((listener) => {
    try {
      listener(current);
    } catch (error) {
      void error;
    }
  });
};

export function onLocaleChange(listener: (locale: AppLocale) => void): () => void {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

export function getLocale(): AppLocale {
  return state.locale.value;
}

export function getLocaleMode(): LocaleMode {
  return state.mode.value;
}

export function getSystemLocale(): AppLocale {
  return state.systemLocale.value;
}

/**
 * 在 createApp() 中调用，早于任何页面 setup，保证首屏就是目标语言。
 */
export function initI18n(): AppLocale {
  if (state.initialized) return state.locale.value;
  state.initialized = true;
  state.mode.value = readStoredMode();
  state.systemLocale.value = resolveSystemLocale();
  state.locale.value = resolveMode(state.mode.value);
  syncNativeLocale(state.locale.value);
  return state.locale.value;
}

export function setLocaleMode(next: LocaleMode): AppLocale {
  if (!isLocaleMode(next)) return state.locale.value;
  if (state.mode.value === next) return state.locale.value;
  state.mode.value = next;
  writeStoredMode(next);
  state.systemLocale.value = resolveSystemLocale();
  state.locale.value = resolveMode(next);
  syncNativeLocale(state.locale.value);
  notify();
  return state.locale.value;
}

/**
 * 仅当用户选择「跟随系统」时重新识别系统语言；系统语言变化时通知界面刷新。
 */
export function refreshSystemLocale(): AppLocale {
  const nextSystemLocale = resolveSystemLocale();
  state.systemLocale.value = nextSystemLocale;
  if (state.mode.value !== 'system') return state.locale.value;
  if (state.locale.value === nextSystemLocale) return state.locale.value;
  state.locale.value = nextSystemLocale;
  syncNativeLocale(nextSystemLocale);
  notify();
  return nextSystemLocale;
}

export interface I18nContext {
  locale: Readonly<Ref<AppLocale>>;
  mode: Readonly<Ref<LocaleMode>>;
  systemLocale: Readonly<Ref<AppLocale>>;
  t: typeof t;
  te: typeof te;
  tt: typeof tt;
  setLocaleMode: typeof setLocaleMode;
}

export function useI18n(): I18nContext {
  return {
    locale,
    mode: localeMode,
    systemLocale,
    t,
    te,
    tt,
    setLocaleMode
  };
}
