import { computed, ref, watch } from 'vue';
import { useRingBleStoreSdk } from './useRingBleStoreSdk';
import type { UseRingBleSdkOptions } from './useRingBleSdk';
import { resolveRingProtocol, type RefreshLegacyBusinessMetricsResult, type RingDeviceInfo, type RwHealthDataName, type RwHistoryDataName } from '@/sdk/ring-ble';
import { buildRwQkeerV2LastDataCommand, type RwHealthMonitoringConfig, type RwUserProfile } from '@/sdk/ring-ble/rw/protocol';
import { buildLegacyBloodOxygenMeasurementPayload, buildLegacyCommandBytes, buildLegacyHeartRateMeasurementPayload, createLegacyFrameId } from '@/sdk/ring-ble/legacy/protocol';
import { getRwDiagnosticCommandLock } from '@/utils/rwDiagnosticCommandLock';
import { beginRingBackgroundCriticalTask } from '@/utils/ringBackgroundTasks';
import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';
import { getLegacyBleHistoryExclusiveSnapshot, resolveLegacyBleCommandSessionDeviceKey, waitForLegacyBleCommandSessionIdle } from '@/sdk/ring-ble/legacy/commandSession';

export interface UseRingBLEOptions extends UseRingBleSdkOptions {
  rwCompatScanTimeoutMs?: number;
}
type CompatScanInput = string | string[] | Parameters<ReturnType<typeof useRingBleStoreSdk>['startScan']>[0];
type CompatConnectInput = string | RingDeviceInfo;
type CompatRefreshOptions = Parameters<ReturnType<typeof useRingBleStoreSdk>['refreshBusinessMetrics']>[0];
type DefinedCompatRefreshOptions = NonNullable<CompatRefreshOptions>;
type CompatHistoryTimeInput = number | string | Date;
type CompatRwHealthDataName =
  | RwHealthDataName
  | 'heartRate'
  | 'heart-rate'
  | 'heartrate'
  | 'hr'
  | 'bloodOxygen'
  | 'blood-oxygen'
  | 'oxygen'
  | 'spO2'
  | 'SpO2'
  | 'SPO2'
  | 'temperature'
  | 'bodyTemperature'
  | 'body-temperature'
  | 'bodyTemp'
  | 'body-temp'
  | 'skinTemperature'
  | 'skin-temperature'
  | 'skinTemp'
  | 'skin-temp'
  | 'bloodSugar'
  | 'blood-sugar'
  | 'glucose'
  | 'bloodPressure'
  | 'blood-pressure'
  | 'bp';
type CompatRwHistoryDataName = RwHistoryDataName;
type CompatRwHistoryDataInput = CompatRwHistoryDataName | CompatRwHistoryDataName[];
interface CompatReadLocalDataOptions {
  timeoutMs?: number;
  silentUploadStatus?: boolean;
  skipUpload?: boolean;
}
interface CompatDeviceInfoCommandOptions {
  timeoutMs?: number;
  retryReady?: boolean;
}
type LegacyWearMeasurementKind = 'heart_rate' | 'blood_oxygen' | 'temperature';
export type VitalMeasurementLockKind = LegacyWearMeasurementKind | 'hrv';
type VitalMeasurementLockState = {
  token: string;
  deviceKey: string;
  kind: VitalMeasurementLockKind;
  protocol: ReturnType<typeof resolveRingProtocol>;
  startedAt: number;
  expiresAt: number;
  // 测量事务期间 App 切后台不能立刻断连，否则本轮测量直接作废。
  releaseBackgroundTask?: () => void;
};
type PendingLegacyWearMeasurement = {
  kind: LegacyWearMeasurementKind;
  frameId: number;
  expiresAt: number;
  completion: Promise<unknown>;
};
const DEFAULT_COMPAT_REFRESH_OPTIONS: CompatRefreshOptions = {
  includeDeviceTime: false,
  includeCollectPeriod: false
};
const DEFAULT_COMPAT_REFRESH_TIMEOUT_MS = 3500;
const RW_COMPAT_REFRESH_TIMEOUT_MS = 35000;
const RW_COMPAT_SCAN_TIMEOUT_MS = 12000;
const LEGACY_WEAR_MEASUREMENT_BUSY_WINDOW_MS = 40_000;
const LEGACY_WEAR_MEASUREMENT_BUSY_RETRY_MS = 5_000;
const VITAL_MEASUREMENT_LOCK_FALLBACK_MS = 65_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const RING_DIAGNOSTIC_LOG_STORAGE_KEY = 'qkeer:ring-diagnostic-logs';
const RING_DIAGNOSTIC_LOG_MAX_COUNT = 500;

let rwCompatHistoryQueue: Promise<unknown> = Promise.resolve();
let rwCompatHistoryQueueDepth = 0;
const communicationReadyPromiseByDevice = new Map<string, Promise<boolean>>();
const deviceInfoCommandQueueByDevice = new Map<string, Promise<unknown>>();
// 旧协议没有经过验证的强制停止命令。记录固件占用窗口，确保页面重试时先等待
// 上一轮正式测量自然结束，避免再次下发命令后收到 status=4（设备繁忙）。
const legacyWearMeasurementBusyUntilByDevice = new Map<string, number>();
// 生命体征页的多个卡片会分别创建 useRingBLE 实例，因此测量锁必须放在模块级共享。
// 测量期间阻止其他指标重复下发命令。窗口内的合法数值只作为候选结果，
// 必须等完整采集窗口结束、最终结果已确定后才释放小程序侧占用；异常由超时保护兜底。
const activeVitalMeasurementLock = ref<VitalMeasurementLockState | null>(null);
let activeVitalMeasurementLockTimer: ReturnType<typeof setTimeout> | null = null;

const clearActiveVitalMeasurementLockTimer = () => {
  if (!activeVitalMeasurementLockTimer) return;
  clearTimeout(activeVitalMeasurementLockTimer);
  activeVitalMeasurementLockTimer = null;
};

const releaseActiveVitalMeasurementLock = (reason: string, options: { token?: string; deviceKey?: string } = {}) => {
  const current = activeVitalMeasurementLock.value;
  if (!current) return false;
  if (options.token && current.token !== options.token) return false;
  if (options.deviceKey && current.deviceKey !== options.deviceKey) return false;
  clearActiveVitalMeasurementLockTimer();
  activeVitalMeasurementLock.value = null;
  // 锁释放意味着测量事务结束：此时才允许 App 在后台执行延迟断连。
  current.releaseBackgroundTask?.();
  appendRingDiagnosticLog('VITAL LOCK', 'measurement-lock-released', {
    reason,
    deviceKey: current.deviceKey,
    kind: current.kind,
    heldMs: Date.now() - current.startedAt
  });
  return true;
};

const scheduleActiveVitalMeasurementLockRelease = (lock: VitalMeasurementLockState) => {
  clearActiveVitalMeasurementLockTimer();
  activeVitalMeasurementLockTimer = setTimeout(
    () => {
      releaseActiveVitalMeasurementLock('fallback-timeout', { token: lock.token });
    },
    Math.max(0, lock.expiresAt - Date.now()) + 20
  );
};

const isNodeRuntime = () => Boolean((globalThis as any).process?.versions?.node);

const formatCompatHistoryDiagnosticTime = (date = new Date()) => {
  const pad = (value: number, length: number) => `${value}`.padStart(length, '0');
  return `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`;
};

const appendRwCompatHistoryDiagnosticLog = (event: string, details?: unknown) => {
  if (isNodeRuntime()) return;
  const uniRuntime = (globalThis as any).uni;
  if (!uniRuntime?.getStorageSync || !uniRuntime?.setStorageSync) return;

  try {
    const raw = uniRuntime.getStorageSync(RING_DIAGNOSTIC_LOG_STORAGE_KEY);
    const logs = Array.isArray(raw) ? raw : [];
    logs.push({
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      time: formatCompatHistoryDiagnosticTime(),
      source: 'RW FLOW',
      event,
      details
    });
    uniRuntime.setStorageSync(RING_DIAGNOSTIC_LOG_STORAGE_KEY, logs.slice(-RING_DIAGNOSTIC_LOG_MAX_COUNT));
  } catch {
    // Diagnostics must not affect BLE behavior.
  }
};

const formatCompatHistoryQueueError = (error: unknown) => (error instanceof Error ? error.message : `${(error as any)?.errMsg || error}`);

