<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app';
import { useRingBLE } from '@/composables/useRingBLE';
import { useRingBusinessController } from '@/composables/useRingBusinessController';
import { isMeasurementIntentPending } from '@/composables/useRingMeasurementGate';
import { useUserStore } from '@/stores/user';
import { refreshAppForegroundSessionId } from '@/utils/appForegroundSession';
import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';
import { QKEER_BUILD_INFO } from '@/utils/buildInfo';
import { refreshSystemLocale, syncTabBarLocale } from '@/i18n';
import {
  beginRingBackgroundCriticalTask,
  cancelDeferredRingBackgroundDisconnect,
  getRingBackgroundCriticalTasks,
  RING_BACKGROUND_TASK_OTA,
  runOrDeferRingBackgroundDisconnect
} from '@/utils/ringBackgroundTasks';
import {
  beginForegroundLinkVerification,
  endForegroundLinkVerification,
  isForegroundLinkVerificationPending
} from '@/utils/foregroundLinkGate';
import { withTimeout } from '@/utils/promiseTimeout';
import { hasRingCommunicationReady } from '@/utils/ringConnectionStatus';

const FOREGROUND_LINK_PROBE_TIMEOUT_MS = 3500;
const FOREGROUND_READY_REPAIR_TIMEOUT_MS = 8000;

