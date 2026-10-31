import { onMounted, onUnmounted, watch } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { locale } from './core';

/**
 * 默认导航栏页面：pages.json 里的标题是静态简体，进入页面后按当前语言覆盖。
 * 用法：usePageTitle(() => t('功能设置'))
 */
export function usePageTitle(getTitle: () => string): void {
  const apply = (): void => {
    try {
      uni.setNavigationBarTitle({ title: getTitle() });
    } catch (error) {
      // H5 首帧导航栏可能未就绪，onShow 时还会再设置一次。
      void error;
    }
  };

  onMounted(apply);
  onShow(apply);
  onUnmounted(watch(locale, apply, { flush: 'post' }));
}
