import { computed, ref, watch } from 'vue';
import {
  isRingHistoryInProgress,
  resolveRingProtocol,
  type RefreshLegacyBusinessMetricsResult,
  type RingDeviceInfo,
  type RingProtocolKind,
  type SyncLegacyHistoryResult
} from '@/sdk/ring-ble';
import { formatBleErrorMessage } from '@/utils/bleError';
import { enqueueRwDiagnosticUpload } from '@/utils/rwDiagnosticUpload';
import { useRingBleStoreSdk } from './useRingBleStoreSdk';
import { getRingDeviceStableIdentity, isSameRingDevice } from './useRingBleSdk';
import type { UseRingBleSdkOptions } from './useRingBleSdk';
import { getRwDiagnosticCommandLock, type RwDiagnosticCommandLock } from '@/utils/rwDiagnosticCommandLock';

export interface UseRingBusinessControllerOptions extends UseRingBleSdkOptions {
  connectTimeoutMs?: number;
  refreshTimeoutMs?: number;
  historyTimeoutMs?: number;
  restoreTimeoutMs?: number;
  scanDeviceStaleMs?: number;
  scanFreshnessIntervalMs?: number;
  rwPendingRetryIntervalMs?: number;
  rwPendingRetryMaxCount?: number;
  rwMaintainRefreshIntervalMs?: number;
  rwEmptyRefreshRetryIntervalMs?: number;
  rwEmptyRefreshRetryMaxCount?: number;
  rwBackgroundRefreshEnabled?: boolean;
  businessDataStaleMs?: number;
  businessDataFreshnessIntervalMs?: number;
}

export interface ConnectBusinessRingOptions {
  forceProtocol?: RingProtocolKind;
  refreshAfterConnect?: boolean;
  replaceBinding?: boolean;
}

interface RefreshBusinessDataOptions {
  silent?: boolean;
  forceDeviceInfo?: boolean;
  includeDeviceInfo?: boolean;
  includeRealtimeMetrics?: boolean;
  realtimeMetricNames?: RwRealtimeMetricStep[];
  includeHistorySnapshot?: boolean;
}

interface RestoreLastBusinessDeviceOptions {
  refreshAfterRestore?: boolean;
}

interface SyncBusinessHistoryOptions {
  sinceTimestamp?: number;
  dataType?: string;
  dataTypes?: string[];
}

const DEFAULT_REFRESH_TIMEOUT_MS = 12000;
const RW_REFRESH_TIMEOUT_MS = 35000;
const DEFAULT_HISTORY_TIMEOUT_MS = 30000;
const DEFAULT_RESTORE_TIMEOUT_MS = 15000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15000;
const RW_RESTORE_TIMEOUT_MS = 75000;
const RW_CONNECT_TIMEOUT_MS = 60000;
const AUTO_REFRESH_STALE_MS = 30000;
const SCAN_DEVICE_STALE_MS = 45000;
const SCAN_FRESHNESS_INTERVAL_MS = 5000;
const RW_PENDING_RETRY_INTERVAL_MS = 8000;
const RW_PENDING_RETRY_MAX_COUNT = 8;
const RW_MAINTAIN_REFRESH_INTERVAL_MS = 60000;
const RW_EMPTY_REFRESH_RETRY_INTERVAL_MS = 5000;
const RW_EMPTY_REFRESH_RETRY_MAX_COUNT = 5;
const RW_EMPTY_REFRESH_FINAL_GRACE_MS = 300;
const BUSINESS_DATA_STALE_MS = 120000;
const BUSINESS_DATA_FRESHNESS_INTERVAL_MS = 5000;
const RW_HISTORY_DEVICE_TIME_SYNC_DEDUP_MS = 10 * 60 * 1000;
const RING_DIAGNOSTIC_LOG_STORAGE_KEY = 'qkeer:ring-diagnostic-logs';
const RING_DIAGNOSTIC_LOG_MAX_COUNT = 500;
const RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH = 4000;

type RwRealtimeMetricStep = 'heart_rate' | 'blood_oxygen' | 'temperature' | 'hrv' | 'stress' | 'blood_sugar' | 'blood_pressure';

const RW_REALTIME_METRIC_STEPS: RwRealtimeMetricStep[] = [
  'heart_rate',
  'blood_oxygen',
  'temperature',
  'hrv',
  'stress',
  'blood_sugar',
  'blood_pressure'
];

let defaultBusinessController: ReturnType<typeof createRingBusinessController> | null = null;

const isNodeRuntime = () => Boolean((globalThis as any).process?.versions?.node);

const padDiagnosticNumber = (value: number, length: number) => `${value}`.padStart(length, '0');

const formatDiagnosticTime = (date = new Date()) =>
  `${padDiagnosticNumber(date.getHours(), 2)}:${padDiagnosticNumber(date.getMinutes(), 2)}:${padDiagnosticNumber(date.getSeconds(), 2)}.${padDiagnosticNumber(date.getMilliseconds(), 3)}`;

const normalizeDiagnosticDetails = (details: unknown) => {
  if (details == null) return '';
  let text = '';
  if (typeof details === 'string') {
    text = details;
  } else {
    try {
      text = JSON.stringify(details);
    } catch {
      text = String(details);
    }
  }
  return text.length > RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH
    ? `${text.slice(0, RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH)}...<truncated>`
    : text;
};

const appendRingDiagnosticLog = (source: string, event: string, details?: unknown) => {
  if (isNodeRuntime()) return;
  try {
    const raw = uni.getStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY);
    const logs = Array.isArray(raw) ? raw : [];
    const entry = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      time: formatDiagnosticTime(),
      source,
      event,
      details: normalizeDiagnosticDetails(details)
    };
    logs.push(entry);
    uni.setStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY, logs.slice(-RING_DIAGNOSTIC_LOG_MAX_COUNT));
    enqueueRwDiagnosticUpload(entry);
  } catch {
    // Diagnostic logging must never affect business flow.
  }
};

export const useRingBusinessController = (options: UseRingBusinessControllerOptions = {}) => {
  if (Object.keys(options).length === 0) {
    if (!defaultBusinessController) {
      defaultBusinessController = createRingBusinessController(options);
    }
    return defaultBusinessController;
  }

  return createRingBusinessController(options);
};

