import { onLocaleChange, t } from './core';

/**
 * tabBar 文案仍写在 pages.json 里，运行时按当前语言覆盖。
 * 顺序与 pages.json 的 list 一致：0 感知 / 1 健康 / 2 我的。
 */
const TAB_BAR_KEYS = ['感知', '健康', '我的'];

let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    applyTabBarText();
  }, 50);
}

function applyTabBarText(): void {
  TAB_BAR_KEYS.forEach((key, index) => {
    try {
      uni.setTabBarItem({
        index,
        text: t(key),
        fail: scheduleRetry
      });
    } catch (error) {
      // App 启动首帧 tabBar 可能尚未就绪，重试一次即可。
      void error;
      scheduleRetry();
    }
  });
}

export function syncTabBarLocale(): void {
  applyTabBarText();
}

onLocaleChange(syncTabBarLocale);
