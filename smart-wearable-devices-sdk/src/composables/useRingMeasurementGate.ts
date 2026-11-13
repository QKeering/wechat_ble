import { computed, ref } from 'vue';
import { useRingBLE, type VitalMeasurementLockKind } from '@/composables/useRingBLE';
import { useRingStore } from '@/stores';
import { beginRingBackgroundCriticalTask } from '@/utils/ringBackgroundTasks';
import { isForegroundLinkVerificationPending } from '@/utils/foregroundLinkGate';
import { withTimeout } from '@/utils/promiseTimeout';
import { hasRingCommunicationReady } from '@/utils/ringConnectionStatus';
import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';

export type RingMeasurementIntentKind = VitalMeasurementLockKind;

const MEASUREMENT_READY_TIMEOUT_MS = 60000;
const LOADING_VISIBLE_MS = 3000;
const FOREGROUND_VERIFICATION_POLL_MS = 100;
// 一次 legacy BLE 调用可能永远不 settle；超过重连上界后允许重新发起。
const READINESS_PROMISE_TTL_MS = 90000;
const DEFAULT_LOADING_TITLE = '正在连接设备...';

const pendingIntent = ref<RingMeasurementIntentKind | null>(null);
const readinessPromises = new Map<string, { promise: Promise<boolean>; startedAt: number }>();

const getDeviceKey = (device?: Record<string, any> | null) => String(device?.mac || device?.advertis?.macInfo || device?.uniMacId || device?.deviceId || '').trim();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 页面按钮文案用：有测量在等待链路时显示「连接中」，而不是「未连接」。 */
export const measurementIntentPending = computed(() => pendingIntent.value !== null);

export const isMeasurementIntentPending = () => pendingIntent.value !== null;

export const getPendingMeasurementIntent = () => pendingIntent.value;

/**
 * 一次只允许一个"等待链路后自动开始测量"的意图。返回 false 表示已有一个
 * 意图在等待，调用方应提示用户稍候。
 */
export const beginMeasurementIntent = (kind: RingMeasurementIntentKind): boolean => {
  if (pendingIntent.value) return false;
  pendingIntent.value = kind;
  return true;
};

export const endMeasurementIntent = (kind?: RingMeasurementIntentKind) => {
  if (!pendingIntent.value) return;
  if (kind && pendingIntent.value !== kind) return;
  pendingIntent.value = null;
};

const hasBoundDeviceIdentity = () => {
  const ringStore = useRingStore();
  const bound = ringStore.boundDevice as Record<string, any> | null | undefined;
  const current = ringStore.deviceInfo as Record<string, any> | undefined;
  return Boolean(getDeviceKey(bound) || getDeviceKey(current));
};

const waitForForegroundLinkVerification = async (deadline: number) => {
  while (isForegroundLinkVerificationPending() && Date.now() < deadline) {
    await sleep(Math.min(FOREGROUND_VERIFICATION_POLL_MS, Math.max(1, deadline - Date.now())));
  }
};

const ensureCommunicationReadyShared = (ring: ReturnType<typeof useRingBLE>) => {
  const key = getDeviceKey(ring.deviceInfo.value as Record<string, any>);
  if (key) {
    const existing = readinessPromises.get(key);
    if (existing && Date.now() - existing.startedAt < READINESS_PROMISE_TTL_MS) return existing.promise;
  }
  // 调用方超时不能删除在途 promise，否则下一次点击会再发起一次重连；
  // 只允许过期后重新发起，避免 legacy 回调丢失导致本会话永久失败。
  const entry = {
    promise: undefined as unknown as Promise<boolean>,
    startedAt: Date.now()
  };
  entry.promise = ring
    .ensureCommunicationReady()
    .catch(() => false)
    .finally(() => {
      if (key && readinessPromises.get(key) === entry) readinessPromises.delete(key);
    });
  if (key) readinessPromises.set(key, entry);
  return entry.promise;
};

const isDeviceReadyForMeasurement = (ring: ReturnType<typeof useRingBLE>) =>
  Boolean(ring.isConnected.value && hasRingCommunicationReady(ring.deviceInfo.value) && !isForegroundLinkVerificationPending());

/**
 * 返回 true 表示链路已就绪、可以继续下发测量；false 表示没有可等待的绑定设备
 * 或等待超时，调用方走各自现有的连接引导。
 *
 * 本函数不获取测量锁：连接等待期间用 pendingIntent 去重，真正开始测量时再取锁，
 * 避免链路抖动导致锁被自动释放后 token 失效。
 */
export const ensureRingReadyForMeasurement = async (options: { timeoutMs?: number; loadingTitle?: string } = {}): Promise<boolean> => {
  const ring = useRingBLE();
  const timeoutMs = options.timeoutMs ?? MEASUREMENT_READY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  // 用户一点就要有反馈，但不能让 loading 一直挂着；超过 3 秒后交给按钮的
  // "连接中" 状态表达，链路就绪后仍然会自动开始测量。
  let loadingVisible = true;
  uni.showLoading({ title: options.loadingTitle || DEFAULT_LOADING_TITLE, mask: false });
  const loadingTimer = setTimeout(() => {
    if (!loadingVisible) return;
    uni.hideLoading();
    loadingVisible = false;
  }, LOADING_VISIBLE_MS);
  (loadingTimer as any).unref?.();
  try {
    await waitForForegroundLinkVerification(deadline);
    if (isDeviceReadyForMeasurement(ring)) return true;
    if (!hasBoundDeviceIdentity()) return false;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    // 只在真正等待 BLE 时持有后台 token：校验阶段 App 自己可能正在
    // restoreLastBusinessDevice，多一个 token 会让它直接跳过恢复。
    const releaseToken = beginRingBackgroundCriticalTask('measurement-ready-wait');
    try {
      const ready = await withTimeout(ensureCommunicationReadyShared(ring), remainingMs, false);
      appendRingDiagnosticLog('APP', 'measurement-gate-wait', {
        ready,
        timeoutMs,
        remainingMs,
        deviceId: ring.deviceInfo.value?.deviceId || ''
      });
      return ready && isDeviceReadyForMeasurement(ring);
    } finally {
      releaseToken();
    }
  } finally {
    clearTimeout(loadingTimer);
    if (loadingVisible) uni.hideLoading();
  }
};