const createRingBusinessController = (options: UseRingBusinessControllerOptions = {}) => {
  const ble = useRingBleStoreSdk(options);
  const metrics = computed(() => ble.ringStore.latestMetrics);
  const scanFreshnessNow = ref(Date.now());
  const businessDataFreshnessNow = ref(Date.now());
  const scanDeviceStaleMs = options.scanDeviceStaleMs ?? SCAN_DEVICE_STALE_MS;
  const scanFreshnessIntervalMs = options.scanFreshnessIntervalMs ?? SCAN_FRESHNESS_INTERVAL_MS;
  const rwPendingRetryIntervalMs = options.rwPendingRetryIntervalMs ?? RW_PENDING_RETRY_INTERVAL_MS;
  const rwPendingRetryMaxCount = options.rwPendingRetryMaxCount ?? RW_PENDING_RETRY_MAX_COUNT;
  const rwMaintainRefreshIntervalMs = options.rwMaintainRefreshIntervalMs ?? RW_MAINTAIN_REFRESH_INTERVAL_MS;
  const rwEmptyRefreshRetryIntervalMs = options.rwEmptyRefreshRetryIntervalMs ?? RW_EMPTY_REFRESH_RETRY_INTERVAL_MS;
  const rwEmptyRefreshRetryMaxCount = options.rwEmptyRefreshRetryMaxCount ?? RW_EMPTY_REFRESH_RETRY_MAX_COUNT;
  const rwBackgroundRefreshEnabled = options.rwBackgroundRefreshEnabled ?? false;
  const businessDataStaleMs = options.businessDataStaleMs ?? BUSINESS_DATA_STALE_MS;
  const businessDataFreshnessIntervalMs = options.businessDataFreshnessIntervalMs ?? BUSINESS_DATA_FRESHNESS_INTERVAL_MS;
  const businessDevices = computed(() => {
    const now = scanFreshnessNow.value;
    return ble.devices.value.filter((device) => isBusinessRingDevice(device) && isFreshBusinessDevice(device, ble.deviceInfo.value, now, scanDeviceStaleMs));
  });
  const lastRefreshResult = ref<RefreshLegacyBusinessMetricsResult | null>(null);
  const lastHistoryResult = ref<SyncLegacyHistoryResult | null>(null);
  const isRefreshingBusinessData = ref(false);
  const isSyncingHistory = ref(false);
  const isRestoringDevice = ref(false);
  const isHistoryPending = computed(() => isRingHistoryInProgress(metrics.value.historyStatus));
  const isReady = computed(() => hasBusinessCommunicationFields(ble.deviceInfo.value));
  const currentBusinessDeviceKey = computed(() => getCurrentBusinessDeviceKey(ble.deviceInfo.value));
  let refreshRequestId = 0;
  let historyRequestId = 0;
  let lastRefreshAt = 0;
  let lastRwDeviceTimeSyncAt = 0;
  let refreshPromise: Promise<RefreshLegacyBusinessMetricsResult> | null = null;
  let historyPromise: Promise<SyncLegacyHistoryResult> | null = null;
  let restorePromise: Promise<boolean> | null = null;
  let refreshStateTimer: ReturnType<typeof setTimeout> | null = null;
  let rwPendingRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let rwMaintainRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let rwEmptyRefreshRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let rwPendingRetryCount = 0;
  let rwPendingRetryMetricNames: RwRealtimeMetricStep[] | undefined;
  let rwEmptyRefreshRetryCount = 0;
  let isAutoRefreshPaused = false;
  let scanFreshnessTimer: ReturnType<typeof setInterval> | null = null;
  let businessDataFreshnessTimer: ReturnType<typeof setInterval> | null = null;

  const isBusinessRequestInFlight = () =>
    Boolean(refreshPromise) ||
    Boolean(historyPromise) ||
    Boolean(restorePromise) ||
    isRefreshingBusinessData.value ||
    isSyncingHistory.value ||
    isRestoringDevice.value;

  const clearRefreshStateTimer = () => {
    if (refreshStateTimer) {
      clearTimeout(refreshStateTimer);
      refreshStateTimer = null;
    }
  };

  const clearRwPendingRetryTimer = () => {
    if (rwPendingRetryTimer) {
      clearTimeout(rwPendingRetryTimer);
      rwPendingRetryTimer = null;
    }
  };

  const clearRwMaintainRefreshTimer = () => {
    if (rwMaintainRefreshTimer) {
      clearTimeout(rwMaintainRefreshTimer);
      rwMaintainRefreshTimer = null;
    }
  };

  const clearRwEmptyRefreshRetryTimer = () => {
    if (rwEmptyRefreshRetryTimer) {
      clearTimeout(rwEmptyRefreshRetryTimer);
      rwEmptyRefreshRetryTimer = null;
    }
  };

  const cancelBusinessRequests = () => {
    refreshRequestId += 1;
    historyRequestId += 1;
    refreshPromise = null;
    historyPromise = null;
    clearRefreshStateTimer();
    clearRwPendingRetryTimer();
    clearRwMaintainRefreshTimer();
    clearRwEmptyRefreshRetryTimer();
    rwPendingRetryCount = 0;
    rwPendingRetryMetricNames = undefined;
    rwEmptyRefreshRetryCount = 0;
    isRefreshingBusinessData.value = false;
    isSyncingHistory.value = false;
  };

  const clearScanFreshnessTimer = () => {
    if (scanFreshnessTimer) {
      clearInterval(scanFreshnessTimer);
      scanFreshnessTimer = null;
    }
  };

  const refreshScanFreshness = () => {
    scanFreshnessNow.value = Date.now();
  };

  const hasActiveFreshnessTrackedDevices = (now = Date.now()) =>
    ble.devices.value.some(
      (device) => typeof device.lastSeenAt === 'number' && now - device.lastSeenAt <= scanDeviceStaleMs + 5000
    );

  const ensureScanFreshnessTimer = () => {
    if (scanFreshnessTimer) return;
    scanFreshnessTimer = setInterval(() => {
      refreshScanFreshness();
      if (!ble.isScanning.value && !hasActiveFreshnessTrackedDevices(scanFreshnessNow.value)) {
        clearScanFreshnessTimer();
      }
    }, scanFreshnessIntervalMs);
    (scanFreshnessTimer as any).unref?.();
  };

  const ensureBusinessDataFreshnessTimer = () => {
    if (businessDataFreshnessTimer) return;
    businessDataFreshnessTimer = setInterval(() => {
      businessDataFreshnessNow.value = Date.now();
    }, businessDataFreshnessIntervalMs);
    (businessDataFreshnessTimer as any).unref?.();
  };

  ensureBusinessDataFreshnessTimer();

  const businessDataAgeMs = computed(() => {
    const lastMetricUpdateAt = ble.ringStore.lastMetricUpdateAt || ble.ringStore.healthData.lastMetricUpdateAt || 0;
    if (!lastMetricUpdateAt) return null;
    return Math.max(0, businessDataFreshnessNow.value - lastMetricUpdateAt);
  });
  const isBusinessDataStale = computed(() => businessDataAgeMs.value != null && businessDataAgeMs.value > businessDataStaleMs);
  const businessDataFreshnessText = computed(() => {
    const ageMs = businessDataAgeMs.value;
    if (ageMs == null) return '\u672a\u8bfb\u53d6';
    const elapsedSeconds = Math.max(1, Math.floor(ageMs / 1000));
    if (isBusinessDataStale.value && elapsedSeconds < 60) return `${elapsedSeconds}\u79d2\u524d\u66f4\u65b0\uff0c\u5efa\u8bae\u5237\u65b0`;
    if (elapsedSeconds < 10) return '\u521a\u521a\u66f4\u65b0';
    if (elapsedSeconds < 60) return `${elapsedSeconds}\u79d2\u524d\u66f4\u65b0`;
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (isBusinessDataStale.value) return `${elapsedMinutes}\u5206\u949f\u524d\u66f4\u65b0\uff0c\u5efa\u8bae\u5237\u65b0`;
    return `${elapsedMinutes}\u5206\u949f\u524d\u66f4\u65b0`;
  });

  const refreshFailedText = computed(() => {
    const failed = lastRefreshResult.value?.failed || [];
    return failed
      .filter((item) => !hasCurrentMetricValue(item.step, metrics.value))
      .map((item) => getBusinessFailureText(item.step, item.message))
      .join('\uff1b');
  });
  const historyResultText = computed(() => {
    return formatHistoryResultText(lastHistoryResult.value);
  });

  const scanForBusinessDevices = () => {
    appendRingDiagnosticLog('RW FLOW', 'scan-start', {
      includeUnknown: true,
      preserveDevices: true,
      timeoutMs: 30000
    });
    refreshScanFreshness();
    ensureScanFreshnessTimer();
    return ble.startScan({
      includeUnknown: true,
      allowDuplicatesKey: true,
      preserveDevices: true,
      timeoutMs: 30000
    });
  };

  const shouldAutoRefresh = () => {
    if (!lastRefreshAt) return true;
    if (isRwBusinessReady() && hasRwRefreshRecoverySignal()) return true;
    if (Date.now() - lastRefreshAt > AUTO_REFRESH_STALE_MS) return true;
    if (!isRwBusinessReady()) return false;
    if (!hasRwCoreMetricSnapshot()) return !hasLastRwRealtimeRefreshStep();
    if (metrics.value.heartRate == null && !hasLastRwRefreshStep('heart_rate')) return true;
    if (metrics.value.bloodOxygen == null && !hasLastRwRefreshStep('blood_oxygen')) return true;
    return false;
  };

  const hasCurrentDeviceIdentity = () => {
    const currentDevice = ble.deviceInfo.value;
    return Boolean(
      currentDevice.deviceId ||
        currentDevice.uniMacId ||
        currentDevice.mac ||
        currentDevice.advertis?.macInfo ||
        currentDevice.name ||
        currentDevice.deviceName ||
        currentDevice.localName ||
        currentDevice.displayName ||
        currentDevice.protocol
    );
  };

  const getResolvedCurrentProtocol = () => resolveRingProtocol(ble.deviceInfo.value);

  const isRwBusinessReady = () => {
    return getResolvedCurrentProtocol() === 'rw' && hasBusinessCommunicationFields(ble.deviceInfo.value);
  };

  const getCurrentOrBoundProtocol = () => {
    const boundDevice = ble.ringStore.boundDevice as RingDeviceInfo | null | undefined;
    if (hasCurrentDeviceIdentity()) return getResolvedCurrentProtocol();
    return boundDevice ? resolveRingProtocol(boundDevice) : undefined;
  };

  const isCurrentOrBoundRw = () => getCurrentOrBoundProtocol() === 'rw';

  const getRefreshTimeoutMs = () => {
    return options.refreshTimeoutMs ?? (isCurrentOrBoundRw() ? RW_REFRESH_TIMEOUT_MS : DEFAULT_REFRESH_TIMEOUT_MS);
  };

  const getConnectTimeoutMs = (protocol?: RingProtocolKind) => {
    return options.connectTimeoutMs ?? (protocol === 'rw' ? RW_CONNECT_TIMEOUT_MS : DEFAULT_CONNECT_TIMEOUT_MS);
  };

  const getRestoreTimeoutMs = () => {
    const protocol = getCurrentOrBoundProtocol();
    return options.restoreTimeoutMs ?? (protocol === 'rw' ? RW_RESTORE_TIMEOUT_MS : DEFAULT_RESTORE_TIMEOUT_MS);
  };

  const hasRwRefreshRecoverySignal = () => {
    const result = lastRefreshResult.value;
    if (!result || result.status === 'success') return false;
    if ((result.ok || []).length === 0) return true;
    return (result.failed || []).some((item) => /timeout/i.test(`${item.message || item.step || ''}`));
  };

  const hasRwPendingRealtimeMetrics = (metricNames = rwPendingRetryMetricNames || RW_REALTIME_METRIC_STEPS) => {
    if (!isRwBusinessReady()) return false;
    const retrySteps = metricNames.filter(
      (step) =>
        (getRwRealtimeMetricValue(metrics.value, step) == null || isPendingMetricStatus(getRwRealtimeMetricStatus(metrics.value, step))) &&
        !hasLastRwRefreshStep(step)
    );
    if (retrySteps.length === 0) return false;

    const failed = lastRefreshResult.value?.failed || [];
    if (failed.some((item) => retrySteps.includes(item.step as RwRealtimeMetricStep))) {
      return true;
    }

    return true;
  };

  const hasRwCoreMetricSnapshot = () => {
    return (
      metrics.value.battery != null ||
      Boolean(metrics.value.firmwareVersion || metrics.value.hardwareVersion || metrics.value.softwareVersion || metrics.value.uiVersion) ||
      RW_REALTIME_METRIC_STEPS.some((step) => getRwRealtimeMetricValue(metrics.value, step) != null)
    );
  };

  const getLastMetricUpdateAt = () => ble.ringStore.lastMetricUpdateAt || ble.ringStore.healthData.lastMetricUpdateAt || 0;
  const getNormalizedDataLength = () => (Array.isArray(ble.normalizedData.value) ? ble.normalizedData.value.length : 0);

  const hasRwCoreNormalizedDataSince = (minNormalizedDataLength: number) => {
    if (minNormalizedDataLength < 0 || !Array.isArray(ble.normalizedData.value)) return true;
    return ble.normalizedData.value.slice(minNormalizedDataLength).some((item: Record<string, any>) => {
      const sourceType = `${item?.sourceType || item?.type || ''}`;
      const itemMetrics = item?.metrics && typeof item.metrics === 'object' ? item.metrics : item;
      const status = `${itemMetrics?.status || item?.status || ''}`.trim().toLowerCase();
      if (status === 'pending' || status === 'requested') return false;
      if (['battery', 'firmware_version', 'hardwareVersion', 'softwareVersion'].includes(sourceType)) {
        return [itemMetrics?.value, itemMetrics?.battery, itemMetrics?.firmwareVersion, itemMetrics?.hardwareVersion, itemMetrics?.softwareVersion]
          .some(isResolvedDeviceInfoMetricValue);
      }
      if (sourceType !== 'rw_health_data') return false;
      const metricName = `${itemMetrics?.name || item.name || ''}`;
      if (!RW_REALTIME_METRIC_STEPS.includes(metricName as RwRealtimeMetricStep)) return false;
      return itemMetrics?.value != null || (Array.isArray(itemMetrics?.data) && itemMetrics.data.length > 0);
    });
  };

  const getResolvedRwDeviceInfoSteps = (minNormalizedDataLength = -1) => {
    const steps = new Set<string>();
    if (isResolvedDeviceInfoMetricValue(metrics.value.battery)) steps.add('battery');
    if ([metrics.value.firmwareVersion, metrics.value.hardwareVersion].some(isResolvedDeviceInfoMetricValue)) steps.add('firmware');
    if ([metrics.value.softwareVersion, metrics.value.uiVersion].some(isResolvedDeviceInfoMetricValue)) steps.add('software');

    if (minNormalizedDataLength >= 0 && Array.isArray(ble.normalizedData.value)) {
      ble.normalizedData.value.slice(minNormalizedDataLength).forEach((item: Record<string, any>) => {
        const sourceType = `${item?.sourceType || item?.type || ''}`;
        const itemMetrics = item?.metrics && typeof item.metrics === 'object' ? item.metrics : item;
        const status = `${itemMetrics?.status || item?.status || ''}`.trim().toLowerCase();
        if (status === 'pending' || status === 'requested') return;

        if (sourceType === 'battery' && [itemMetrics?.battery, itemMetrics?.value].some(isResolvedDeviceInfoMetricValue)) {
          steps.add('battery');
        }
        if (
          (sourceType === 'firmware_version' || sourceType === 'hardwareVersion') &&
          [itemMetrics?.firmwareVersion, itemMetrics?.hardwareVersion, itemMetrics?.value].some(isResolvedDeviceInfoMetricValue)
        ) {
          steps.add('firmware');
        }
        if (
          (sourceType === 'firmware_version' || sourceType === 'softwareVersion') &&
          [itemMetrics?.softwareVersion, itemMetrics?.uiVersion, itemMetrics?.value].some(isResolvedDeviceInfoMetricValue)
        ) {
          steps.add('software');
        }
      });
    }

    return steps;
  };

  const resolveRwDeviceInfoRefreshResult = (
    result: RefreshLegacyBusinessMetricsResult,
    minNormalizedDataLength = -1
  ): RefreshLegacyBusinessMetricsResult => {
    if (!isRwBusinessReady()) return result;

    const resolvedSteps = getResolvedRwDeviceInfoSteps(minNormalizedDataLength);
    if (resolvedSteps.size === 0) return result;

    const pendingByStep: Record<string, string[]> = {
      battery: ['battery_pending', 'battery_command_pending'],
      firmware: ['firmware_pending', 'firmware_command_pending'],
      software: ['software_pending', 'software_command_pending']
    };
    const pendingStepsToRemove = new Set(Array.from(resolvedSteps).flatMap((step) => pendingByStep[step] || []));
    const ok = Array.from(new Set([
      ...result.ok.filter((step) => !pendingStepsToRemove.has(step)),
      ...resolvedSteps
    ]));
    const failed = result.failed.filter((item) => !resolvedSteps.has(item.step));
    const resolvedResult: RefreshLegacyBusinessMetricsResult = {
      status: failed.length === 0 ? 'success' : ok.length > 0 ? 'partial' : 'failed',
      ok,
      failed
    };

    appendRingDiagnosticLog('RW FLOW', 'device-info-resolved-from-data', {
      steps: Array.from(resolvedSteps),
      before: result.ok,
      after: resolvedResult.ok
    });

    return resolvedResult;
  };

  const hasRwFreshCoreMetricSnapshot = (minMetricUpdateAt = 0, minNormalizedDataLength = -1) => {
    return (
      hasRwCoreMetricSnapshot() &&
      (!minMetricUpdateAt || getLastMetricUpdateAt() >= minMetricUpdateAt) &&
      hasRwCoreNormalizedDataSince(minNormalizedDataLength)
    );
  };

  const hasRwDeviceInfoCoreSnapshot = () => {
    return [
      metrics.value.battery,
      metrics.value.firmwareVersion,
      metrics.value.hardwareVersion,
      metrics.value.softwareVersion,
      metrics.value.uiVersion
    ].some(isResolvedDeviceInfoMetricValue);
  };

  const hasRwDeviceInfoCoreRefreshStep = (result: RefreshLegacyBusinessMetricsResult) => {
    const nonEmptySteps = new Set([
      'battery',
      'battery_cached',
      'firmware',
      'firmware_cached',
      'software',
      'software_cached',
      ...RW_REALTIME_METRIC_STEPS
    ]);
    return result.ok.some((step) => nonEmptySteps.has(step));
  };

  const hasLastRwRefreshStep = (step: string) => {
    const ok = lastRefreshResult.value?.ok || [];
    if (step === 'battery') return ok.includes('battery') || ok.includes('battery_cached');
    if (step === 'firmware') return ok.includes('firmware') || ok.includes('firmware_cached');
    if (step === 'software') return ok.includes('software') || ok.includes('software_cached');
    if (RW_REALTIME_METRIC_STEPS.includes(step as RwRealtimeMetricStep)) return ok.includes(step) || ok.includes(`${step}_skipped`);
    return ok.includes(step);
  };

  const hasLastRwRealtimeRefreshStep = () => {
    return RW_REALTIME_METRIC_STEPS.some((step) => hasLastRwRefreshStep(step));
  };

  const markRwEmptyRefreshExhausted = () => {
    lastRefreshResult.value = {
      status: 'failed',
      ok: lastRefreshResult.value?.ok || [],
      failed: [
        ...(lastRefreshResult.value?.failed || []).filter((item) => item.step !== 'rw_empty_refresh'),
        {
          step: 'rw_empty_refresh',
          message: 'RW connected device returned no core data after retries.'
        }
      ]
    };
  };

  const scheduleRwEmptyRefreshRetry = (
    result: RefreshLegacyBusinessMetricsResult,
    minMetricUpdateAt = 0,
    minNormalizedDataLength = -1
  ) => {
    clearRwEmptyRefreshRetryTimer();

    if (!rwBackgroundRefreshEnabled) return;
    if (isAutoRefreshPaused || !isRwBusinessReady()) return;
    if (hasRwDeviceInfoCoreRefreshStep(result) || hasRwFreshCoreMetricSnapshot(minMetricUpdateAt, minNormalizedDataLength)) {
      rwEmptyRefreshRetryCount = 0;
      return;
    }
    if (rwEmptyRefreshRetryCount >= rwEmptyRefreshRetryMaxCount) {
      rwEmptyRefreshRetryTimer = setTimeout(() => {
        rwEmptyRefreshRetryTimer = null;
        if (hasRwDeviceInfoCoreRefreshStep(lastRefreshResult.value || result) || hasRwFreshCoreMetricSnapshot(minMetricUpdateAt, minNormalizedDataLength)) {
          rwEmptyRefreshRetryCount = 0;
          return;
        }
        markRwEmptyRefreshExhausted();
      }, RW_EMPTY_REFRESH_FINAL_GRACE_MS);
      (rwEmptyRefreshRetryTimer as any).unref?.();
      return;
    }

    rwEmptyRefreshRetryTimer = setTimeout(async () => {
      rwEmptyRefreshRetryTimer = null;
      if (isAutoRefreshPaused || !isRwBusinessReady()) {
        return;
      }
      if (isRefreshingBusinessData.value || refreshPromise) {
        scheduleRwEmptyRefreshRetry(lastRefreshResult.value || result, minMetricUpdateAt, minNormalizedDataLength);
        return;
      }
      if (
        hasRwDeviceInfoCoreRefreshStep(lastRefreshResult.value || result) ||
        hasRwFreshCoreMetricSnapshot(minMetricUpdateAt, minNormalizedDataLength)
      ) {
        rwEmptyRefreshRetryCount = 0;
        return;
      }

      rwEmptyRefreshRetryCount += 1;
      await refreshBusinessDataSafely({
        silent: true,
        forceDeviceInfo: true,
        includeRealtimeMetrics: false,
        includeHistorySnapshot: false
      });
      if (!isAutoRefreshPaused && isRwBusinessReady()) {
        scheduleRwEmptyRefreshRetry(lastRefreshResult.value || result);
      }
    }, rwEmptyRefreshRetryIntervalMs);
    (rwEmptyRefreshRetryTimer as any).unref?.();
  };

  const scheduleRwPendingRealtimeRetry = () => {
    clearRwPendingRetryTimer();

    if (!rwBackgroundRefreshEnabled) return;
    if (isAutoRefreshPaused) return;
    if (!rwPendingRetryMetricNames?.length) {
      rwPendingRetryCount = 0;
      return;
    }

    if (!hasRwPendingRealtimeMetrics()) {
      rwPendingRetryCount = 0;
      return;
    }

    if (rwPendingRetryCount >= rwPendingRetryMaxCount) return;

    rwPendingRetryTimer = setTimeout(async () => {
      rwPendingRetryTimer = null;
      if (isAutoRefreshPaused) return;
      if (!hasRwPendingRealtimeMetrics() || isRefreshingBusinessData.value) {
        scheduleRwPendingRealtimeRetry();
        return;
      }

      rwPendingRetryCount += 1;
      await refreshBusinessDataSafely({
        silent: true,
        includeDeviceInfo: rwPendingRetryMetricNames?.length ? false : undefined,
        includeHistorySnapshot: false,
        realtimeMetricNames: rwPendingRetryMetricNames
      });
      scheduleRwPendingRealtimeRetry();
    }, rwPendingRetryIntervalMs);
    (rwPendingRetryTimer as any).unref?.();
  };

  const scheduleRwMaintainRefresh = () => {
    clearRwMaintainRefreshTimer();

    if (!rwBackgroundRefreshEnabled) return;
    if (isAutoRefreshPaused) return;
    if (!isRwBusinessReady()) return;

    rwMaintainRefreshTimer = setTimeout(async () => {
      rwMaintainRefreshTimer = null;
      if (isAutoRefreshPaused) return;
      if (!isRwBusinessReady()) return;

      if (!isRefreshingBusinessData.value && !refreshPromise) {
        appendRingDiagnosticLog('RW FLOW', 'maintain-ready-check', {
          deviceId: ble.deviceInfo.value.deviceId,
          serviceId: ble.deviceInfo.value.serviceId,
          cmdCharId: ble.deviceInfo.value.cmdCharId,
          dataServiceId: ble.deviceInfo.value.dataServiceId,
          dataCharId: ble.deviceInfo.value.dataCharId
        });
        const ready = await ble.ensureCommunicationReady().catch((error) => {
          appendRingDiagnosticLog('RW FLOW', 'maintain-ready-error', {
            message: formatBleErrorMessage(error, 'maintain ready failed')
          });
          return false;
        });
        appendRingDiagnosticLog('RW FLOW', 'maintain-ready-result', { ready });
      }

      if (!isAutoRefreshPaused && isRwBusinessReady()) {
        scheduleRwMaintainRefresh();
      }
    }, rwMaintainRefreshIntervalMs);
    (rwMaintainRefreshTimer as any).unref?.();
  };

  const getPostConnectRefreshOptions = (): RefreshBusinessDataOptions =>
    getResolvedCurrentProtocol() === 'rw'
      ? {
          silent: true,
          forceDeviceInfo: true,
          includeRealtimeMetrics: false,
          includeHistorySnapshot: false
        }
      : { silent: true };

  const schedulePostConnectDeviceInfoRefresh = (reason: string, details: Record<string, unknown>) => {
    if (getResolvedCurrentProtocol() !== 'rw') return;
    const diagnosticLock = getRwDiagnosticCommandLock();
    if (diagnosticLock || isAutoRefreshPaused) {
      appendRingDiagnosticLog('RW FLOW', 'post-connect-device-info-refresh-skip', {
        reason,
        ...details,
        skipReason: diagnosticLock ? 'rw-diagnostic-command-lock' : 'auto-refresh-paused',
        lock: diagnosticLock || undefined,
        deviceId: ble.deviceInfo.value.deviceId
      });
      return;
    }
    const startedAt = Date.now();
    appendRingDiagnosticLog('RW FLOW', 'post-connect-device-info-refresh-start', {
      reason,
      ...details,
      deviceId: ble.deviceInfo.value.deviceId
    });
    void refreshBusinessDataSafely(getPostConnectRefreshOptions()).then(() => {
      appendRingDiagnosticLog('RW FLOW', 'post-connect-device-info-refresh-result', {
        reason,
        elapsedMs: Date.now() - startedAt,
        result: lastRefreshResult.value,
        battery: metrics.value.battery,
        firmwareVersion: metrics.value.firmwareVersion,
        softwareVersion: metrics.value.softwareVersion
      });
    });
  };

  const getBoundBusinessDevice = () => (ble.ringStore.boundDevice as RingDeviceInfo | null | undefined) || null;

  const disconnectUnexpectedReadyDevice = async (reason: string, currentDevice: RingDeviceInfo, expectedDevice?: RingDeviceInfo | null) => {
    appendRingDiagnosticLog('RW FLOW', 'ready-device-identity-mismatch', {
      reason,
      current: summarizeBusinessRingDeviceIdentity(currentDevice),
      expected: summarizeBusinessRingDeviceIdentity(expectedDevice)
    });
    await ble.cancelPendingConnection(currentDevice.deviceId || '').catch(() => undefined);
    await ble.disconnect().catch(() => undefined);
    return false;
  };

  const ensureReadyDeviceMatchesBusinessIdentity = async (reason: string, expectedDevice?: RingDeviceInfo | null) => {
    const currentDevice = ble.deviceInfo.value;
    if (!hasBusinessCommunicationFields(currentDevice)) return false;

    const boundDevice = getBoundBusinessDevice();
    const strictExpectedDevice = expectedDevice || boundDevice;
    if (strictExpectedDevice && !isReadyBusinessDeviceMatchedBoundMac(currentDevice, strictExpectedDevice)) {
      return disconnectUnexpectedReadyDevice(`${reason}-scan-mac`, currentDevice, strictExpectedDevice);
    }

    if (strictExpectedDevice && !isSameBusinessRingDevice(currentDevice, strictExpectedDevice)) {
      return disconnectUnexpectedReadyDevice(reason, currentDevice, strictExpectedDevice);
    }

    if (boundDevice && expectedDevice && !isReadyBusinessDeviceMatchedBoundMac(currentDevice, boundDevice)) {
      return disconnectUnexpectedReadyDevice(`${reason}-bound-scan-mac`, currentDevice, boundDevice);
    }

    if (boundDevice && expectedDevice && !isSameBusinessRingDevice(currentDevice, boundDevice)) {
      return disconnectUnexpectedReadyDevice(`${reason}-bound`, currentDevice, boundDevice);
    }

    return true;
  };

  const restoreLastBusinessDevice = async (restoreOptions: RestoreLastBusinessDeviceOptions = {}) => {
    if (restorePromise) return restorePromise;
    const refreshAfterRestore = restoreOptions.refreshAfterRestore ?? true;

    if (isReady.value) {
      const readyMatchesBound = await ensureReadyDeviceMatchesBusinessIdentity('restore-already-ready');
      if (!readyMatchesBound) {
        appendRingDiagnosticLog('RW FLOW', 'restore-ready-mismatch-retry', {
          refreshAfterRestore
        });
      } else {
        const diagnosticLock = getRwDiagnosticCommandLock();
        if (!diagnosticLock) isAutoRefreshPaused = false;
        await syncRwDeviceTimeAfterReady('ready', {
          reason: 'restore-already-ready'
        });
        if (refreshAfterRestore && shouldAutoRefresh() && getResolvedCurrentProtocol() !== 'rw') {
          await refreshBusinessDataSafely();
        } else if (!refreshAfterRestore && getResolvedCurrentProtocol() === 'rw') {
          schedulePostConnectDeviceInfoRefresh('restore-already-ready-background', {
            refreshAfterRestore
          });
        }
        if (!diagnosticLock && !isAutoRefreshPaused) {
          scheduleRwMaintainRefresh();
        } else {
          appendRingDiagnosticLog('RW FLOW', 'restore-auto-refresh-held', {
            reason: diagnosticLock ? 'rw-diagnostic-command-lock' : 'auto-refresh-paused',
            lock: diagnosticLock || undefined,
            refreshAfterRestore,
            deviceId: ble.deviceInfo.value.deviceId
          });
        }
        return true;
      }
    }

    isRestoringDevice.value = true;
    restorePromise = (async () => {
      const timeoutMs = getRestoreTimeoutMs();
      const boundDevice = ble.ringStore.boundDevice as RingDeviceInfo | null | undefined;
      appendRingDiagnosticLog('RW FLOW', 'restore-start', {
        timeoutMs,
        currentProtocol: getResolvedCurrentProtocol(),
        boundProtocol: boundDevice ? resolveRingProtocol(boundDevice) : undefined,
        currentDeviceId: ble.deviceInfo.value.deviceId,
        boundDeviceId: boundDevice?.deviceId,
        boundIdentity: boundDevice ? getRingDeviceStableIdentity(boundDevice) : '',
        refreshAfterRestore
      });
      const result = await withTimeout(
        ble.autoConnectLastDevice().then((success) => ({ success, timedOut: false })),
        timeoutMs,
        () => ({ success: false, timedOut: true })
      );
      if (result.timedOut) {
        await ble.cancelPendingConnection();
        lastRefreshResult.value = createRestoreTimeoutResult();
        appendRingDiagnosticLog('RW FLOW', 'restore-timeout', {
          timeoutMs,
          currentDeviceId: ble.deviceInfo.value.deviceId,
          boundDeviceId: boundDevice?.deviceId,
          boundIdentity: boundDevice ? getRingDeviceStableIdentity(boundDevice) : ''
        });
        return false;
      }
      if (result.success) {
        if (!isReady.value) {
          appendRingDiagnosticLog('RW FLOW', 'restore-not-ready', {
            timeoutMs,
            deviceInfo: ble.deviceInfo.value
          });
          return false;
        }
        const readyMatchesBound = await ensureReadyDeviceMatchesBusinessIdentity('restore-success');
        if (!readyMatchesBound) {
          appendRingDiagnosticLog('RW FLOW', 'restore-result', {
            success: false,
            reason: 'ready-device-identity-mismatch',
            timeoutMs,
            currentDeviceId: ble.deviceInfo.value.deviceId,
            boundDeviceId: boundDevice?.deviceId,
            boundIdentity: boundDevice ? getRingDeviceStableIdentity(boundDevice) : ''
          });
          return false;
        }
        const diagnosticLock = getRwDiagnosticCommandLock();
        if (!diagnosticLock) isAutoRefreshPaused = false;
        await syncRwDeviceTimeAfterReady('ready', {
          reason: 'restore-success',
          timeoutMs
        });
        if (refreshAfterRestore && getResolvedCurrentProtocol() !== 'rw') {
          await refreshBusinessDataSafely();
        } else if (!refreshAfterRestore && getResolvedCurrentProtocol() === 'rw') {
          schedulePostConnectDeviceInfoRefresh('restore-success-background', {
            refreshAfterRestore,
            timeoutMs
          });
        }
        if (!diagnosticLock && !isAutoRefreshPaused) {
          scheduleRwMaintainRefresh();
        } else {
          appendRingDiagnosticLog('RW FLOW', 'restore-auto-refresh-held', {
            reason: diagnosticLock ? 'rw-diagnostic-command-lock' : 'auto-refresh-paused',
            lock: diagnosticLock || undefined,
            refreshAfterRestore,
            timeoutMs,
            deviceId: ble.deviceInfo.value.deviceId
          });
        }
        appendRingDiagnosticLog('RW FLOW', 'restore-result', {
          success: true,
          timeoutMs,
          deviceId: ble.deviceInfo.value.deviceId,
          serviceId: ble.deviceInfo.value.serviceId,
          cmdCharId: ble.deviceInfo.value.cmdCharId,
          dataServiceId: ble.deviceInfo.value.dataServiceId,
          dataCharId: ble.deviceInfo.value.dataCharId
        });
        return true;
      }
      appendRingDiagnosticLog('RW FLOW', 'restore-result', {
        success: false,
        timeoutMs,
        currentDeviceId: ble.deviceInfo.value.deviceId,
        boundDeviceId: boundDevice?.deviceId,
        boundIdentity: boundDevice ? getRingDeviceStableIdentity(boundDevice) : ''
      });
      return false;
    })();

    try {
      return await restorePromise;
    } catch (error) {
      appendRingDiagnosticLog('RW FLOW', 'restore-error', {
        message: formatBleErrorMessage(error, '\u8bbe\u5907\u6062\u590d\u5931\u8d25')
      });
      lastRefreshResult.value = {
        status: 'failed',
        ok: [],
        failed: [
          {
            step: 'restore',
            message: formatBleErrorMessage(error, '\u8bbe\u5907\u6062\u590d\u5931\u8d25')
          }
        ]
      };
      return false;
    } finally {
      isRestoringDevice.value = false;
      restorePromise = null;
    }
  };

  const refreshBusinessData = async (refreshOptions: RefreshBusinessDataOptions = {}) => {
    const silent = refreshOptions.silent ?? false;
    rwPendingRetryMetricNames = refreshOptions.realtimeMetricNames?.length
      ? [...refreshOptions.realtimeMetricNames]
      : undefined;
    if (refreshPromise) {
      if (!silent && !isRefreshingBusinessData.value) {
        const joinedRequestId = refreshRequestId;
        const timeoutMs = getRefreshTimeoutMs();
        clearRefreshStateTimer();
        isRefreshingBusinessData.value = true;
        refreshStateTimer = setTimeout(() => {
          if (joinedRequestId !== refreshRequestId || !isRefreshingBusinessData.value) return;
          isRefreshingBusinessData.value = false;
        }, timeoutMs + 1000);
        (refreshStateTimer as any).unref?.();

        try {
          return await refreshPromise;
        } finally {
          if (joinedRequestId === refreshRequestId) {
            clearRefreshStateTimer();
            isRefreshingBusinessData.value = false;
          }
        }
      }

      return refreshPromise;
    }

    const requestId = (refreshRequestId += 1);
    if (!silent) {
      isRefreshingBusinessData.value = true;
    }
    const timeoutMs = getRefreshTimeoutMs();
    const normalizedDataLengthAtStart = getNormalizedDataLength();
    const includeDeviceInfo =
      refreshOptions.includeDeviceInfo ??
      (refreshOptions.forceDeviceInfo || !silent || !lastRefreshResult.value || !hasRwDeviceInfoCoreSnapshot());
    const includeRealtimeMetrics =
      refreshOptions.includeRealtimeMetrics ??
      (isCurrentOrBoundRw() ? Boolean(refreshOptions.realtimeMetricNames?.length) : true);
    const includeHistorySnapshot =
      refreshOptions.includeHistorySnapshot ?? (isCurrentOrBoundRw() ? false : true);
    appendRingDiagnosticLog('RW FLOW', 'refresh-start', {
      silent,
      timeoutMs,
      protocol: getResolvedCurrentProtocol(),
      effectiveProtocol: getCurrentOrBoundProtocol(),
      includeDeviceInfo,
      includeRealtimeMetrics,
      realtimeMetricNames: refreshOptions.realtimeMetricNames,
      includeHistorySnapshot,
      forceDeviceInfo: refreshOptions.forceDeviceInfo
    });
    const refreshTask = ble.refreshBusinessMetrics({
      timeoutMs,
      includeCollectPeriod: false,
      includeDeviceTime: false,
      includeDeviceInfo,
      includeRealtimeMetrics,
      realtimeMetricNames: refreshOptions.realtimeMetricNames,
      includeHistorySnapshot
    });

    clearRefreshStateTimer();
    if (!silent) {
      refreshStateTimer = setTimeout(() => {
        if (requestId !== refreshRequestId || !isRefreshingBusinessData.value) return;
        lastRefreshResult.value = lastRefreshResult.value || createRefreshTimeoutResult();
        lastRefreshAt = Date.now();
        refreshPromise = null;
        isRefreshingBusinessData.value = false;
      }, timeoutMs + 1000);
      (refreshStateTimer as any).unref?.();
    }

    const currentPromise = (async () => {
      const rawResult = await withTimeout(
        refreshTask,
        timeoutMs,
        createRefreshTimeoutResult
      );
      const result = resolveRwDeviceInfoRefreshResult(rawResult, normalizedDataLengthAtStart);
      if (requestId === refreshRequestId) {
        lastRefreshResult.value = silent ? createSilentVisibleRefreshResult(result, lastRefreshResult.value) : result;
        lastRefreshAt = Date.now();
        appendRingDiagnosticLog('RW FLOW', 'refresh-result', {
          status: result.status,
          ok: result.ok,
          failed: result.failed
        });
        scheduleRwMaintainRefresh();
      }
      return result;
    })();

    refreshPromise = currentPromise;

    try {
      return await currentPromise;
    } catch (error) {
      if (requestId !== refreshRequestId) {
        return lastRefreshResult.value || createRefreshTimeoutResult();
      }
      appendRingDiagnosticLog('RW FLOW', 'refresh-throw', {
        message: formatBleErrorMessage(error, 'business refresh failed')
      });
      throw error;
    } finally {
      if (refreshPromise === currentPromise) {
        refreshPromise = null;
      }
      if (requestId === refreshRequestId) {
        if (!silent) {
          clearRefreshStateTimer();
          isRefreshingBusinessData.value = false;
        }
        scheduleRwMaintainRefresh();
      }
    }
  };

  const refreshBusinessDataSafely = async (refreshOptions: RefreshBusinessDataOptions = {}) => {
    try {
      await refreshBusinessData(refreshOptions);
    } catch (error) {
      appendRingDiagnosticLog('RW FLOW', 'refresh-safe-error', {
        silent: refreshOptions.silent,
        message: formatBleErrorMessage(error, '\u8bbe\u5907\u6570\u636e\u6682\u672a\u8fd4\u56de')
      });
      const failedResult: RefreshLegacyBusinessMetricsResult = {
        status: 'failed',
        ok: lastRefreshResult.value?.ok || [],
        failed: [
          {
            step: 'refresh',
            message: formatBleErrorMessage(error, '\u8bbe\u5907\u6570\u636e\u6682\u672a\u8fd4\u56de')
          }
        ]
      };
      lastRefreshResult.value = refreshOptions.silent
        ? createSilentVisibleRefreshResult(failedResult, lastRefreshResult.value)
        : failedResult;
      scheduleRwMaintainRefresh();
    }
  };

  const refreshDeviceInfoData = async () => {
    appendRingDiagnosticLog('RW FLOW', 'device-info-refresh-start', {
      ready: isReady.value,
      deviceId: ble.deviceInfo.value.deviceId
    });
    if (!isReady.value) {
      const restored = await restoreLastBusinessDevice({ refreshAfterRestore: false });
      if (!restored) {
        throw new Error('\u8bbe\u5907\u901a\u4fe1\u672a\u5c31\u7eea\uff0c\u8bf7\u91cd\u65b0\u8fde\u63a5\u540e\u518d\u8bfb\u53d6\u8bbe\u5907\u4fe1\u606f');
      }
    }

    if (refreshPromise) {
      appendRingDiagnosticLog('RW FLOW', 'device-info-wait-active-refresh', {
        deviceId: ble.deviceInfo.value.deviceId
      });
      await refreshPromise.catch(() => undefined);
      if (getResolvedCurrentProtocol() === 'rw' && hasRwDeviceInfoCoreSnapshot()) {
        const cachedResult = createDeviceInfoVisibleRefreshResult(
          lastRefreshResult.value || {
            status: 'success',
            ok: Array.from(getResolvedRwDeviceInfoSteps()),
            failed: []
          },
          lastRefreshResult.value
        );
        lastRefreshResult.value = cachedResult;
        appendRingDiagnosticLog('RW FLOW', 'device-info-refresh-reuse-active-result', {
          status: cachedResult.status,
          ok: cachedResult.ok,
          failed: cachedResult.failed,
          battery: metrics.value.battery,
          firmwareVersion: metrics.value.firmwareVersion,
          softwareVersion: metrics.value.softwareVersion
        });
        return cachedResult;
      }
    }

    const requestId = (refreshRequestId += 1);
    const timeoutMs = getRefreshTimeoutMs();
    const normalizedDataLengthAtStart = getNormalizedDataLength();
    const deviceInfoRefreshTask = withTimeout(
      ble.refreshBusinessMetrics({
        timeoutMs,
        includeDeviceInfo: true,
        includeDeviceTime: false,
        includeCollectPeriod: false,
        includeRealtimeMetrics: false,
        includeHistorySnapshot: false
      }),
      timeoutMs,
      createRefreshTimeoutResult
    );
    refreshPromise = deviceInfoRefreshTask;
    let result: RefreshLegacyBusinessMetricsResult;
    try {
      result = resolveRwDeviceInfoRefreshResult(await deviceInfoRefreshTask, normalizedDataLengthAtStart);
    } finally {
      if (refreshPromise === deviceInfoRefreshTask) {
        refreshPromise = null;
      }
    }
    if (requestId === refreshRequestId) {
      lastRefreshResult.value = createDeviceInfoVisibleRefreshResult(result, lastRefreshResult.value);
      lastRefreshAt = Date.now();
      appendRingDiagnosticLog('RW FLOW', 'device-info-refresh-result', {
        status: result.status,
        ok: result.ok,
        failed: result.failed
      });
      scheduleRwMaintainRefresh();
    }
    return result;
  };

  const syncRwDeviceTimeAfterReady = async (phase: 'ready' | 'history', details: Record<string, unknown>) => {
    if (isNodeRuntime()) return;
    if (getResolvedCurrentProtocol() !== 'rw' || !isReady.value) return;

    const diagnosticLock = getRwDiagnosticCommandLock();
    if (diagnosticLock) {
      appendRingDiagnosticLog('RW FLOW', `${phase}-device-time-sync-skip`, {
        ...details,
        reason: 'rw-diagnostic-command-lock',
        lock: diagnosticLock,
        deviceId: ble.deviceInfo.value.deviceId
      });
      return;
    }

    const now = Date.now();
    const ageMs = lastRwDeviceTimeSyncAt > 0 ? now - lastRwDeviceTimeSyncAt : Number.POSITIVE_INFINITY;
    if (ageMs >= 0 && ageMs < RW_HISTORY_DEVICE_TIME_SYNC_DEDUP_MS) {
      appendRingDiagnosticLog('RW FLOW', `${phase}-device-time-sync-skip`, {
        ...details,
        ageMs,
        deviceId: ble.deviceInfo.value.deviceId
      });
      return;
    }

    const timezone = -new Date(now).getTimezoneOffset() / 60;
    appendRingDiagnosticLog('RW FLOW', `${phase}-device-time-sync-start`, {
      ...details,
      timestampMs: now,
      timezone,
      deviceId: ble.deviceInfo.value.deviceId
    });
    try {
      await ble.updateDeviceTime(now, timezone);
      lastRwDeviceTimeSyncAt = Date.now();
      appendRingDiagnosticLog('RW FLOW', `${phase}-device-time-sync-result`, {
        ...details,
        timestampMs: now,
        timezone,
        deviceId: ble.deviceInfo.value.deviceId
      });
    } catch (error) {
      appendRingDiagnosticLog('RW FLOW', `${phase}-device-time-sync-failed`, {
        ...details,
        error: formatBleErrorMessage(error, '设备时间校准失败'),
        deviceId: ble.deviceInfo.value.deviceId
      });
    }
  };

  const syncRwDeviceTimeBeforeHistory = (details: Record<string, unknown>) =>
    syncRwDeviceTimeAfterReady('history', details);

  const syncBusinessHistory = async (readAll = false, historyOptions: SyncBusinessHistoryOptions = {}) => {
    const requestedDataTypes = Array.isArray(historyOptions.dataTypes) ? historyOptions.dataTypes.filter(Boolean) : [];
    const requestedHistoryDetails = {
      readAll,
      ...(historyOptions.sinceTimestamp === undefined ? {} : { sinceTimestamp: historyOptions.sinceTimestamp }),
      ...(historyOptions.dataType ? { dataType: historyOptions.dataType } : {}),
      ...(requestedDataTypes.length > 0 ? { dataTypes: requestedDataTypes } : {})
    };

    const diagnosticLock = getRwDiagnosticCommandLock();
    if (diagnosticLock && resolveRingProtocol(ble.deviceInfo.value) === 'rw') {
      appendRingDiagnosticLog('RW FLOW', 'history-sync-skip', {
        ...requestedHistoryDetails,
        reason: 'rw-diagnostic-command-lock',
        lock: diagnosticLock,
        deviceId: ble.deviceInfo.value.deviceId,
        stableIdentity: getRingDeviceStableIdentity(ble.deviceInfo.value)
      });
      return createHistorySkippedResult(diagnosticLock);
    }

    if (historyPromise) {
      appendRingDiagnosticLog('RW FLOW', 'history-sync-reuse-inflight', {
        ...requestedHistoryDetails,
        currentDeviceId: ble.deviceInfo.value.deviceId,
        stableIdentity: getRingDeviceStableIdentity(ble.deviceInfo.value)
      });
      return historyPromise;
    }

    const requestId = (historyRequestId += 1);
    isSyncingHistory.value = true;

    const currentHistoryPromise = (async () => {
      try {
      if (!isReady.value) {
        const restored = await restoreLastBusinessDevice({ refreshAfterRestore: false });
        if (!restored) {
          throw new Error('\u8bbe\u5907\u901a\u4fe1\u672a\u5c31\u7eea\uff0c\u8bf7\u91cd\u65b0\u8fde\u63a5\u540e\u518d\u540c\u6b65\u5386\u53f2');
        }
      }

      await syncRwDeviceTimeBeforeHistory(requestedHistoryDetails);

      if (getResolvedCurrentProtocol() === 'rw') {
        appendRingDiagnosticLog('RW FLOW', 'history-sync-start', {
          ...requestedHistoryDetails,
          lastReadTimestamp: ble.ringStore.lastReadTimestamp,
          deviceId: ble.deviceInfo.value.deviceId,
          stableIdentity: getRingDeviceStableIdentity(ble.deviceInfo.value)
        });
      }

      const historyTask = ble.syncHistory({
        readAll,
        ...(historyOptions.sinceTimestamp === undefined ? {} : { sinceTimestamp: historyOptions.sinceTimestamp }),
        ...(historyOptions.dataType ? { dataType: historyOptions.dataType } : {}),
        ...(requestedDataTypes.length > 0 ? { dataTypes: requestedDataTypes } : {}),
        deleteAfterUpload: false
      });
      const result = await withTimeout(
        historyTask,
        options.historyTimeoutMs ?? DEFAULT_HISTORY_TIMEOUT_MS,
        createHistoryTimeoutResult
      );
      if (requestId === historyRequestId) {
        lastHistoryResult.value = result;
        if (getResolvedCurrentProtocol() === 'rw') {
          const summary = summarizeHistorySyncResult(result);
          appendRingDiagnosticLog('RW FLOW', 'history-sync-result', {
            ...summary,
            ...requestedHistoryDetails,
            dataTypes: Array.from(new Set([...(summary.dataTypes || []), ...requestedDataTypes]))
          });
        }
      }
      return result;
    } catch (error) {
      if (requestId === historyRequestId) {
        lastHistoryResult.value = createHistoryFailureResult(error);
        if (getResolvedCurrentProtocol() === 'rw') {
          appendRingDiagnosticLog('RW FLOW', 'history-sync-failed', {
            ...requestedHistoryDetails,
            error: formatBleErrorMessage(error, '\u5386\u53f2\u540c\u6b65\u5931\u8d25')
          });
        }
      } else {
        return lastHistoryResult.value || createHistoryTimeoutResult();
      }
      throw error;
    } finally {
      if (requestId === historyRequestId) {
        isSyncingHistory.value = false;
      }
    }
    })();

    historyPromise = currentHistoryPromise;

    try {
      return await currentHistoryPromise;
    } finally {
      if (historyPromise === currentHistoryPromise) {
        historyPromise = null;
      }
    }
  };

  const connectBusinessDevice = async (device: RingDeviceInfo, connectOptions: ConnectBusinessRingOptions = {}) => {
    const platformDeviceId = getRingBusinessPlatformDeviceId(device);
    const stableIdentity = getRingDeviceStableIdentity(device);
    const deviceName = getRingBusinessDeviceName(device);
    const protocol = resolveRingProtocol({ ...device, protocol: connectOptions.forceProtocol || device.protocol });
    const connectTimeoutMs = getConnectTimeoutMs(protocol);

    if (isSameBusinessRingDevice(ble.deviceInfo.value, device) && isReady.value) {
      const readyMatchesTarget = await ensureReadyDeviceMatchesBusinessIdentity('connect-same-device-ready', device);
      if (!readyMatchesTarget) {
        appendRingDiagnosticLog('RW FLOW', 'connect-ready-mismatch-retry', {
          target: summarizeBusinessRingDeviceIdentity(device)
        });
      } else {
        isAutoRefreshPaused = false;
        await syncRwDeviceTimeAfterReady('ready', {
          reason: 'connect-same-device-ready',
          stableIdentity,
          deviceName
        });
        if (connectOptions.refreshAfterConnect ?? true) {
          await refreshBusinessDataSafely(getPostConnectRefreshOptions());
        } else {
          schedulePostConnectDeviceInfoRefresh('connect-same-device-ready-background', {
            stableIdentity,
            deviceName
          });
        }
        scheduleRwMaintainRefresh();
        return metrics.value;
      }
    }

    if (!platformDeviceId) {
      throw new Error('\u7f3a\u5c11\u8bbe\u5907\u8fde\u63a5 ID\uff0c\u8bf7\u91cd\u65b0\u641c\u7d22');
    }

    refreshScanFreshness();
    if (!isFreshBusinessDevice(device, ble.deviceInfo.value, scanFreshnessNow.value, scanDeviceStaleMs)) {
      throw new Error('\u8bbe\u5907\u4fe1\u53f7\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u641c\u7d22');
    }

    cancelBusinessRequests();
    isAutoRefreshPaused = false;
    appendRingDiagnosticLog('RW FLOW', 'connect-start', {
      deviceId: platformDeviceId,
      stableIdentity,
      deviceName,
      protocol,
      timeoutMs: connectTimeoutMs,
      forceProtocol: connectOptions.forceProtocol,
      refreshAfterConnect: connectOptions.refreshAfterConnect,
      replaceBinding: connectOptions.replaceBinding === true,
      target: summarizeBusinessRingDeviceIdentity(device),
      current: summarizeBusinessRingDeviceIdentity(ble.deviceInfo.value)
    });
    lastRefreshResult.value = null;
    lastHistoryResult.value = null;
    ble.clearData();
    await ble.stopScan();

    const connectResult = await withTimeout(
      ble.connectDevice({
        deviceId: platformDeviceId,
        deviceName,
        uniMacId: device.mac || device.advertis?.macInfo || device.uniMacId || stableIdentity,
        fromScan: true,
        bindAfterConnected: true,
        replaceBinding: connectOptions.replaceBinding === true,
        protocol,
        sourceDevice: device
      }).then(() => ({ success: true })),
      connectTimeoutMs,
      () => ({ success: false })
    );

    if (!connectResult.success) {
      await ble.cancelPendingConnection(platformDeviceId);
      appendRingDiagnosticLog('RW FLOW', 'connect-timeout', {
        deviceId: platformDeviceId,
        protocol,
        timeoutMs: connectTimeoutMs
      });
      throw new Error('\u8fde\u63a5\u8d85\u65f6\uff0c\u8bf7\u91cd\u65b0\u8fde\u63a5');
    }

    if (!isReady.value) {
      await ble.cancelPendingConnection(platformDeviceId);
      appendRingDiagnosticLog('RW FLOW', 'connect-not-ready', {
        deviceInfo: ble.deviceInfo.value
      });
      throw new Error('\u8bbe\u5907\u901a\u4fe1\u672a\u5c31\u7eea\uff0c\u8bf7\u91cd\u65b0\u8fde\u63a5');
    }

    const readyMatchesTarget = await ensureReadyDeviceMatchesBusinessIdentity('connect-ready', device);
    if (!readyMatchesTarget) {
      appendRingDiagnosticLog('RW FLOW', 'connect-ready-identity-mismatch', {
        target: summarizeBusinessRingDeviceIdentity(device),
        current: summarizeBusinessRingDeviceIdentity(ble.deviceInfo.value)
      });
      throw new Error('\u8fde\u63a5\u5230\u975e\u7ed1\u5b9a\u8bbe\u5907\uff0c\u8bf7\u91cd\u65b0\u641c\u7d22');
    }

    appendRingDiagnosticLog('RW FLOW', 'connect-ready', {
      deviceId: ble.deviceInfo.value.deviceId,
      stableIdentity: getRingDeviceStableIdentity(ble.deviceInfo.value),
      targetStableIdentity: stableIdentity,
      replaceBinding: connectOptions.replaceBinding === true,
      serviceId: ble.deviceInfo.value.serviceId,
      cmdCharId: ble.deviceInfo.value.cmdCharId,
      dataServiceId: ble.deviceInfo.value.dataServiceId,
      dataCharId: ble.deviceInfo.value.dataCharId,
      notifyEnabled: ble.deviceInfo.value.notifyEnabled,
      notifyError: ble.deviceInfo.value.notifyError
    });
    await syncRwDeviceTimeAfterReady('ready', {
      reason: 'connect-ready',
      stableIdentity,
      deviceName
    });
    if (connectOptions.refreshAfterConnect ?? true) {
      await refreshBusinessDataSafely(getPostConnectRefreshOptions());
    } else {
      schedulePostConnectDeviceInfoRefresh('connect-ready-background', {
        stableIdentity,
        deviceName
      });
    }
    scheduleRwMaintainRefresh();

    return metrics.value;
  };

  const isCurrentBusinessDevice = (device: RingDeviceInfo) => {
    return isSameBusinessRingDevice(ble.deviceInfo.value, device);
  };

  const enableHealthMonitoring = async (seconds = 1800) => {
    const requestId = (refreshRequestId += 1);
    refreshPromise = null;
    isRefreshingBusinessData.value = true;
    const baseTimeoutMs = getRefreshTimeoutMs();
    const timeoutMs =
      getResolvedCurrentProtocol() === 'rw'
        ? Math.max(baseTimeoutMs, Math.min(35000, Math.max(1000, seconds * 1000) + 5000))
        : baseTimeoutMs;
    const monitoringTask = (async () => {
      if (!isReady.value) {
        const restored = await restoreLastBusinessDevice({ refreshAfterRestore: false });
        if (!restored) {
          throw new Error('\u8bbe\u5907\u901a\u4fe1\u672a\u5c31\u7eea\uff0c\u8bf7\u91cd\u65b0\u8fde\u63a5\u540e\u518d\u914d\u7f6e\u5065\u5eb7\u76d1\u542c');
        }
      }

      await ble.sendCollectPeriodSettingCommand(seconds);
      return ble.refreshBusinessMetrics({
        timeoutMs,
        includeCollectPeriod: true,
        includeDeviceTime: false,
        includeRealtimeMetrics: false,
        includeHistorySnapshot: false
      });
    })();

    clearRefreshStateTimer();
    refreshStateTimer = setTimeout(() => {
      if (requestId !== refreshRequestId || !isRefreshingBusinessData.value) return;
      lastRefreshResult.value = lastRefreshResult.value || createRefreshTimeoutResult();
      lastRefreshAt = Date.now();
      isRefreshingBusinessData.value = false;
    }, timeoutMs + 1000);

    try {
      const result = await withTimeout(
        monitoringTask,
        timeoutMs,
        createRefreshTimeoutResult
      );
      if (requestId === refreshRequestId) {
        lastRefreshResult.value = result;
        lastRefreshAt = Date.now();
        scheduleRwMaintainRefresh();
      }
      return metrics.value;
    } catch (error) {
      if (requestId !== refreshRequestId) {
        return metrics.value;
      }
      throw error;
    } finally {
      if (requestId === refreshRequestId) {
        clearRefreshStateTimer();
        isRefreshingBusinessData.value = false;
        scheduleRwMaintainRefresh();
      }
    }
  };

  const clearBusinessData = () => {
    isAutoRefreshPaused = true;
    cancelBusinessRequests();
    lastRefreshResult.value = null;
    lastHistoryResult.value = null;
    ble.clearData();
  };

  const disconnectBusinessDevice = async () => {
    isAutoRefreshPaused = true;
    cancelBusinessRequests();
    lastRefreshResult.value = null;
    lastHistoryResult.value = null;
    return ble.disconnect();
  };

  const pauseBusinessAutoRefresh = () => {
    isAutoRefreshPaused = true;
    clearRwPendingRetryTimer();
    clearRwMaintainRefreshTimer();
    clearRwEmptyRefreshRetryTimer();
  };

  const resumeBusinessAutoRefresh = () => {
    isAutoRefreshPaused = false;
    if (isCurrentOrBoundRw() && !rwBackgroundRefreshEnabled) {
      clearRwPendingRetryTimer();
      clearRwMaintainRefreshTimer();
      clearRwEmptyRefreshRetryTimer();
      return;
    }
    const shouldRecoverRwRefresh = isRwBusinessReady() && hasRwRefreshRecoverySignal();
    if (shouldRecoverRwRefresh) {
      refreshRequestId += 1;
      refreshPromise = null;
      clearRefreshStateTimer();
      clearRwPendingRetryTimer();
      clearRwMaintainRefreshTimer();
      clearRwEmptyRefreshRetryTimer();
      isRefreshingBusinessData.value = false;
    }
    if (shouldRecoverRwRefresh && isRwBusinessReady()) {
      void refreshBusinessDataSafely({
        silent: true,
        forceDeviceInfo: true,
        includeRealtimeMetrics: false,
        includeHistorySnapshot: false
      });
      return;
    }
    if (isReady.value && shouldAutoRefresh()) {
      void refreshBusinessDataSafely({ silent: true });
      return;
    }
    scheduleRwMaintainRefresh();
  };

  watch(
    isReady,
    (ready) => {
      if (!ready) {
        cancelBusinessRequests();
      }
    },
    { immediate: true }
  );

  watch(
    currentBusinessDeviceKey,
    (deviceKey, previousDeviceKey) => {
      if (!previousDeviceKey || deviceKey === previousDeviceKey) return;
      cancelBusinessRequests();
      lastRefreshResult.value = null;
      lastHistoryResult.value = null;
      lastRefreshAt = 0;
    }
  );

  return {
    ...ble,
    metrics,
    businessDevices,
    lastRefreshResult,
    lastHistoryResult,
    isRefreshingBusinessData,
    isBusinessRequestInFlight,
    isSyncingHistory,
    isRestoringDevice,
    refreshFailedText,
    historyResultText,
    isHistoryPending,
    isReady,
    businessDataAgeMs,
    isBusinessDataStale,
    businessDataFreshnessText,
    disconnect: disconnectBusinessDevice,
    restoreLastBusinessDevice,
    scanForBusinessDevices,
    connectBusinessDevice,
    isCurrentBusinessDevice,
    refreshBusinessData,
    refreshDeviceInfoData,
    syncBusinessHistory,
    clearBusinessData,
    enableHealthMonitoring,
    pauseBusinessAutoRefresh,
    resumeBusinessAutoRefresh
  };
};

