import App from './App.vue';
import { createSSRApp } from 'vue';
import * as Pinia from 'pinia';
import uvUI from '@/uni_modules/uv-ui-tools';
import { Request } from '@/utils/request/index.js';
import share from './common/share.js';

const NAVIGATE_TO_DEDUP_MS = 1500;

let navigateGuardInstalled = false;
let lastNavigateKey = '';
let lastNavigateAt = 0;

const normalizeNavigateKey = (url?: string) => String(url || '').replace(/^\/+/, '');

const getCurrentTopRoute = () => {
  try {
    const pages = getCurrentPages?.() || [];
    const top = pages[pages.length - 1] as any;
    return String(top?.route || '').replace(/^\/+/, '');
  } catch {
    return '';
  }
};

const callNavigateCallback = (callback: unknown, payload: Record<string, unknown>) => {
  if (typeof callback === 'function') {
    try {
      callback(payload);
    } catch {
      // ignore callback errors
    }
  }
};

const installNavigateToDedupGuard = () => {
  if (navigateGuardInstalled || typeof uni === 'undefined' || typeof (uni as any).navigateTo !== 'function') return;
  navigateGuardInstalled = true;
  const originalNavigateTo = (uni as any).navigateTo.bind(uni);

  (uni as any).navigateTo = (options: any = {}) => {
    const key = normalizeNavigateKey(options?.url);
    const path = key.split('?')[0];
    const currentTopRoute = getCurrentTopRoute();
    const now = Date.now();
    const duplicate =
      (path && currentTopRoute && path === currentTopRoute) ||
      (key && key === lastNavigateKey && now - lastNavigateAt < NAVIGATE_TO_DEDUP_MS);

    if (duplicate) {
      const payload = { errMsg: 'navigateTo:fail duplicate navigation ignored', url: options?.url };
      callNavigateCallback(options?.complete, payload);
      return undefined;
    }

    lastNavigateKey = key;
    lastNavigateAt = now;

    return originalNavigateTo({
      ...options,
      fail: (result: any) => {
        lastNavigateKey = '';
        lastNavigateAt = 0;
        options?.fail?.(result);
      },
      complete: (result: any) => {
        setTimeout(() => {
          if (lastNavigateKey === key) {
            lastNavigateKey = '';
            lastNavigateAt = 0;
          }
        }, NAVIGATE_TO_DEDUP_MS);
        options?.complete?.(result);
      }
    });
  };
};

export function createApp() {
  const app = createSSRApp(App);
  app.use(Pinia.createPinia());
  app.use(uvUI);
  app.mixin(share);
  installNavigateToDedupGuard();
  Request();

  return {
    app,
    Pinia
  };
}
