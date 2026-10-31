<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app';
import { useRingBLE } from '@/composables/useRingBLE';
import { useRingBusinessController } from '@/composables/useRingBusinessController';
import { useUserStore } from '@/stores/user';
import { refreshAppForegroundSessionId } from '@/utils/appForegroundSession';
import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';
import { QKEER_BUILD_INFO } from '@/utils/buildInfo';
import { refreshSystemLocale, syncTabBarLocale } from '@/i18n';
import {
  cancelDeferredRingBackgroundDisconnect,
  getRingBackgroundCriticalTasks,
  runOrDeferRingBackgroundDisconnect
} from '@/utils/ringBackgroundTasks';

let launchedFromFamilyEntry = false;

const isFamilyLaunchOptions = (entry: any) => {
  const entryPath = String(entry?.path || entry?.route || '').replace(/^\//, '');
  if (entryPath.startsWith('pages/family/')) return true;
  const query = entry?.query || {};
  const scene = (() => {
    try {
      return decodeURIComponent(String(query.scene || entry?.sceneValue || ''));
    } catch {
      return String(query.scene || entry?.sceneValue || '');
    }
  })();
  // Family mini-program codes use scene=i=INVITECODE. Device QR entries do
  // not use this shape, so this does not suppress BLE for device binding.
  return /(?:^|[?&])i=[a-z0-9]{6,16}(?:$|[&#])/i.test(scene);
};

const isFamilyEntry = (hookOptions?: any) => {
  try {
    const runtime = uni as any;
    if (isFamilyLaunchOptions(hookOptions)) return true;
    const entry = runtime.getEnterOptionsSync?.() || runtime.getLaunchOptionsSync?.() || {};
    if (isFamilyLaunchOptions(entry)) return true;
    const pages = runtime.getCurrentPages?.() || [];
    const currentRoute = String(pages[pages.length - 1]?.route || '').replace(/^\//, '');
    return currentRoute.startsWith('pages/family/');
  } catch {
    return false;
  }
};

onLaunch((options: any) => {
  launchedFromFamilyEntry = isFamilyEntry(options);
  appendRingDiagnosticLog('APP', 'build-version', QKEER_BUILD_INFO);
  // 使用 showErrorToast() 显式控制错误提示，不再需要全局 monkey-patch
});

onShow((options: any) => {
  // 回到前台：取消后台挂起的断连，并恢复被暂停的自动重连。
  cancelDeferredRingBackgroundDisconnect();
  const activeBackgroundTasks = getRingBackgroundCriticalTasks();
  appendRingDiagnosticLog('APP', 'app-show', {
    familyEntry: launchedFromFamilyEntry || isFamilyEntry(options),
    pendingBackgroundTasks: activeBackgroundTasks
  });
  // 关键任务（OTA/历史同步/全面测量）还持有 BLE 链路时不能恢复自动重连：
  // 尤其是 OTA，回来后 resume 会立刻去连业务设备，跟 BOOT 升级抢链路。
  if (activeBackgroundTasks.length === 0) {
    try {
      useRingBLE().resumeRuntimeRecovery();
    } catch (error) {
      appendRingDiagnosticLog('APP', 'app-show-resume-error', {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  } else {
    appendRingDiagnosticLog('APP', 'app-show-resume-skipped', {
      activeBackgroundTasks
    });
  }
  // 早于 BLE 分支：家人页也要跟随系统语言刷新，并保证 tabBar 文案正确。
  refreshSystemLocale();
  syncTabBarLocale();
  refreshAppForegroundSessionId();
  // Family invitation and care pages are pure network flows. They must never
  // request Bluetooth/privacy authorization just because the mini program opened.
  if (launchedFromFamilyEntry || isFamilyEntry(options)) return;
  if (activeBackgroundTasks.length > 0) {
    // 任务自己负责连接/重连；前台恢复回连上次设备只会和它抢链路。
    appendRingDiagnosticLog('APP', 'app-show-restore-skipped', {
      activeBackgroundTasks
    });
    return;
  }
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

    // 先停掉自动重连，避免后台继续扫描/重连。
    const ring = useRingBLE();
    ring.suspendRuntimeRecovery();
    const activeBackgroundTasks = getRingBackgroundCriticalTasks();
    appendRingDiagnosticLog('APP', 'app-hide', {
      activeBackgroundTasks,
      pendingDeviceId: ring.deviceInfo.value?.deviceId || '',
      connected: ring.isConnected.value
    });
    // 不等定时器：微信小程序和 iOS 切后台后 JS 定时器会被冻结，
    // 延迟断连永远不会执行。没有关键任务就立刻释放；有关键任务则等
    // token 全部释放后再执行（由 ringBackgroundTasks 负责）。
    runOrDeferRingBackgroundDisconnect(() => {
      const currentRing = useRingBLE();
      appendRingDiagnosticLog('APP', 'background-ring-release', {
        pendingDeviceId: currentRing.deviceInfo.value?.deviceId || '',
        connected: currentRing.isConnected.value,
        scanning: currentRing.isScanning.value
      });
      // 后台不保留扫描，也不允许未完成的连接尝试在后台连上。
      // disconnect() 会让在途尝试失效，其完成回调会自行关闭物理链路。
      void currentRing.stopScan().catch(() => undefined);
      void currentRing.disconnect().catch((error) => {
        appendRingDiagnosticLog('APP', 'background-ring-release-error', {
          message: error instanceof Error ? error.message : String(error)
        });
      });
    });
  } catch (error) {
    appendRingDiagnosticLog('APP', 'app-hide-error', {
      message: error instanceof Error ? error.message : String(error)
    });
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