export function getRingBusinessDeviceName(device: RingDeviceInfo | Record<string, any>) {
  const name = `${device.displayName || device.deviceName || device.name || device.localName || device.bleName || ''}`.trim();
  if (name) return name;
  return getRingDeviceStableIdentity(device as RingDeviceInfo) || '新设备';
}

export function getRingBusinessDeviceTail(device: RingDeviceInfo | Record<string, any>) {
  const identity = getRingDeviceStableIdentity(device as RingDeviceInfo) || getRingBusinessFallbackIdentity(device);
  if (!identity) return '-';
  return identity.length <= 8 ? identity : identity.slice(-8);
}

export function getRingBusinessDeviceKey(device: RingDeviceInfo | Record<string, any>) {
  return (
    getRingDeviceStableIdentity(device as RingDeviceInfo) ||
    getRingBusinessFallbackIdentity(device) ||
    `${getRingBusinessDeviceName(device)}-${device.RSSI ?? device.rssi ?? ''}`
  );
}

export function getRingBusinessPlatformDeviceId(device: RingDeviceInfo | Record<string, any>) {
  const explicitPlatformDeviceId = `${device.platformDeviceId || device.wxDeviceId || device.bleDeviceId || device.bluetoothDeviceId || ''}`.trim();
  if (explicitPlatformDeviceId) return explicitPlatformDeviceId;

  const rawDeviceId = `${device.deviceId || ''}`.trim();
  const protocol = resolveRingProtocol(device as RingDeviceInfo);
  if (protocol === 'rw' && isColonSeparatedBleMac(rawDeviceId) && typeof device.lastSeenAt !== 'number' && !device.fromScan) {
    return '';
  }

  return rawDeviceId;
}

