<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app';
import { useRingBLE } from '@/composables/useRingBLE';
import { useRingBusinessController } from '@/composables/useRingBusinessController';
import { useUserStore } from '@/stores/user';
import { refreshAppForegroundSessionId } from '@/utils/appForegroundSession';

onLaunch(() => {
  // 使用 showErrorToast() 显式控制错误提示，不再需要全局 monkey-patch
});

onShow(() => {
  refreshAppForegroundSessionId();
  setTimeout(() => {
    try {
      const { initBluetooth, registerGlobalListeners } = useRingBLE();
      const { resumeBusinessAutoRefresh, restoreLastBusinessDevice } = useRingBusinessController();
      Promise.resolve(initBluetooth())
        .then(async () => {
          await registerGlobalListeners();
          resumeBusinessAutoRefresh();
          return restoreLastBusinessDevice({ refreshAfterRestore: false });
        })
        .catch(() => undefined);
    } catch (error) {
      void error;
    }
  }, 0);
});

onHide(() => {
  try {
    const { pauseBusinessAutoRefresh } = useRingBusinessController();
    pauseBusinessAutoRefresh();
    const userStore = useUserStore();
    userStore.updateIsBluetoothReady(false);
  } catch (error) {
    void error;
  }
});
</script>

<style lang="scss">
@import '@/uni_modules/uv-ui-tools/index.scss';
@import '@/styles/utils.scss';
@import '@/styles/agent.scss';

page {
  color: #010101;
  background-color: #f1f3f6;
  min-height: 100vh;
  font-size: 28rpx;
  font-weight: 400;
  font-family: 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
}

:deep(.uv-navbar) {
  z-index: 999 !important;

  .uv-navbar__content {
    pointer-events: auto !important;
  }

  .uv-navbar__left {
    pointer-events: auto !important;
    position: relative !important;
    z-index: 1000 !important;

    .uv-navbar__left__content {
      pointer-events: auto !important;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      min-height: 44px;

      .uv-icon {
        pointer-events: auto !important;
      }
    }
  }

  .uv-navbar__center {
    pointer-events: none !important;
  }

  .uv-navbar__right {
    pointer-events: auto !important;
  }
}

@media (harmonyos) {
  :deep(.uv-navbar__left__content) {
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }
}
</style>