export const waitForRwCompatHistoryQueueIdle = async (timeoutMs = 5000, quietMs = 600) => {
  const startedAt = Date.now();
  let quietStartedAt = rwCompatHistoryQueueDepth === 0 ? Date.now() : 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (rwCompatHistoryQueueDepth === 0) {
      if (!quietStartedAt) quietStartedAt = Date.now();
      if (Date.now() - quietStartedAt >= quietMs) return true;
    } else {
      quietStartedAt = 0;
    }
    await sleep(100);
  }

  return rwCompatHistoryQueueDepth === 0;
};

const createRwCompatHistorySkippedResult = (message: string, details: Record<string, unknown>) => ({
  status: 'skipped',
  records: [],
  parsed: {
    type: 'rw_history_pending',
    status: 'skipped',
    message,
    details
  },
  uploaded: false,
  deleted: false
});

const runRwCompatHistoryExclusive = async <T>(task: () => Promise<T>, details: Record<string, unknown>) => {
  const queuedBehind = rwCompatHistoryQueueDepth;
  const queueDepth = queuedBehind + 1;
  rwCompatHistoryQueueDepth = queueDepth;
  appendRwCompatHistoryDiagnosticLog('compat-history-queue-enqueue', {
    ...details,
    queuedBehind,
    queueDepth
  });

  const previous = rwCompatHistoryQueue.catch(() => undefined);
  const queuedTask = previous.then(async () => {
    appendRwCompatHistoryDiagnosticLog('compat-history-queue-start', {
      ...details,
      queuedBehind,
      queueDepth
    });
    try {
      const result = await task();
      appendRwCompatHistoryDiagnosticLog('compat-history-queue-result', {
        ...details,
        queuedBehind,
        queueDepth
      });
      return result;
    } catch (error) {
      appendRwCompatHistoryDiagnosticLog('compat-history-queue-failed', {
        ...details,
        queuedBehind,
        queueDepth,
        error: formatCompatHistoryQueueError(error)
      });
      throw error;
    }
  });

  rwCompatHistoryQueue = queuedTask
    .catch(() => undefined)
    .finally(() => {
      rwCompatHistoryQueueDepth = Math.max(0, rwCompatHistoryQueueDepth - 1);
    });

  return queuedTask;
};

const stripUndefinedCompatRefreshOptions = (params?: CompatRefreshOptions): DefinedCompatRefreshOptions => {
  if (!params) return {};
  const result: Record<string, unknown> = {};
  Object.keys(params).forEach((key) => {
    const value = (params as Record<string, unknown>)[key];
    if (value !== undefined) result[key] = value;
  });
  return result as DefinedCompatRefreshOptions;
};

const createCompatRefreshFailure = (error: unknown): RefreshLegacyBusinessMetricsResult => ({
  status: 'failed',
  ok: [],
  failed: [
    {
      step: 'refresh',
      message: error instanceof Error ? error.message : `${(error as any)?.errMsg || error || 'refresh failed'}`
    }
  ]
});