function isBusinessRingDevice(device: RingDeviceInfo) {
  const name = getRingBusinessDeviceName(device).toUpperCase();

  const protocol = device.protocol;
  if (protocol === 'rw' || protocol === 'qkeer-v2') return true;

  const legacyPrefixes = ['HR', 'IF', 'QK', 'QKEERING', 'PPLUS', 'MUSLEEP_RING', 'QKV2'];
  return legacyPrefixes.some((prefix) => name.startsWith(prefix));
}

function getRingBusinessFallbackIdentity(device: RingDeviceInfo | Record<string, any>) {
  const protocol = resolveRingProtocol(device as RingDeviceInfo);
  if (protocol === 'rw') {
    return getExplicitStableBusinessRingIdentityIds(device)[0] || '';
  }
  return `${device.deviceId || device.uniMacId || device.mac || device.advertis?.macInfo || ''}`.trim();
}

function isFreshBusinessDevice(device: RingDeviceInfo, currentDevice: RingDeviceInfo, now = Date.now(), staleMs = SCAN_DEVICE_STALE_MS) {
  const expectedMacKey = normalizeBusinessFullBleMacKey(getExplicitBusinessMac(device));
  if (isSameBusinessRingDevice(device, currentDevice)) {
    return expectedMacKey ? isReadyBusinessDeviceMatchedBoundMac(currentDevice, device) : true;
  }
  if (typeof device.lastSeenAt !== 'number') return true;
  return now - device.lastSeenAt <= staleMs;
}