let launchedFromFamilyEntry = false;
// APP 端回前台恢复是异步的；用可见性 + 代际号防止它越过一次 onHide/onShow。
let appInForeground = false;
let appForegroundResumeGeneration = 0;
let hasHiddenInProcess = false;

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
  appInForeground = true;
  appForegroundResumeGeneration += 1;
  const resumeGeneration = appForegroundResumeGeneration;
  const isWarmReturn = hasHiddenInProcess;
  hasHiddenInProcess = false;
  // 回到前台：取消后台挂起的断连，并恢复被暂停的自动重连。
  cancelDeferredRingBackgroundDisconnect();
  let verificationOwner: number | null = null;
  // #ifdef APP-PLUS
  // 页面 onShow 可能早于下面的链路体检；先置位，避免用过期快照启动历史同步。
  verificationOwner = beginForegroundLinkVerification();
  // #endif
  const activeBackgroundTasks = getRingBackgroundCriticalTasks().filter(
    (reason) => reason !== 'foreground-resume'
  );
  appendRingDiagnosticLog('APP', 'app-show', {
    familyEntry: launchedFromFamilyEntry || isFamilyEntry(options),
    pendingBackgroundTasks: activeBackgroundTasks
  });
  // OTA 期间链路已换成 BOOT 设备，回来后必须保持自动重连挂起，避免抢链路。
  // 测量/历史同步等任务持有的是业务链路：恢复“自动重连开关”本身不会发起连接，
  // 若不恢复，任务结束后整个前台会话都处于挂起状态，后续断线也不会自动回连。
  const otaOwnsBle = activeBackgroundTasks.includes(RING_BACKGROUND_TASK_OTA);
  // #ifndef APP-PLUS
  if (!otaOwnsBle) {
    try {
      useRingBLE().resumeRuntimeRecovery();
    } catch (error) {
      appendRingDiagnosticLog('APP', 'app-show-resume-error', {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  } else {
    appendRingDiagnosticLog('APP', 'app-show-resume-skipped', {
      activeBackgroundTasks,
      reason: 'ota-owns-ble'
    });
  }
  // #endif
  // 早于 BLE 分支：家人页也要跟随系统语言刷新，并保证 tabBar 文案正确。
  refreshSystemLocale();
  syncTabBarLocale();
  refreshAppForegroundSessionId();
  // Family invitation and care pages are pure network flows. They must never
  // request Bluetooth/privacy authorization just because the mini program opened.
  if (launchedFromFamilyEntry || isFamilyEntry(options)) {
    // #ifdef APP-PLUS
    // App 端把 resume 推迟到了链路体检之后；这里没有 BLE 分支可走，必须先恢复开关，
    // 否则整个前台会话都停留在"挂起"状态。
    if (!otaOwnsBle) useRingBLE().resumeRuntimeRecovery();
    endForegroundLinkVerification(verificationOwner ?? undefined);
    // #endif
    return;
  }
  if (activeBackgroundTasks.length > 0) {
    // 任务自己负责连接/重连；前台恢复回连上次设备只会和它抢链路。
    appendRingDiagnosticLog('APP', 'app-show-restore-skipped', {
      activeBackgroundTasks
    });
    // #ifdef APP-PLUS
    // 任务持 token 期间可以自行重连；任务结束后仍需恢复开关，供后续断线自动回连。
    if (!otaOwnsBle) useRingBLE().resumeRuntimeRecovery();
    endForegroundLinkVerification(verificationOwner ?? undefined);
    // #endif
    return;
  }
  setTimeout(() => {
    try {
      // #ifndef APP-PLUS
      const { initBluetooth, registerGlobalListeners } = useRingBLE();
      const { resumeBusinessAutoRefresh, restoreLastBusinessDevice } = useRingBusinessController();
      Promise.resolve(initBluetooth())
        .then(async () => {
          await registerGlobalListeners();
          resumeBusinessAutoRefresh();
          return restoreLastBusinessDevice({ refreshAfterRestore: false });
        })
        .catch(() => undefined);
      // #endif
      // #ifdef APP-PLUS
      void (async () => {
        const ring = useRingBLE();
        const { resumeBusinessAutoRefresh, restoreLastBusinessDevice } = useRingBusinessController();
        const isStaleResume = () =>
          !appInForeground || resumeGeneration !== appForegroundResumeGeneration;
        let releaseToken: (() => void) | null = null;
        const releaseResumeToken = () => {
          if (!releaseToken) return;
          releaseToken();
          releaseToken = null;
        };
        try {
          await ring.initBluetooth();
          if (isStaleResume()) return;
          await ring.registerGlobalListeners();
          if (isStaleResume()) return;
          const current = ring.deviceInfo.value as Record<string, any>;
          // 只有"本进程真的切过后台"才可能是保活链路；冷启动一律走完整恢复。
          const canProbeLink = isWarmReturn && Boolean(current?.deviceId);
          if (!canProbeLink) {
            ring.resumeRuntimeRecovery();
            resumeBusinessAutoRefresh();
            await restoreLastBusinessDevice({ refreshAfterRestore: false });
            return;
          }
          // 恢复开关仍挂起时 reconnect() 会被拦截，体检/原地补齐期间用 token 放行。
          releaseToken = beginRingBackgroundCriticalTask('foreground-resume');
          const probeServiceId = current.dataServiceId || current.serviceId || '';
          const probeLink = () => {
            const probePromise = probeServiceId
              ? ring.isDeviceConnected(current.deviceId, probeServiceId)
              : ring.checkByRSSI(current.deviceId);
            return withTimeout(
              Promise.resolve(probePromise).catch(() => false),
              FOREGROUND_LINK_PROBE_TIMEOUT_MS,
              false
            );
          };
          let linkAlive = await probeLink();
          if (isStaleResume()) return;
          if (!linkAlive) {
            // 页面可能恰好在体检窗口里刚建立连接；短暂等待后复检一次，
            // 避免把新建立的链路误判为断开并清掉可复用状态。
            await new Promise((resolve) => setTimeout(resolve, 300));
            if (isStaleResume()) return;
            linkAlive = await probeLink();
            if (isStaleResume()) return;
          }
          appendRingDiagnosticLog('APP', 'foreground-link-probe', {
            alive: linkAlive,
            deviceId: current.deviceId || '',
            notifyEnabled: current.notifyEnabled === true,
            probeServiceId,
            warmReturn: isWarmReturn
          });
          if (linkAlive) {
            // 链路还在，但服务/特征或 Notify 元数据可能缺失，原地补齐即可，不重建连接。
            if (!hasRingCommunicationReady(current)) {
              await withTimeout(
                ring.ensureCommunicationReady().catch(() => false),
                FOREGROUND_READY_REPAIR_TIMEOUT_MS,
                false
              );
              if (isStaleResume()) return;
            }
            ring.resumeRuntimeRecovery();
            resumeBusinessAutoRefresh();
            return;
          }
          releaseResumeToken();
          ring.resumeRuntimeRecovery();
          resumeBusinessAutoRefresh();
          // 不要 disconnect()：它会清空 Pinia 缓存，只失效通信就绪字段即可。
          ring.invalidateCommunicationReadyFields();
          await restoreLastBusinessDevice({ refreshAfterRestore: false });
        } finally {
          releaseResumeToken();
          endForegroundLinkVerification(verificationOwner ?? undefined);
        }
      })().catch((error) => {
        // 初始化/监听注册失败时也必须解除挂起，否则后续断线永远不自动回连。
        try {
          const stillCurrent =
            appInForeground && resumeGeneration === appForegroundResumeGeneration;
          if (stillCurrent && !getRingBackgroundCriticalTasks().includes(RING_BACKGROUND_TASK_OTA)) {
            useRingBLE().resumeRuntimeRecovery();
            useRingBusinessController().resumeBusinessAutoRefresh();
          }
        } catch (recoveryError) {
          void recoveryError;
        }
        endForegroundLinkVerification(verificationOwner ?? undefined);
        appendRingDiagnosticLog('APP', 'foreground-resume-error', {
          message: error instanceof Error ? error.message : String(error)
        });
      });
      // #endif
    } catch (error) {
      // #ifdef APP-PLUS
      endForegroundLinkVerification(verificationOwner ?? undefined);
      // #endif
      void error;
    }
  }, 0);
});

onHide(() => {
  // 让正在进行的回前台恢复链在下一个 await 后自行退出。
  appInForeground = false;
  hasHiddenInProcess = true;
  appForegroundResumeGeneration += 1;
  const resumeInFlight = isForegroundLinkVerificationPending();
  endForegroundLinkVerification();
  try {
    const { pauseBusinessAutoRefresh } = useRingBusinessController();
    pauseBusinessAutoRefresh();
    const userStore = useUserStore();
    // #ifndef APP-PLUS
    userStore.updateIsBluetoothReady(false);
    // #endif

    // 先停掉自动重连，避免后台继续扫描/重连。
    const ring = useRingBLE();
    ring.suspendRuntimeRecovery();
    const activeBackgroundTasks = getRingBackgroundCriticalTasks();
    appendRingDiagnosticLog('APP', 'app-hide', {
      activeBackgroundTasks,
      pendingDeviceId: ring.deviceInfo.value?.deviceId || '',
      connected: ring.isConnected.value
    });
    // #ifndef APP-PLUS
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
    // #endif
    // #ifdef APP-PLUS
    // Android 切后台保留物理链路：只停扫描/挂起自动恢复，不断开、不清缓存。
    // 已建立的链路本身是回前台"无感恢复"的前提；进程被系统回收时由冷启动路径兜底。
    const otaOwnsBle = activeBackgroundTasks.includes(RING_BACKGROUND_TASK_OTA);
    if (!otaOwnsBle) {
      // 回前台恢复仍在进行时不要取消它：取消会 bump 生命周期 token，
      // 在途 reconnect 自清理时会走 disconnect()，反而清空缓存。
      // 测量等待期间也不能取消，否则会把用户刚发起的测量掐掉。
      if (
        !resumeInFlight &&
        !ring.isConnected.value &&
        ring.deviceInfo.value?.deviceId &&
        !isMeasurementIntentPending()
      ) {
        void ring.cancelPendingConnection().catch((error) => {
          appendRingDiagnosticLog('APP', 'app-hide-cancel-pending-error', {
            message: error instanceof Error ? error.message : String(error)
          });
        });
      }
      // 恢复或测量等待期间可能正在扫描；此时停扫描会把这一轮重连拖到超时。
      if (!resumeInFlight && !isMeasurementIntentPending()) {
        void ring.stopScan().catch((error) => {
          appendRingDiagnosticLog('APP', 'app-hide-stop-scan-error', {
            message: error instanceof Error ? error.message : String(error)
          });
        });
      }
    }
    appendRingDiagnosticLog('APP', 'app-hide-keep-link', {
      activeBackgroundTasks,
      pendingDeviceId: ring.deviceInfo.value?.deviceId || '',
      connected: ring.isConnected.value,
      scanning: ring.isScanning.value,
      otaOwnsBle
    });
    // #endif
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