export const useRingBLE = (options: UseRingBLEOptions = {}) => {
  const sdk = useRingBleStoreSdk(options);
  let pendingLegacyWearMeasurement: PendingLegacyWearMeasurement | null = null;
  const getLegacyWearMeasurementDeviceKey = () => {
    const currentDevice = sdk.deviceInfo.value;
    return String(currentDevice.deviceId || currentDevice.mac || currentDevice.advertis?.macInfo || 'legacy-ring').toUpperCase();
  };
  const getActiveVitalMeasurementLock = () => {
    const current = activeVitalMeasurementLock.value;
    if (!current) return null;
    if (current.expiresAt <= Date.now()) {
      releaseActiveVitalMeasurementLock('expired', { token: current.token });
      return null;
    }
    return current.deviceKey === getLegacyWearMeasurementDeviceKey() ? current : null;
  };
  const vitalMeasurementLock = computed(() => getActiveVitalMeasurementLock());
  const isVitalMeasurementLocked = computed(() => Boolean(vitalMeasurementLock.value));
  const vitalMeasurementLockKind = computed(() => vitalMeasurementLock.value?.kind || null);
  const acquireVitalMeasurementLock = (kind: VitalMeasurementLockKind, fallbackMs?: number) => {
    const deviceKey = getLegacyWearMeasurementDeviceKey();
    const current = getActiveVitalMeasurementLock();
    if (current) {
      appendRingDiagnosticLog('VITAL LOCK', 'measurement-lock-rejected', {
        deviceKey,
        requestedKind: kind,
        activeKind: current.kind,
        remainingMs: Math.max(0, current.expiresAt - Date.now())
      });
      return null;
    }
    // 切换设备后旧锁不应阻塞新设备。
    if (activeVitalMeasurementLock.value?.deviceKey !== deviceKey) {
      releaseActiveVitalMeasurementLock('device-changed');
    }
    const protocol = resolveRingProtocol(sdk.deviceInfo.value);
    const durationMs = Math.max(1000, Number(fallbackMs) || VITAL_MEASUREMENT_LOCK_FALLBACK_MS);
    const now = Date.now();
    const lock: VitalMeasurementLockState = {
      token: `${now}-${Math.random().toString(36).slice(2, 10)}`,
      deviceKey,
      kind,
      protocol,
      startedAt: now,
      expiresAt: now + durationMs,
      releaseBackgroundTask: beginRingBackgroundCriticalTask(`vital-measurement:${kind}`)
    };
    activeVitalMeasurementLock.value = lock;
    scheduleActiveVitalMeasurementLockRelease(lock);
    appendRingDiagnosticLog('VITAL LOCK', 'measurement-lock-acquired', {
      deviceKey,
      kind,
      protocol,
      fallbackMs: durationMs
    });
    return lock.token;
  };
  const releaseVitalMeasurementLock = (token: string, reason = 'page-release') => releaseActiveVitalMeasurementLock(reason, { token });
  const getLegacyWearMeasurementBusyRemainingMs = () => {
    if (resolveRingProtocol(sdk.deviceInfo.value) !== 'legacy') return 0;
    return Math.max(0, (legacyWearMeasurementBusyUntilByDevice.get(getLegacyWearMeasurementDeviceKey()) || 0) - Date.now());
  };
  const syncVitalMeasurementLockWithLegacyBusy = (token: string) => {
    const current = getActiveVitalMeasurementLock();
    if (!current || current.token !== token || current.protocol !== 'legacy') return 0;
    const remainingMs = getLegacyWearMeasurementBusyRemainingMs();
    // 固件已空闲不等于页面事务已完成。调用方会在失败退出或最终结果落定时明确释放。
    if (remainingMs <= 0) return 0;
    const nextLock = {
      ...current,
      // 固件繁忙窗口只负责延长事务锁，不能把页面完整测量的兜底时间缩短。
      expiresAt: Math.max(current.expiresAt, Date.now() + remainingMs)
    };
    activeVitalMeasurementLock.value = nextLock;
    scheduleActiveVitalMeasurementLockRelease(nextLock);
    return remainingMs;
  };
  const clearPendingLegacyWearMeasurement = () => {
    pendingLegacyWearMeasurement = null;
  };
  const completeVitalMeasurement = (token: string, reason = 'measurement-window-completed') => {
    const current = getActiveVitalMeasurementLock();
    if (!current || current.token !== token) return false;

    // 只有完整采集窗口结束、最终结果已确定后才能释放本轮测量资源。
    // 这里只清理小程序侧的等待器、繁忙窗口和共享锁，保留 BLE 连接供后续同步复用。
    clearPendingLegacyWearMeasurement();
    legacyWearMeasurementBusyUntilByDevice.delete(current.deviceKey);
    const released = releaseActiveVitalMeasurementLock(reason, { token });
    appendRingDiagnosticLog('VITAL LOCK', 'measurement-resource-released', {
      deviceKey: current.deviceKey,
      kind: current.kind,
      protocol: current.protocol,
      reason,
      released
    });
    return released;
  };
  const markLegacyWearMeasurementBusy = (durationMs = LEGACY_WEAR_MEASUREMENT_BUSY_WINDOW_MS) => {
    if (resolveRingProtocol(sdk.deviceInfo.value) !== 'legacy') return;
    const deviceKey = getLegacyWearMeasurementDeviceKey();
    const nextBusyUntil = Date.now() + durationMs;
    legacyWearMeasurementBusyUntilByDevice.set(deviceKey, Math.max(legacyWearMeasurementBusyUntilByDevice.get(deviceKey) || 0, nextBusyUntil));
  };
  const waitForLegacyWearMeasurementIdle = async (timeoutMs = 12_000) => {
    clearPendingLegacyWearMeasurement();
    if (resolveRingProtocol(sdk.deviceInfo.value) !== 'legacy') return true;

    const deviceKey = getLegacyWearMeasurementDeviceKey();
    const busyUntil = legacyWearMeasurementBusyUntilByDevice.get(deviceKey) || 0;
    const remainingMs = busyUntil - Date.now();
    if (remainingMs <= 0) {
      legacyWearMeasurementBusyUntilByDevice.delete(deviceKey);
      return true;
    }

    const boundedTimeoutMs = Math.max(0, Math.min(45_000, Number(timeoutMs) || 0));
    const waitMs = Math.min(remainingMs + 250, boundedTimeoutMs);
    appendRingDiagnosticLog('WEAR GATE', 'legacy-wear-previous-measurement-settle-start', {
      deviceKey,
      remainingMs,
      timeoutMs: boundedTimeoutMs
    });
    if (waitMs > 0) await sleep(waitMs);
    const settled = Date.now() >= busyUntil;
    if (settled) legacyWearMeasurementBusyUntilByDevice.delete(deviceKey);
    appendRingDiagnosticLog('WEAR GATE', 'legacy-wear-previous-measurement-settle-result', {
      deviceKey,
      settled,
      waitedMs: waitMs
    });
    return settled;
  };
  const normalizeLegacyWearMeasurementKind = (name: unknown): LegacyWearMeasurementKind | null => {
    const normalized = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/-/g, '_');
    if (normalized === 'heart_rate' || normalized === 'hr' || normalized === 'hrv') return 'heart_rate';
    if (normalized === 'blood_oxygen' || normalized === 'oxygen' || normalized === 'spo2') return 'blood_oxygen';
    if (normalized === 'temperature' || normalized === 'body_temperature' || normalized === 'skin_temperature') return 'temperature';
    return null;
  };
  const consumePendingLegacyWearMeasurement = (requestedNames: unknown[]) => {
    if (!pendingLegacyWearMeasurement) return null;
    if (resolveRingProtocol(sdk.deviceInfo.value) !== 'legacy' || pendingLegacyWearMeasurement.expiresAt <= Date.now()) {
      pendingLegacyWearMeasurement = null;
      return null;
    }
    const matchedName = requestedNames.find((name) => normalizeLegacyWearMeasurementKind(name) === pendingLegacyWearMeasurement?.kind);
    if (matchedName == null) return null;
    const reused = pendingLegacyWearMeasurement;
    pendingLegacyWearMeasurement = null;
    appendRingDiagnosticLog('WEAR GATE', 'legacy-wear-measurement-reused', {
      kind: reused.kind,
      frameId: reused.frameId,
      requestedName: String(matchedName)
    });
    return reused;
  };
  const connectedDeviceId = computed(() => sdk.deviceInfo.value.deviceId || '');
  const healthData = computed(() => sdk.ringStore.healthData);
  const latestMetrics = computed(() => sdk.ringStore.latestMetrics);
  const getCurrentRwStableMac = () => {
    const currentDevice = sdk.deviceInfo.value;
    const currentStableMac = currentDevice.mac || currentDevice.advertis?.macInfo || '';
    return currentStableMac || (isColonSeparatedBleMac(currentDevice.uniMacId) ? currentDevice.uniMacId : '');
  };
  const normalMac = computed(() => {
    const currentStableMac = sdk.deviceInfo.value.mac || sdk.deviceInfo.value.advertis?.macInfo || '';
    if (resolveRingProtocol(sdk.deviceInfo.value) === 'rw') return getCurrentRwStableMac() || '';
    return sdk.ringStore.normalMac || currentStableMac;
  });
  const iosMacId = computed(() => {
    const currentStableMac = sdk.deviceInfo.value.mac || sdk.deviceInfo.value.advertis?.macInfo || '';
    if (resolveRingProtocol(sdk.deviceInfo.value) === 'rw') return getCurrentRwStableMac() || '';
    return sdk.ringStore.iosMacId || sdk.deviceInfo.value.uniMacId || currentStableMac;
  });
  const deviceTime = computed(() => sdk.ringStore.deviceTime || 0);
  const lastReadTimestamp = computed(() => sdk.ringStore.lastReadTimestamp || 0);
  const lastMetricUpdateAt = computed(() => sdk.ringStore.lastMetricUpdateAt || sdk.ringStore.healthData.lastMetricUpdateAt || 0);
  const localData = computed(() => sdk.ringStore.localData || []);
  const historyRecords = computed(() => sdk.ringStore.historyRecords || []);
  const getCommunicationDeviceIdentity = () => sdk.deviceInfo.value;
  const getCommunicationDeviceKey = () => {
    return resolveLegacyBleCommandSessionDeviceKey(getCommunicationDeviceIdentity());
  };
  watch(
    () => [sdk.isConnected.value, sdk.deviceInfo.value.deviceId, sdk.deviceInfo.value.notifyEnabled] as const,
    ([connected, deviceId, notifyEnabled], previous) => {
      const deviceChanged = Boolean(previous?.[1] && previous[1] !== deviceId);
      if (!connected || !deviceId || notifyEnabled === false || deviceChanged) {
        pendingLegacyWearMeasurement = null;
        releaseActiveVitalMeasurementLock(deviceChanged ? 'device-changed' : 'device-disconnected');
        const previousKey = String(previous?.[1] || deviceId || '').toUpperCase();
        const currentKey = getCommunicationDeviceKey();
        const previousCleared = communicationReadyPromiseByDevice.delete(previousKey);
        const currentCleared = currentKey !== previousKey ? communicationReadyPromiseByDevice.delete(currentKey) : false;
        const cleared = previousCleared || currentCleared;
        deviceInfoCommandQueueByDevice.delete(previousKey);
        if (currentKey !== previousKey) deviceInfoCommandQueueByDevice.delete(currentKey);
        if (cleared) {
          appendRingDiagnosticLog('L19 BLE', 'communication-ready-cache-cleared', {
            connected,
            deviceId,
            notifyEnabled,
            deviceChanged,
            deviceKey: currentKey || previousKey
          });
        }
      }
    }
  );

  const normalizeScanInput = (input?: CompatScanInput) => {
    if (!input) return undefined;
    if (typeof input === 'string') return [input];
    if (Array.isArray(input)) return input;
    return input;
  };

  const ensureCommunicationReadyShared = () => {
    const deviceKey = getCommunicationDeviceKey() || 'unknown-device';
    const existing = communicationReadyPromiseByDevice.get(deviceKey);
    if (existing) return existing;
    const task = sdk.ensureCommunicationReady();
    communicationReadyPromiseByDevice.set(deviceKey, task);
    task
      .finally(() => {
        if (communicationReadyPromiseByDevice.get(deviceKey) === task) {
          communicationReadyPromiseByDevice.delete(deviceKey);
        }
      })
      .catch(() => undefined);
    return task;
  };

  const waitForHistoryCommandWindow = async (command: string) => {
    const deviceIdentity = getCommunicationDeviceIdentity();
    const deviceKey = resolveLegacyBleCommandSessionDeviceKey(deviceIdentity);
    const historyExclusive = getLegacyBleHistoryExclusiveSnapshot(deviceIdentity);
    if (!historyExclusive.active) return;
    const timeoutMs = Math.max(1000, Math.min(36000, historyExclusive.remainingMs + 1200));
    appendRingDiagnosticLog('L19 BLE', 'command-deferred-history-exclusive', {
      command,
      deviceKey,
      sessionId: historyExclusive.sessionId,
      remainingMs: historyExclusive.remainingMs,
      timeoutMs
    });
    const idle = await waitForLegacyBleCommandSessionIdle(deviceIdentity, timeoutMs);
    if (!idle) {
      appendRingDiagnosticLog('L19 BLE', 'command-skipped-history-exclusive-timeout', {
        command,
        deviceKey,
        sessionId: historyExclusive.sessionId,
        timeoutMs
      });
      throw new Error('History read is still active; command was not inserted.');
    }
    if (resolveLegacyBleCommandSessionDeviceKey(getCommunicationDeviceIdentity()) !== deviceKey) {
      throw new Error('Ring device changed while waiting for history read.');
    }
  };

  const runWithReady = async <T>(task: () => Promise<T>, command = 'interactive-command') => {
    await waitForHistoryCommandWindow(command);
    const ready = await ensureCommunicationReadyShared();
    if (!ready) {
      throw new Error('Ring BLE communication is not ready.');
    }
    return task();
  };

  const hasDeviceInfoFastPath = () => {
    const current = sdk.deviceInfo.value;
    return Boolean(sdk.isConnected.value && current.deviceId && current.serviceId && current.cmdCharId && current.dataCharId && current.notifyEnabled !== false);
  };

  const enqueueDeviceInfoCommand = <T>(command: string, task: () => Promise<T>, options: Pick<CompatDeviceInfoCommandOptions, 'retryReady'> = {}) => {
    const queuedAt = Date.now();
    const run = async () => {
      await waitForHistoryCommandWindow(command);
      const startedAt = Date.now();
      const fastPath = hasDeviceInfoFastPath();
      const commandDeviceId = sdk.deviceInfo.value.deviceId;
      appendRingDiagnosticLog('L19 BLE', 'device-info-command-start', {
        command,
        deviceId: sdk.deviceInfo.value.deviceId,
        queueWaitMs: startedAt - queuedAt,
        fastPath
      });
      try {
        let result: T;
        try {
          result = await (fastPath ? task() : runWithReady(task, command));
        } catch (directError) {
          if (!fastPath || options.retryReady === false) throw directError;
          communicationReadyPromiseByDevice.delete(getCommunicationDeviceKey() || 'unknown-device');
          appendRingDiagnosticLog('L19 BLE', 'device-info-command-ready-retry', {
            command,
            deviceId: commandDeviceId,
            elapsedMs: Date.now() - startedAt,
            message: directError instanceof Error ? directError.message : String(directError)
          });
          const ready = await ensureCommunicationReadyShared();
          if (!ready || sdk.deviceInfo.value.deviceId !== commandDeviceId) {
            throw directError;
          }
          result = await task();
        }
        appendRingDiagnosticLog('L19 BLE', 'device-info-command-result', {
          command,
          deviceId: sdk.deviceInfo.value.deviceId,
          queueWaitMs: startedAt - queuedAt,
          elapsedMs: Date.now() - startedAt,
          fastPath
        });
        return result;
      } catch (error) {
        appendRingDiagnosticLog('L19 BLE', 'device-info-command-failed', {
          command,
          deviceId: sdk.deviceInfo.value.deviceId,
          queueWaitMs: startedAt - queuedAt,
          elapsedMs: Date.now() - startedAt,
          fastPath,
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    };
    const deviceKey = getCommunicationDeviceKey() || 'unknown-device';
    const previousQueue = deviceInfoCommandQueueByDevice.get(deviceKey) || Promise.resolve();
    const queued = previousQueue.then(run, run);
    const settledQueue = queued.then(
      () => undefined,
      () => undefined
    );
    deviceInfoCommandQueueByDevice.set(deviceKey, settledQueue);
    settledQueue
      .finally(() => {
        if (deviceInfoCommandQueueByDevice.get(deviceKey) === settledQueue) {
          deviceInfoCommandQueueByDevice.delete(deviceKey);
        }
      })
      .catch(() => undefined);
    return queued;
  };

  const readLocalData = (readAll = false, time: CompatHistoryTimeInput = '', dataType?: CompatRwHistoryDataInput, readOptions: CompatReadLocalDataOptions = {}) => {
    const sinceTimestamp = readAll ? undefined : parseCompatHistorySinceTimestamp(time);
    const normalizedDataTypes = Array.isArray(dataType) ? Array.from(new Set(dataType.map((item) => normalizeCompatRwHistoryDataName(item)).filter(Boolean))) : undefined;
    const normalizedDataType = dataType && !Array.isArray(dataType) ? normalizeCompatRwHistoryDataName(dataType) : undefined;
    const timeoutMs = Number(readOptions.timeoutMs);
    const historyOptions = {
      readAll,
      ...(sinceTimestamp === undefined ? {} : { sinceTimestamp }),
      ...(normalizedDataType ? { dataType: normalizedDataType } : {}),
      ...(normalizedDataTypes?.length ? { dataTypes: normalizedDataTypes } : {}),
      ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
      ...(readOptions.silentUploadStatus === true ? { silentUploadStatus: true } : {}),
      ...(readOptions.skipUpload === true ? { skipUpload: true } : {})
    };
    return runWithReady(() => {
      const task = () => sdk.syncHistory(historyOptions);
      if (resolveRingProtocol(sdk.deviceInfo.value) !== 'rw') return task();
      const diagnosticLock = getRwDiagnosticCommandLock();
      if (diagnosticLock) {
        appendRwCompatHistoryDiagnosticLog('compat-history-skip-diagnostic-lock', {
          ...historyOptions,
          lock: diagnosticLock
        });
        return Promise.resolve(
          createRwCompatHistorySkippedResult('RW diagnostic command lock is active.', {
            ...historyOptions,
            lock: diagnosticLock
          }) as Awaited<ReturnType<typeof sdk.syncHistory>>
        );
      }
      return runRwCompatHistoryExclusive(task, {
        readAll,
        sinceTimestamp,
        dataType: normalizedDataType,
        dataTypes: normalizedDataTypes,
        timeoutMs: historyOptions.timeoutMs,
        silentUploadStatus: readOptions.silentUploadStatus === true
      });
    });
  };

  const reScan = (input?: CompatScanInput) => {
    return sdk.reScan(normalizeScanInput(input));
  };

  const restartScan = (input?: CompatScanInput) => {
    return sdk.restartScan(normalizeScanInput(input));
  };

  const startScan = (input?: CompatScanInput) => {
    return sdk.startScan(normalizeScanInput(input));
  };

  const discoverServicesAndChars = (deviceId: string, mac = '') => {
    const sourceDevice = findScannedDevice(deviceId, mac);
    const deviceName = sourceDevice?.displayName || sourceDevice?.deviceName || sourceDevice?.name || sourceDevice?.localName || sdk.deviceInfo.value.name || mac;
    return sdk.discoverServicesAndChars(deviceId, deviceName, sourceDevice);
  };

  const getCompatRefreshOptions = (params?: CompatRefreshOptions): CompatRefreshOptions => {
    const protocol = resolveRingProtocol(sdk.deviceInfo.value);
    const explicitParams = stripUndefinedCompatRefreshOptions(params);
    return {
      ...DEFAULT_COMPAT_REFRESH_OPTIONS,
      ...(protocol === 'rw'
        ? {
            includeRealtimeMetrics: false,
            includeHistorySnapshot: false
          }
        : {}),
      ...explicitParams,
      timeoutMs: explicitParams.timeoutMs ?? (protocol === 'rw' ? RW_COMPAT_REFRESH_TIMEOUT_MS : DEFAULT_COMPAT_REFRESH_TIMEOUT_MS)
    };
  };

  const refreshHealthData = (params?: CompatRefreshOptions) => {
    const requestedMetricNames = Array.isArray(params?.realtimeMetricNames) ? params.realtimeMetricNames : [];
    const reusedWearMeasurement = consumePendingLegacyWearMeasurement(requestedMetricNames);
    if (reusedWearMeasurement) {
      // 佩戴门禁已用同一条正式测量命令启动采集。页面继续等待同一 frameId
      // 的首个合法指标值，这里不能再次启停设备测量。门禁发送命令前已挂好
      // waiter，因此不会丢失设备紧接着返回的数值帧。
      return reusedWearMeasurement.completion.then(
        (record) => {
          // waitForParsedData 会先于批量 store flush 完成。实时测量页面在 Promise
          // 返回后会立即读取 store，若继续等待缓冲刷新就会把已经成功的测量误判为
          // “无数据”。这里将同一条最终记录同步写入统一运行态；store 自身按指标键
          // 去重，随后到达的正常缓冲 flush 不会产生重复业务数据。
          const completedAt = Date.now();
          const completedRecord =
            record && typeof record === 'object'
              ? {
                  ...(record as Record<string, any>),
                  timestamp: Number((record as Record<string, any>).timestamp) > 0 ? Number((record as Record<string, any>).timestamp) : completedAt,
                  receivedAt: Number((record as Record<string, any>).receivedAt) > 0 ? Number((record as Record<string, any>).receivedAt) : completedAt
                }
              : record;
          if (completedRecord && typeof completedRecord === 'object') {
            sdk.ringStore.handleParsedData(completedRecord as any);
          }
          appendRingDiagnosticLog('WEAR GATE', 'legacy-wear-measurement-completed', {
            kind: reusedWearMeasurement.kind,
            frameId: reusedWearMeasurement.frameId
          });
          return {
            status: 'success' as const,
            ok: requestedMetricNames.map((name) => String(name)),
            failed: [],
            record: completedRecord,
            measurementCompleted: true
          };
        },
        (error) => {
          // 保持单次命令语义：等待超时后交给页面的无数据提示处理，不再
          // fallback 发送第二条测量命令，避免设备处于采集中时被重复启动。
          appendRingDiagnosticLog('WEAR GATE', 'legacy-wear-measurement-timeout', {
            kind: reusedWearMeasurement.kind,
            frameId: reusedWearMeasurement.frameId,
            error: error instanceof Error ? error.message : String(error || 'timeout')
          });
          return {
            status: 'partial' as const,
            ok: requestedMetricNames.map((name) => String(name)),
            failed: []
          };
        }
      );
    }
    return runWithReady(async () => {
      try {
        return await sdk.refreshBusinessMetrics(getCompatRefreshOptions(params));
      } catch (error) {
        return createCompatRefreshFailure(error);
      }
    });
  };
  const syncHistoricalData = readLocalData;
  const cancelReadLocalData = () => sdk.clearDataListener?.();
  const syncAllHealthData = () => runWithReady(() => sdk.syncAllHealthData());
  const syncHealthDataByType = (name?: CompatRwHistoryDataName) => runWithReady(() => sdk.syncHealthDataByType(name ? normalizeCompatRwHistoryDataName(name) : undefined));
  const readRwHealthData = (name: CompatRwHealthDataName) => runWithReady(() => sdk.readRwHealthData(normalizeCompatRwHealthDataName(name)));
  const deleteRwHealthData = (name: CompatRwHealthDataName) => runWithReady(() => sdk.deleteRwHealthData(normalizeCompatRwHealthDataName(name)));
  const controlRwHealthData = (name: CompatRwHealthDataName, enabled = true) => runWithReady(() => sdk.controlRwHealthData(normalizeCompatRwHealthDataName(name), enabled));
  const readRwMonitoringConfig = (name: Parameters<typeof sdk.readRwMonitoringConfig>[0]) => runWithReady(() => sdk.readRwMonitoringConfig(name));
  const setRwMonitoringConfig = (name: Parameters<typeof sdk.setRwMonitoringConfig>[0], config: RwHealthMonitoringConfig) =>
    runWithReady(() => sdk.setRwMonitoringConfig(name, config));
  const setRwUserProfile = (profile: RwUserProfile) => runWithReady(() => sdk.setRwUserProfile(profile));
  const formatRwFileSystem = () => runWithReady(() => sdk.formatRwFileSystem());
  const getTimedHeartRateJL = () => runWithReady(() => sdk.getTimedHeartRateJL());
  const getTimedBloodOxygenJL = () => runWithReady(() => sdk.getTimedBloodOxygenJL());
  const getTimedHRVJL = () => runWithReady(() => sdk.getTimedHRVJL());
  const getTimedStressJL = () => runWithReady(() => sdk.getTimedStressJL());
  const getTimedBloodSugarJL = () => runWithReady(() => sdk.getTimedBloodSugarJL());
  const getTimedBloodPressureJL = () => runWithReady(() => sdk.getTimedBloodPressureJL());
  const getTimedTemperatureJL = () => runWithReady(() => sdk.getTimedTemperatureJL());
  const setTimedHeartRateJL = (config: RwHealthMonitoringConfig) => runWithReady(() => sdk.setTimedHeartRateJL(config));
  const setTimedBloodOxygenJL = (config: RwHealthMonitoringConfig) => runWithReady(() => sdk.setTimedBloodOxygenJL(config));
  const setTimedHRVJL = (config: RwHealthMonitoringConfig) => runWithReady(() => sdk.setTimedHRVJL(config));
  const setTimedStressJL = (config: RwHealthMonitoringConfig) => runWithReady(() => sdk.setTimedStressJL(config));
  const setTimedBloodSugarJL = (config: RwHealthMonitoringConfig) => runWithReady(() => sdk.setTimedBloodSugarJL(config));
  const setTimedBloodPressureJL = (config: RwHealthMonitoringConfig) => runWithReady(() => sdk.setTimedBloodPressureJL(config));
  const setTimedTemperatureJL = (config: RwHealthMonitoringConfig) => runWithReady(() => sdk.setTimedTemperatureJL(config));
  const controlHealthDataJL = (name: CompatRwHealthDataName, enabled = true) => runWithReady(() => sdk.controlHealthDataJL(normalizeCompatRwHealthDataName(name), enabled));
  const readBattery = (options: CompatDeviceInfoCommandOptions = {}) =>
    enqueueDeviceInfoCommand(
      'battery',
      async () => {
        // Writing 0x12 only proves that WeChat accepted the command.  The value
        // shown by the pages must come from the matching Notify response.  Start
        // the waiter before the write so a fast device response cannot be lost.
        const pendingBattery = sdk.waitForParsedData(
          (parsed) => parsed.type === 'battery',
          Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_COMPAT_REFRESH_TIMEOUT_MS,
          { replayRecent: false }
        );
        // If the write fails first, keep the waiter rejection observed while the
        // command error is propagated to the caller.
        pendingBattery.catch(() => undefined);
        await sdk.sendBatteryCommand();
        return pendingBattery;
      },
      { retryReady: options.retryReady }
    );
  const readFirmwareVersion = () => enqueueDeviceInfoCommand('firmware-version', () => sdk.sendFirmwareVersion());
  const readSoftwareVersion = () => enqueueDeviceInfoCommand('software-version', () => sdk.sendSoftwareVersion());
  const readHeartRate = () => {
    const reused = consumePendingLegacyWearMeasurement(['heart_rate']);
    return reused ? reused.completion : runWithReady(() => sdk.sendActiveMeasureCommand());
  };
  const readBloodOxygen = () => {
    const reused = consumePendingLegacyWearMeasurement(['blood_oxygen']);
    return reused ? reused.completion : runWithReady(() => sdk.sendOxyGenCommand());
  };
  const readBodyTemperature = () => {
    const reused = consumePendingLegacyWearMeasurement(['temperature']);
    return reused ? reused.completion : runWithReady(() => sdk.sendBodyTemperatureCommand());
  };
  /**
   * 在开始实时测量前主动读取当前佩戴状态。
   *
   * QKeer V2/RW 的 0x70（当天最后记录）回包包含独立的 isWorn 字节。
   * L19/HR18 旧协议没有单独的佩戴查询，因此用本次指标的正式测量命令读取硬件状态码；
   * 佩戴正确时继续复用这次已启动的测量，不再发送停止+重启命令。任何超时或未知状态都由上层
   * 按 fail-closed 处理，禁止在没有确认佩戴时继续发送正式测量命令。
   */
  const queryCurrentWearState = async (measurementKindOrTimeout: LegacyWearMeasurementKind | number = 'heart_rate', timeoutMs = 8000) => {
    const measurementKind = typeof measurementKindOrTimeout === 'number' ? 'heart_rate' : measurementKindOrTimeout;
    const requestedTimeoutMs = typeof measurementKindOrTimeout === 'number' ? measurementKindOrTimeout : timeoutMs;
    const protocol = resolveRingProtocol(sdk.deviceInfo.value);
    const boundedTimeoutMs = Math.max(4000, Math.min(12000, Number(requestedTimeoutMs) || 8000));

    if (protocol === 'legacy') {
      // 启动回包既是佩戴状态，也表示这次正式测量已开始。
      const probeConfig =
        measurementKind === 'blood_oxygen'
          ? {
              command: 0x32,
              payload: buildLegacyBloodOxygenMeasurementPayload(),
              type: 'active_OxyGenMeasure',
              statusField: 'bloodOxygenStatus'
            }
          : measurementKind === 'temperature'
            ? { command: 0x34, payload: 0x00, type: 'active_Temperature', statusField: 'temperatureStatus' }
            : {
                command: 0x31,
                payload: buildLegacyHeartRateMeasurementPayload(),
                type: 'active_measure',
                statusField: 'heartbeatStatus'
              };
      const frameId = createLegacyFrameId();
      const valuePromise = sdk.waitForParsedData(
        (parsed) => {
          if (parsed.type !== probeConfig.type || Number(parsed.frameId) !== frameId) return false;
          if (measurementKind === 'heart_rate') {
            const heartRate = Number((parsed as Record<string, any>).heartRate);
            return heartRate >= 25 && heartRate <= 240;
          }
          if (measurementKind === 'blood_oxygen') {
            const bloodOxygen = Number((parsed as Record<string, any>).bloodOxygen);
            return bloodOxygen >= 70 && bloodOxygen <= 100;
          }
          const temperature = Number.parseFloat(String((parsed as Record<string, any>).temperature || ''));
          return Number.isFinite(temperature) && temperature >= 25 && temperature <= 45;
        },
        35_000,
        { replayRecent: false }
      );
      valuePromise.catch(() => undefined);
      // B7/6E 固件在正确佩戴时会持续返回 status=3（采集中），但不一定返回
      // status=1 或进度 100。完成条件必须以“同一 frameId 的首个合法指标值”为准，
      // 否则已经拿到数值仍会空等约 30 秒并被上层超时。门禁命令本身就是正式
      // 测量命令，后续页面只复用这个 Promise，不会重复发送同一项测量命令。
      const completionPromise = valuePromise.then((valueRecord) => {
        appendRingDiagnosticLog('WEAR GATE', 'legacy-wear-measurement-value-ready', {
          measurementKind,
          frameId,
          measurementStatus: (valueRecord as Record<string, any>)[probeConfig.statusField]
        });
        return valueRecord;
      });
      completionPromise.catch(() => undefined);
      const responsePromise = sdk.waitForParsedData(
        (parsed) => {
          if (parsed.type !== probeConfig.type) return false;
          appendRingDiagnosticLog('WEAR GATE', 'legacy-wear-probe-candidate', {
            measurementKind,
            expectedFrameId: frameId,
            actualFrameId: parsed.frameId,
            measurementStatus: (parsed as Record<string, any>)[probeConfig.statusField],
            status: parsed.status
          });
          if (Number(parsed.frameId) !== frameId) return false;
          const status = Number((parsed as Record<string, any>)[probeConfig.statusField]);
          return status === 0x00 || status === 0x01 || status === 0x02 || status === 0x03 || status === 0x04;
        },
        Math.min(boundedTimeoutMs, 6000),
        { replayRecent: false }
      );
      responsePromise.catch(() => undefined);
      const measurementDeviceKey = getLegacyWearMeasurementDeviceKey();
      // 部分固件会在采集结束时返回 status=1，此时只清除“固件繁忙”状态。
      // 页面测量仍是一个整体事务，必须等最终值、弹层和结果页处理完成后再释放共享锁。
      const terminalStatusPromise = sdk.waitForParsedData(
        (parsed) => parsed.type === probeConfig.type && Number(parsed.frameId) === frameId && Number((parsed as Record<string, any>)[probeConfig.statusField]) === 0x01,
        LEGACY_WEAR_MEASUREMENT_BUSY_WINDOW_MS,
        { replayRecent: false }
      );
      terminalStatusPromise.then(
        () => {
          legacyWearMeasurementBusyUntilByDevice.delete(measurementDeviceKey);
        },
        () => undefined
      );
      appendRingDiagnosticLog('WEAR GATE', 'legacy-wear-probe-start', {
        protocol,
        measurementKind,
        durationSeconds: measurementKind === 'temperature' ? undefined : 30,
        frameId
      });
      markLegacyWearMeasurementBusy();
      try {
        await sdk.sendBytes(buildLegacyCommandBytes(probeConfig.command, 0x00, { frameId, payload: probeConfig.payload }), `wear-preflight/legacy-${measurementKind}`);
      } catch (error) {
        legacyWearMeasurementBusyUntilByDevice.delete(getLegacyWearMeasurementDeviceKey());
        throw error;
      }
      const parsed = await responsePromise;
      const status = Number((parsed as Record<string, any>)[probeConfig.statusField]);

      const measurementStarted = measurementKind === 'temperature' ? status === 0x00 : status === 0x03;
      if (status === 0x04) {
        legacyWearMeasurementBusyUntilByDevice.set(getLegacyWearMeasurementDeviceKey(), Date.now() + LEGACY_WEAR_MEASUREMENT_BUSY_RETRY_MS);
      } else if (!measurementStarted) {
        legacyWearMeasurementBusyUntilByDevice.delete(getLegacyWearMeasurementDeviceKey());
      }
      pendingLegacyWearMeasurement = measurementStarted
        ? {
            kind: measurementKind,
            frameId,
            expiresAt: Date.now() + LEGACY_WEAR_MEASUREMENT_BUSY_WINDOW_MS,
            completion: completionPromise
          }
        : null;
      appendRingDiagnosticLog('WEAR GATE', 'legacy-wear-probe-result', {
        protocol,
        measurementKind,
        measurementReused: measurementStarted,
        frameId,
        measurementStatus: (parsed as Record<string, any>)[probeConfig.statusField],
        status: parsed.status
      });
      const worn = measurementKind === 'temperature' ? status === 0x00 || status === 0x01 : status === 0x01 || status === 0x03;
      return {
        supported: true,
        protocol,
        state:
          status === 0x04 ? ('unknown' as const) : worn ? ('worn' as const) : measurementKind !== 'temperature' && status === 0x02 ? ('charging' as const) : ('not_worn' as const),
        record: parsed
      };
    }

    const responsePromise = sdk.waitForParsedData((parsed) => parsed.type === 'qkeer_v2_last_data' && typeof parsed.isWorn === 'boolean', boundedTimeoutMs, {
      replayRecent: false
    });
    // 命令发送失败时 waiter 仍会按自身超时结束；提前挂 catch 避免产生未处理拒绝。
    responsePromise.catch(() => undefined);
    if (protocol === 'rw') {
      await sdk.sendBytes(buildRwQkeerV2LastDataCommand(), 'wear-preflight/rw-last-data');
    } else if (protocol === 'qkeer-v2') {
      await readBodyTemperature();
    } else {
      throw new Error('当前设备不支持佩戴状态查询');
    }
    const parsed = await responsePromise;
    return {
      supported: true,
      protocol,
      state: parsed.isWorn === true ? ('worn' as const) : ('not_worn' as const),
      record: parsed
    };
  };
  const readDeviceTime = () => enqueueDeviceInfoCommand('device-time', () => sdk.readDeviceTime());
  // SDK 已按协议处理校时所需的 ready 策略；不要在兼容层再包一层恢复，
  // 否则 legacy 设备会在校时阶段重复恢复并阻塞历史读取。
  const updateDeviceTime = async (...args: Parameters<typeof sdk.updateDeviceTime>) => {
    await waitForHistoryCommandWindow('update-device-time');
    return sdk.updateDeviceTime(...args);
  };
  const sendDeleteAllLocalDataCommand = () => runWithReady(() => sdk.sendDeleteAllLocalDataCommand());
  const sendResetCommand = () => runWithReady(() => sdk.sendResetCommand());
  const sendFactoryResetWithTimeCommand = () => runWithReady(() => sdk.sendFactoryResetWithTimeCommand());
  const sendCollectPeriodSettingCommand = (...args: Parameters<typeof sdk.sendCollectPeriodSettingCommand>) => runWithReady(() => sdk.sendCollectPeriodSettingCommand(...args));
  const readCollectPeriodCommand = () => runWithReady(() => sdk.readCollectPeriodCommand());
  const readRwMetric = (name: CompatRwHealthDataName, legacyFallback?: () => Promise<unknown>) =>
    runWithReady(async () => {
      const normalizedName = normalizeCompatRwHealthDataName(name);
      if (resolveRingProtocol(sdk.deviceInfo.value) === 'rw') {
        await sdk.controlRwHealthData(normalizedName, true);
        try {
          await sleep(120);
          return await sdk.readRwHealthData(normalizedName);
        } finally {
          await sdk.controlRwHealthData(normalizedName, false).catch(() => undefined);
        }
      }
      if (legacyFallback) return legacyFallback();
      return sdk.refreshBusinessMetrics(DEFAULT_COMPAT_REFRESH_OPTIONS);
    });
  const readHrv = () => readRwMetric('hrv', () => sdk.sendActiveMeasureCommand());
  const readStress = () => readRwMetric('stress', () => sdk.sendActiveMeasureCommand());
  const readBloodSugar = () => readRwMetric('blood_sugar');
  const readBloodPressure = () => readRwMetric('blood_pressure');

  const normalizeCompatIdentity = (value = '') => value.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  const isColonSeparatedBleMac = (value?: string) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/.test(`${value || ''}`.trim());
  const isMacLikeCompatIdentity = (value = '') => normalizeCompatIdentity(value).length === 12;
  const getRwStableCompatIdentity = (device?: RingDeviceInfo | null, fallback = '') => {
    if (!device) return isMacLikeCompatIdentity(fallback) ? fallback : '';
    return device.mac || device.advertis?.macInfo || (isColonSeparatedBleMac(device.uniMacId) ? device.uniMacId : '') || (isMacLikeCompatIdentity(fallback) ? fallback : '');
  };
  const getScannedStableIdentities = (device: RingDeviceInfo) => {
    const protocol = resolveRingProtocol(device);
    if (protocol === 'rw') {
      return [device.mac, device.advertis?.macInfo, isColonSeparatedBleMac(device.uniMacId) ? device.uniMacId : ''];
    }
    return [device.uniMacId, device.mac, device.advertis?.macInfo];
  };
  const matchesScannedStableIdentity = (device: RingDeviceInfo, value = '', allowTail = false) => {
    const normalizedValue = normalizeCompatIdentity(value);
    if (normalizedValue.length < 6) return false;
    const stableIds = getScannedStableIdentities(device)
      .map((item) => normalizeCompatIdentity(`${item || ''}`))
      .filter((item) => item.length >= 6);
    return stableIds.some((item) => item === normalizedValue || (allowTail && (item.endsWith(normalizedValue.slice(-6)) || normalizedValue.endsWith(item.slice(-6)))));
  };

  const findScannedDevice = (deviceId: string, uniMacId = '') => {
    const sourceDevice = sdk.devices.value.find((device) => {
      const protocol = resolveRingProtocol(device);
      const stableTarget = [uniMacId, deviceId].find((item) => isMacLikeCompatIdentity(item)) || '';
      if (protocol === 'rw') {
        if (stableTarget) return matchesScannedStableIdentity(device, stableTarget, false);
        return Boolean(deviceId && device.deviceId === deviceId);
      }
      if (stableTarget) return matchesScannedStableIdentity(device, stableTarget, false);
      return (
        device.deviceId === deviceId ||
        matchesScannedStableIdentity(device, deviceId, false) ||
        device.deviceId === uniMacId ||
        matchesScannedStableIdentity(device, uniMacId, true) ||
        device.uniMacId === deviceId ||
        device.uniMacId === uniMacId
      );
    });
    return sourceDevice;
  };

  const findCompatScanCandidate = (deviceId: string, uniMacId = '', deviceName = '', protocolHint = '') => {
    const identityMatch = findScannedDevice(deviceId, uniMacId);
    if (identityMatch) return identityMatch;

    const hasStableMacTarget = [uniMacId, deviceId].some((item) => isMacLikeCompatIdentity(item));
    if (hasStableMacTarget) return undefined;

    const targetName = `${deviceName || ''}`.trim().toUpperCase();
    if (!targetName) return undefined;

    const nameMatches = sdk.devices.value.filter((device) => {
      const name = `${device.displayName || device.deviceName || device.name || device.localName || ''}`.trim().toUpperCase();
      if (name !== targetName) return false;
      if (!protocolHint) return true;
      return resolveRingProtocol(device) === protocolHint;
    });
    return nameMatches.length === 1 ? nameMatches[0] : undefined;
  };

  const findRwCompatScanCandidate = (deviceId: string, uniMacId = '', deviceName = '') => findCompatScanCandidate(deviceId, uniMacId, deviceName, 'rw');

  const waitForCompatScanCandidate = async (deviceId: string, uniMacId = '', deviceName = '', protocolHint = '') => {
    const existing = findCompatScanCandidate(deviceId, uniMacId, deviceName, protocolHint);
    if (existing?.deviceId) return existing;

    const scanTimeoutMs = options.rwCompatScanTimeoutMs ?? RW_COMPAT_SCAN_TIMEOUT_MS;
    const wasScanning = sdk.isScanning.value;
    if (!wasScanning) {
      await sdk.startScan({
        includeUnknown: true,
        allowDuplicatesKey: true,
        preserveDevices: true,
        timeoutMs: scanTimeoutMs
      });
    }

    const startedAt = Date.now();
    try {
      while (Date.now() - startedAt < scanTimeoutMs) {
        const candidate = findCompatScanCandidate(deviceId, uniMacId, deviceName, protocolHint);
        if (candidate?.deviceId) return candidate;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return findCompatScanCandidate(deviceId, uniMacId, deviceName, protocolHint);
    } finally {
      if (!wasScanning) {
        await sdk.stopScan().catch(() => undefined);
      }
    }
  };

  const waitForRwCompatScanCandidate = async (deviceId: string, uniMacId = '', deviceName = '') => {
    return waitForCompatScanCandidate(deviceId, uniMacId, deviceName, 'rw');
  };

  const isLikelyRwStableIdentity = (value = '') => isMacLikeCompatIdentity(value);

  const connectDevice = async (input: CompatConnectInput, deviceName = '', uniMacId = '', fromScan = false) => {
    const inputDevice = typeof input === 'string' ? null : input;
    const requestedId = typeof input === 'string' ? input : input.deviceId || input.uniMacId || input.mac || '';
    const preferredName = inputDevice?.displayName || inputDevice?.deviceName || inputDevice?.name || inputDevice?.localName || deviceName || requestedId;
    const preferredStableMac = getRwStableCompatIdentity(inputDevice, uniMacId) || inputDevice?.mac || inputDevice?.advertis?.macInfo || '';
    const preferredLookupId = uniMacId || preferredStableMac;
    let scannedDevice = findScannedDevice(requestedId, preferredLookupId);
    let sourceDevice: RingDeviceInfo | undefined = scannedDevice || inputDevice || undefined;
    const stableSourceMac = getRwStableCompatIdentity(sourceDevice, preferredStableMac) || getRwStableCompatIdentity(inputDevice, uniMacId);
    const protocolSource: RingDeviceInfo = {
      ...sourceDevice,
      ...inputDevice,
      deviceId: sourceDevice?.deviceId || (typeof input === 'string' ? requestedId : inputDevice?.deviceId || requestedId),
      uniMacId:
        stableSourceMac ||
        (resolveRingProtocol(sourceDevice || inputDevice || ({} as RingDeviceInfo)) === 'rw' ? '' : sourceDevice?.uniMacId || inputDevice?.uniMacId || preferredLookupId),
      mac: stableSourceMac,
      name: sourceDevice?.name || inputDevice?.name || preferredName,
      deviceName: sourceDevice?.deviceName || inputDevice?.deviceName || preferredName,
      localName: sourceDevice?.localName || inputDevice?.localName || preferredName,
      displayName: sourceDevice?.displayName || inputDevice?.displayName || preferredName,
      protocol: sourceDevice?.protocol || inputDevice?.protocol
    };
    const protocol = resolveRingProtocol(protocolSource);
    const shouldResolveRwStableId = protocol === 'rw' && !scannedDevice?.deviceId && isLikelyRwStableIdentity(requestedId);
    if ((fromScan || shouldResolveRwStableId) && !scannedDevice?.deviceId) {
      scannedDevice =
        protocol === 'rw'
          ? await waitForRwCompatScanCandidate(requestedId, preferredLookupId, preferredName)
          : await waitForCompatScanCandidate(requestedId, preferredLookupId, preferredName, protocol);
      sourceDevice = scannedDevice || sourceDevice;
    }
    const deviceId = sourceDevice?.deviceId || (typeof input === 'string' ? requestedId : inputDevice?.deviceId || requestedId);
    const connectionMac = getRwStableCompatIdentity(sourceDevice, stableSourceMac || preferredStableMac);
    if (protocol === 'rw' && shouldResolveRwStableId && !scannedDevice?.deviceId) {
      throw new Error('未找到 RW 设备的蓝牙连接 ID，请重新搜索后连接');
    }
    if (fromScan && !scannedDevice?.deviceId && isColonSeparatedBleMac(requestedId)) {
      throw new Error('未找到二维码对应的蓝牙设备，请靠近戒指后重试');
    }
    const connectSourceDevice =
      protocol === 'rw'
        ? {
            ...(sourceDevice || protocolSource),
            uniMacId: connectionMac,
            mac: connectionMac || sourceDevice?.mac || sourceDevice?.advertis?.macInfo || ''
          }
        : sourceDevice || protocolSource;
    return sdk.connectDevice({
      deviceId,
      deviceName: sourceDevice?.displayName || sourceDevice?.deviceName || sourceDevice?.name || sourceDevice?.localName || preferredName,
      uniMacId: protocol === 'rw' ? connectionMac : sourceDevice?.uniMacId || connectionMac,
      fromScan: fromScan || Boolean(sourceDevice),
      protocol,
      sourceDevice: connectSourceDevice,
      bindAfterConnected: true
    });
  };

  const handleConnectDevice = (deviceId: string, deviceName: string, uniMacId = '', _fromScan = false) => {
    return connectDevice(deviceId, deviceName, uniMacId, _fromScan);
  };

  return {
    ...sdk,
    connectedDeviceId,
    healthData,
    latestMetrics,
    normalMac,
    iosMacId,
    deviceTime,
    lastReadTimestamp,
    lastMetricUpdateAt,
    localData,
    historyRecords,
    startScan,
    restartScan,
    reScan,
    waitForRwCompatHistoryIdle: waitForRwCompatHistoryQueueIdle,
    readLocalData,
    cancelReadLocalData,
    connectDevice,
    handleConnectDevice,
    discoverServicesAndChars,
    refreshBusinessMetrics: refreshHealthData,
    refreshHealthData,
    refreshBusinessData: refreshHealthData,
    readHealthData: refreshHealthData,
    syncHistoricalData,
    syncHistoryData: syncHistoricalData,
    syncLocalData: syncHistoricalData,
    syncAllHealthData,
    syncHealthDataByType,
    readRwHealthData,
    deleteRwHealthData,
    controlRwHealthData,
    readRwMonitoringConfig,
    setRwMonitoringConfig,
    setRwUserProfile,
    formatRwFileSystem,
    getTimedHeartRateJL,
    getTimedBloodOxygenJL,
    getTimedHRVJL,
    getTimedStressJL,
    getTimedBloodSugarJL,
    getTimedBloodPressureJL,
    getTimedTemperatureJL,
    setTimedHeartRateJL,
    setTimedBloodOxygenJL,
    setTimedHRVJL,
    setTimedStressJL,
    setTimedBloodSugarJL,
    setTimedBloodPressureJL,
    setTimedTemperatureJL,
    controlHealthDataJL,
    sendBatteryCommand: readBattery,
    readDeviceTime,
    updateDeviceTime,
    sendDeleteAllLocalDataCommand,
    sendResetCommand,
    sendFactoryResetWithTimeCommand,
    sendCollectPeriodSettingCommand,
    readCollectPeriodCommand,
    sendFirmwareVersion: readFirmwareVersion,
    sendSoftwareVersion: readSoftwareVersion,
    sendActiveMeasureCommand: readHeartRate,
    sendOxyGenCommand: readBloodOxygen,
    sendBodyTemperatureCommand: readBodyTemperature,
    queryCurrentWearState,
    clearPendingLegacyWearMeasurement,
    waitForLegacyWearMeasurementIdle,
    vitalMeasurementLock,
    isVitalMeasurementLocked,
    vitalMeasurementLockKind,
    acquireVitalMeasurementLock,
    releaseVitalMeasurementLock,
    completeVitalMeasurement,
    getLegacyWearMeasurementBusyRemainingMs,
    syncVitalMeasurementLockWithLegacyBusy,
    readBattery,
    getBattery: readBattery,
    getBatteryInfo: readBattery,
    readFirmwareVersion,
    getFirmwareVersion: readFirmwareVersion,
    readSoftwareVersion,
    getSoftwareVersion: readSoftwareVersion,
    readHeartRate,
    getHeartRate: readHeartRate,
    measureHeartRate: readHeartRate,
    readHR: readHeartRate,
    getHR: readHeartRate,
    measureHR: readHeartRate,
    readBloodOxygen,
    getBloodOxygen: readBloodOxygen,
    measureBloodOxygen: readBloodOxygen,
    readOxygen: readBloodOxygen,
    getOxygen: readBloodOxygen,
    measureOxygen: readBloodOxygen,
    readSpO2: readBloodOxygen,
    getSpO2: readBloodOxygen,
    measureSpO2: readBloodOxygen,
    readSpo2: readBloodOxygen,
    getSpo2: readBloodOxygen,
    measureSpo2: readBloodOxygen,
    readBodyTemperature,
    getBodyTemperature: readBodyTemperature,
    measureBodyTemperature: readBodyTemperature,
    readSkinTemperature: readBodyTemperature,
    getSkinTemperature: readBodyTemperature,
    measureSkinTemperature: readBodyTemperature,
    readSkinTemp: readBodyTemperature,
    getSkinTemp: readBodyTemperature,
    measureSkinTemp: readBodyTemperature,
    readTemperature: readBodyTemperature,
    getTemperature: readBodyTemperature,
    measureTemperature: readBodyTemperature,
    readHrv,
    getHrv: readHrv,
    measureHrv: readHrv,
    readHRV: readHrv,
    getHRV: readHrv,
    measureHRV: readHrv,
    readStress,
    getStress: readStress,
    measureStress: readStress,
    readBloodSugar,
    getBloodSugar: readBloodSugar,
    measureBloodSugar: readBloodSugar,
    readBloodPressure,
    getBloodPressure: readBloodPressure,
    measureBloodPressure: readBloodPressure,
    readBP: readBloodPressure,
    getBP: readBloodPressure,
    measureBP: readBloodPressure
  };
};

const normalizeCompatRwHealthDataName = (name: CompatRwHealthDataName): RwHealthDataName => {
  const normalized = `${name}`.trim().replace(/-/g, '_').toLowerCase();
  if (normalized === 'heartrate' || normalized === 'heart_rate' || normalized === 'hr') return 'heart_rate';
  if (normalized === 'bloodoxygen' || normalized === 'blood_oxygen' || normalized === 'oxygen' || normalized === 'spo2') {
    return 'blood_oxygen';
  }
  if (
    normalized === 'bodytemperature' ||
    normalized === 'body_temperature' ||
    normalized === 'bodytemp' ||
    normalized === 'body_temp' ||
    normalized === 'skintemperature' ||
    normalized === 'skin_temperature' ||
    normalized === 'skintemp' ||
    normalized === 'skin_temp' ||
    normalized === 'temperature'
  ) {
    return 'temperature';
  }
  if (normalized === 'bloodsugar' || normalized === 'blood_sugar' || normalized === 'glucose') return 'blood_sugar';
  if (normalized === 'bloodpressure' || normalized === 'blood_pressure' || normalized === 'bp') return 'blood_pressure';
  if (normalized === 'hrv') return 'hrv';
  if (normalized === 'stress') return 'stress';
  return name as RwHealthDataName;
};

const normalizeCompatRwHistoryDataName = (name: CompatRwHistoryDataName): CompatRwHistoryDataName => {
  const normalized = `${name}`.trim().replace(/-/g, '_').toLowerCase();
  const compact = normalized.replace(/[_\s]/g, '');
  if (compact === 'sleep' || compact === 'sleepdata' || compact === 'sleepdetail' || compact === 'sleepdetails') return 'sleep';
  if (compact === 'step' || compact === 'steps' || compact === 'stepcount' || compact === 'sport' || compact === 'activity' || compact === 'dailyactivity') {
    return 'step';
  }
  return normalizeCompatRwHealthDataName(name as CompatRwHealthDataName);
};

const parseCompatHistorySinceTimestamp = (time: CompatHistoryTimeInput) => {
  if (time === '' || time === 'day') return getTodayZeroTimestamp();
  if (time instanceof Date) return normalizeCompatHistoryTimestamp(time.getTime());
  if (typeof time === 'number') return normalizeCompatHistoryTimestamp(time);

  const localDateStart = parseCompatLocalDateStartTimestamp(time);
  if (localDateStart) return localDateStart;

  const numericTime = Number(time);
  if (Number.isFinite(numericTime) && numericTime > 0) return normalizeCompatHistoryTimestamp(numericTime);

  const parsedTime = Date.parse(time);
  if (Number.isFinite(parsedTime)) return normalizeCompatHistoryTimestamp(parsedTime);
  return getTodayZeroTimestamp();
};

const parseCompatLocalDateStartTimestamp = (time: string) => {
  const matched = time.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!matched) return 0;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return 0;
  if (month < 1 || month > 12 || day < 1 || day > 31) return 0;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return 0;
  return Math.floor(date.getTime() / 1000);
};

const normalizeCompatHistoryTimestamp = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return getTodayZeroTimestamp();
  return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
};

const getTodayZeroTimestamp = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor(now.getTime() / 1000);
};