function isSameBusinessRingDevice(left: RingDeviceInfo, right: RingDeviceInfo) {
  if (left.protocol && right.protocol && left.protocol !== right.protocol) return false;

  const isRwScope = resolveRingProtocol(left) === 'rw' || resolveRingProtocol(right) === 'rw';
  if (!isRwScope) return isSameRingDevice(left, right);

  const leftStableIds = getStableBusinessRingIdentityIds(left);
  const rightStableIds = getStableBusinessRingIdentityIds(right);
  if (leftStableIds.length > 0 && rightStableIds.length > 0) {
    return hasMatchingBusinessRingIdentity(leftStableIds, rightStableIds);
  }
  if (leftStableIds.length > 0 || rightStableIds.length > 0) return false;

  if (hasSameBusinessPlatformDeviceId(left, right)) return true;

  return false;
}

function hasSameBusinessPlatformDeviceId(left: RingDeviceInfo, right: RingDeviceInfo) {
  const leftDeviceId = getRingBusinessPlatformDeviceId(left);
  const rightDeviceId = getRingBusinessPlatformDeviceId(right);
  return Boolean(leftDeviceId && rightDeviceId && leftDeviceId === rightDeviceId);
}

function getStableBusinessRingIdentityIds(device: RingDeviceInfo | Record<string, any>) {
  const protocol = resolveRingProtocol(device as RingDeviceInfo);
  if (protocol === 'rw') {
    return getExplicitStableBusinessRingIdentityIds(device);
  }

  return [device.deviceId, device.uniMacId, device.mac, device.advertis?.macInfo].filter(Boolean);
}

function getExplicitStableBusinessRingIdentityIds(device: RingDeviceInfo | Record<string, any>) {
  return [device.mac, device.advertis?.macInfo, isColonSeparatedBleMac(device.uniMacId) ? device.uniMacId : ''].filter(Boolean);
}

function summarizeBusinessRingDeviceIdentity(device?: RingDeviceInfo | Record<string, any> | null) {
  if (!device) return null;
  return {
    deviceId: device.deviceId,
    platformDeviceId: device.platformDeviceId,
    uniMacId: device.uniMacId,
    mac: device.mac,
    advertisMac: device.advertis?.macInfo,
    protocol: device.protocol,
    scanMac: getScannedBusinessMac(device),
    explicitMac: getExplicitBusinessMac(device),
    stableIds: getStableBusinessRingIdentityIds(device)
  };
}

function hasMatchingBusinessRingIdentity(leftIds: unknown[], rightIds: unknown[]) {
  const leftRaw = leftIds.map((value) => String(value || '').trim()).filter(Boolean);
  const rightRaw = rightIds.map((value) => String(value || '').trim()).filter(Boolean);
  if (leftRaw.some((left) => rightRaw.includes(left))) return true;

  const leftNormalized = leftRaw.map(normalizeBusinessRingIdentity).filter((value) => value.length >= 6);
  const rightNormalized = rightRaw.map(normalizeBusinessRingIdentity).filter((value) => value.length >= 6);
  return leftNormalized.some((left) =>
    rightNormalized.some((right) => left.endsWith(right.slice(-6)) || right.endsWith(left.slice(-6)))
  );
}

function normalizeBusinessRingIdentity(value: unknown) {
  return String(value || '')
    .replace(/[^a-fA-F0-9]/g, '')
    .toUpperCase();
}

function normalizeBusinessFullBleMacKey(value?: unknown) {
  const normalized = normalizeBusinessRingIdentity(value);
  return normalized.length === 12 ? normalized : '';
}

function isColonSeparatedBleMac(value?: unknown) {
  return /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());
}

function isFullColonSeparatedBleMac(value?: unknown) {
  return /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/.test(String(value || '').trim());
}

function getExplicitBusinessMac(device?: RingDeviceInfo | Record<string, any> | null) {
  if (!device) return '';
  const candidates = [
    device.advertis?.macInfo,
    device.advertis?.mac,
    device.advertis?.macAddress,
    device.advertis?.deviceMac,
    device.mac,
    device.macAddress,
    device.deviceMac,
    device.device_mac,
    isFullColonSeparatedBleMac(device.uniMacId) ? device.uniMacId : ''
  ];
  for (const candidate of candidates) {
    const mac = normalizeBusinessFullBleMacKey(candidate);
    if (mac) return mac;
  }
  return '';
}

function hasBusinessRawScanAdvertisEvidence(device?: RingDeviceInfo | Record<string, any> | null) {
  return Boolean(
    device?.advertisData ||
      device?.advertisHex ||
      device?.advertisServiceUUIDs ||
      device?.advertisServiceUUIDsList ||
      device?.serviceData
  );
}

function hasBusinessScanEvidence(device?: RingDeviceInfo | Record<string, any> | null) {
  return Boolean(hasBusinessRawScanAdvertisEvidence(device));
}

function getScannedBusinessMac(device?: RingDeviceInfo | Record<string, any> | null) {
  if (!hasBusinessScanEvidence(device)) return '';
  return getExplicitBusinessMac(device);
}

function isReadyBusinessDeviceMatchedBoundMac(
  currentDevice: RingDeviceInfo,
  expectedDevice?: RingDeviceInfo | Record<string, any> | null
) {
  const expectedMacKey = normalizeBusinessFullBleMacKey(getExplicitBusinessMac(expectedDevice));
  if (!expectedMacKey) return true;
  const currentMacKey = normalizeBusinessFullBleMacKey(getExplicitBusinessMac(currentDevice));
  if (!currentMacKey || currentMacKey !== expectedMacKey) return false;

  if (hasBusinessScanEvidence(expectedDevice)) {
    const expectedCommunicationId = getBusinessCommunicationDeviceId(expectedDevice);
    const currentCommunicationId = getBusinessCommunicationDeviceId(currentDevice);
    if (expectedCommunicationId && currentCommunicationId && expectedCommunicationId !== currentCommunicationId) {
      return false;
    }
  }

  return true;
}

function hasBusinessCommunicationFields(device: RingDeviceInfo) {
  return Boolean(device.deviceId && device.serviceId && device.cmdCharId && device.dataCharId);
}

function getBusinessCommunicationDeviceId(device?: RingDeviceInfo | Record<string, any> | null) {
  return String(device?.deviceId || device?.platformDeviceId || '').trim();
}

function getCurrentBusinessDeviceKey(device: RingDeviceInfo) {
  if (!hasBusinessCommunicationFields(device)) return '';
  const protocol = device.protocol || '';
  const stableIdentity = getRingDeviceStableIdentity(device);
  if (resolveRingProtocol(device) === 'rw' && !stableIdentity) return '';
  return `${protocol}:${stableIdentity || device.deviceId || ''}`;
}

function getBusinessFailureText(step: string, message: string) {
  if (step === 'rw_empty_refresh') return 'RW\u8bbe\u5907\u591a\u6b21\u672a\u8fd4\u56de\u6570\u636e\uff0c\u8bf7\u91cd\u65b0\u8fde\u63a5';

  const stepText: Record<string, string> = {
    heart_rate: '\u5fc3\u7387\u672a\u8fd4\u56de\u5b9e\u65f6\u503c',
    blood_oxygen: '\u8840\u6c27\u672a\u8fd4\u56de\u5b9e\u65f6\u503c',
    temperature: '\u4f53\u6e29\u672a\u8fd4\u56de\u5b9e\u65f6\u503c',
    hrv: 'HRV\u672a\u8fd4\u56de\u5b9e\u65f6\u503c',
    stress: '\u538b\u529b\u672a\u8fd4\u56de\u5b9e\u65f6\u503c',
    blood_sugar: '\u8840\u7cd6\u672a\u8fd4\u56de\u5b9e\u65f6\u503c',
    blood_pressure: '\u8840\u538b\u672a\u8fd4\u56de\u5b9e\u65f6\u503c',
    device_time: '\u8bbe\u5907\u65f6\u95f4\u6682\u672a\u8fd4\u56de',
    collect_period: '\u76d1\u542c\u72b6\u6001\u6682\u672a\u8fd4\u56de',
    history: '\u5386\u53f2\u6570\u636e\u6682\u672a\u8fd4\u56de'
  };

  if (stepText[step]) return stepText[step];
  if (/timeout/i.test(message)) return '\u8bbe\u5907\u54cd\u5e94\u8d85\u65f6';
  return message || '\u8bbe\u5907\u6682\u672a\u8fd4\u56de';
}

function hasCurrentMetricValue(step: string, metrics: Record<string, any>) {
  if (RW_REALTIME_METRIC_STEPS.includes(step as RwRealtimeMetricStep)) {
    return getRwRealtimeMetricValue(metrics, step as RwRealtimeMetricStep) != null;
  }
  return false;
}

function getRwRealtimeMetricValue(metrics: Record<string, any>, step: RwRealtimeMetricStep) {
  if (step === 'heart_rate') return metrics.heartRate;
  if (step === 'blood_oxygen') return metrics.bloodOxygen;
  if (step === 'temperature') return metrics.temperature;
  if (step === 'hrv') return metrics.hrv;
  if (step === 'stress') return metrics.stress;
  if (step === 'blood_sugar') return metrics.bloodSugar;
  if (step === 'blood_pressure') return metrics.bloodPressure;
  return null;
}

function getRwRealtimeMetricStatus(metrics: Record<string, any>, step: RwRealtimeMetricStep) {
  if (step === 'heart_rate') return metrics.heartRateStatus;
  if (step === 'blood_oxygen') return metrics.bloodOxygenStatus;
  if (step === 'temperature') return metrics.temperatureStatus;
  if (step === 'hrv') return metrics.hrvStatus;
  if (step === 'stress') return metrics.stressStatus;
  if (step === 'blood_sugar') return metrics.bloodSugarStatus;
  if (step === 'blood_pressure') return metrics.bloodPressureStatus;
  return '';
}

function isPendingMetricStatus(status: unknown) {
  if (typeof status !== 'string') return false;
  return /pending|requested|\u672a\u8fd4\u56de|\u7b49\u5f85|\u5df2\u8bf7\u6c42/.test(status);
}

function isResolvedDeviceInfoMetricValue(value: unknown) {
  if (value == null || value === '') return false;
  const text = String(value).trim();
  if (!text) return false;
  return !/pending|requested|timeout|command|\u672a\u8fd4\u56de|\u6682\u672a|\u7b49\u5f85|\u5df2\u8bf7\u6c42|\u8d85\u65f6/i.test(text);
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, createTimeoutValue: () => T) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  task.catch(() => undefined);

  return Promise.race([
    task,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(createTimeoutValue()), timeoutMs);
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function createRefreshTimeoutResult(): RefreshLegacyBusinessMetricsResult {
  return {
    status: 'partial',
    ok: [],
    failed: [{ step: 'refresh', message: 'business refresh timeout' }]
  };
}

function createSilentVisibleRefreshResult(
  result: RefreshLegacyBusinessMetricsResult,
  previous: RefreshLegacyBusinessMetricsResult | null
): RefreshLegacyBusinessMetricsResult {
  if (result.failed.length === 0) return result;

  const ok = Array.from(new Set([...(previous?.ok || []), ...result.ok]));
  return {
    status: ok.length > 0 ? 'partial' : previous?.status === 'success' ? 'partial' : previous?.status || 'partial',
    ok,
    failed: []
  };
}

function createDeviceInfoVisibleRefreshResult(
  result: RefreshLegacyBusinessMetricsResult,
  previous: RefreshLegacyBusinessMetricsResult | null
): RefreshLegacyBusinessMetricsResult {
  const deviceInfoSteps = new Set([
    'battery',
    'battery_pending',
    'battery_cached',
    'battery_command',
    'battery_command_pending',
    'firmware',
    'firmware_pending',
    'firmware_cached',
    'firmware_command',
    'firmware_command_pending',
    'software',
    'software_pending',
    'software_cached',
    'software_command',
    'software_command_pending'
  ]);
  const ok = Array.from(new Set([...(previous?.ok || []), ...result.ok.filter((step) => deviceInfoSteps.has(step))]));
  const failed = result.failed.filter((item) => item.step === 'battery' || item.step === 'firmware' || item.step === 'software');

  return {
    status: failed.length === 0 ? (ok.length > 0 ? 'success' : previous?.status || 'partial') : ok.length > 0 ? 'partial' : 'failed',
    ok,
    failed
  };
}

function createRestoreTimeoutResult(): RefreshLegacyBusinessMetricsResult {
  return {
    status: 'failed',
    ok: [],
    failed: [{ step: 'restore', message: 'business restore timeout' }]
  };
}

function createHistoryTimeoutResult(): SyncLegacyHistoryResult {
  return {
    status: 'history_timeout',
    records: [],
    parsed: {
      type: 'local_data',
      status: 'timeout',
      message: 'business history timeout'
    },
    uploaded: false,
    deleted: false
  };
}

function createHistorySkippedResult(lock: RwDiagnosticCommandLock): SyncLegacyHistoryResult {
  return {
    status: 'skipped',
    records: [],
    parsed: {
      type: 'rw_history_pending',
      status: 'skipped',
      message: 'RW diagnostic command lock is active.',
      lock
    },
    uploaded: false,
    deleted: false
  };
}

function createHistoryFailureResult(error: unknown): SyncLegacyHistoryResult {
  const message = formatBleErrorMessage(error, '\u5386\u53f2\u540c\u6b65\u5931\u8d25');
  return {
    status: 'failed',
    records: [],
    parsed: {
      type: 'local_data',
      status: 'failed',
      message
    },
    uploaded: false,
    deleted: false
  };
}

function summarizeHistorySyncResult(result: SyncLegacyHistoryResult) {
  const records = Array.isArray(result.records) ? result.records : [];
  const parsed = (result.parsed || {}) as Record<string, any>;
  const dataTypes = [
    ...new Set(
      records
        .map((record) => record.dataType || record.rawDataType || record.fileType || record.sourceType)
        .filter(Boolean)
        .map(String)
    )
  ].slice(0, 12);

  return {
    status: result.status,
    uploaded: result.uploaded,
    deleted: result.deleted,
    recordCount: records.length,
    dataTypes,
    parsed: {
      type: parsed.type,
      status: parsed.status,
      totalFileCount: parsed.totalFileCount,
      selectedFileCount: parsed.selectedFileCount,
      filteredFileCount: parsed.filteredFileCount,
      totalNum: parsed.totalNum,
      message: parsed.message
    }
  };
}

function formatHistoryResultText(result: SyncLegacyHistoryResult | null) {
  if (!result) return '-';

  if (result.status === 'rw_history_pending') return '\u5386\u53f2\u6570\u636e\u5f85\u540c\u6b65';
  if (result.status === 'file_list') {
    const fileCount = Number(result.parsed?.selectedFileCount ?? result.parsed?.totalFileCount ?? result.records.length);
    return fileCount > 0 ? `\u53d1\u73b0 ${fileCount} \u4e2a\u5386\u53f2\u6587\u4ef6` : '\u6682\u65e0\u5386\u53f2\u6587\u4ef6';
  }
  if (result.status === 'filtered') return '\u5386\u53f2\u6587\u4ef6\u4e0d\u5728\u5f53\u524d\u8bfb\u53d6\u6761\u4ef6\u5185';
  if (result.status === 'history_timeout' || result.status === 'timeout') return '\u5386\u53f2\u540c\u6b65\u8d85\u65f6';
  if (result.status === 'failed') return '\u5386\u53f2\u540c\u6b65\u5931\u8d25';
  if (result.records.length > 0) return `\u5df2\u540c\u6b65 ${result.records.length} \u6761\u5386\u53f2`;
  if (['success', 'completed', 'uploaded'].includes(result.status)) return '\u5386\u53f2\u540c\u6b65\u5b8c\u6210';
  return '\u6682\u65e0\u5386\u53f2\u6570\u636e';
}
