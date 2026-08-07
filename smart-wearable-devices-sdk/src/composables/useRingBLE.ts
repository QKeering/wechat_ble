import { computed } from 'vue';
import { useRingBleStoreSdk } from './useRingBleStoreSdk';
import type { UseRingBleSdkOptions } from './useRingBleSdk';
import { resolveRingProtocol, type RefreshLegacyBusinessMetricsResult, type RingDeviceInfo, type RwHealthDataName, type RwHistoryDataName } from '@/sdk/ring-ble';
import type { RwHealthMonitoringConfig, RwUserProfile } from '@/sdk/ring-ble/rw/protocol';
import { getRwDiagnosticCommandLock } from '@/utils/rwDiagnosticCommandLock';

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
const DEFAULT_COMPAT_REFRESH_OPTIONS: CompatRefreshOptions = {
  includeDeviceTime: false,
  includeCollectPeriod: false
};
const DEFAULT_COMPAT_REFRESH_TIMEOUT_MS = 3500;
const RW_COMPAT_REFRESH_TIMEOUT_MS = 35000;
const RW_COMPAT_SCAN_TIMEOUT_MS = 12000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const RING_DIAGNOSTIC_LOG_STORAGE_KEY = 'qkeer:ring-diagnostic-logs';
const RING_DIAGNOSTIC_LOG_MAX_COUNT = 500;

let rwCompatHistoryQueue: Promise<unknown> = Promise.resolve();
let rwCompatHistoryQueueDepth = 0;

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

const formatCompatHistoryQueueError = (error: unknown) =>
  error instanceof Error ? error.message : `${(error as any)?.errMsg || error}`;

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

const runRwCompatHistoryExclusive = async <T>(
  task: () => Promise<T>,
  details: Record<string, unknown>
) => {
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

  rwCompatHistoryQueue = queuedTask.catch(() => undefined).finally(() => {
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
  const connectedDeviceId = computed(() => sdk.deviceInfo.value.deviceId || '');
  const healthData = computed(() => sdk.ringStore.healthData);
  const latestMetrics = computed(() => sdk.ringStore.latestMetrics);
  const getCurrentRwStableMac = () => {
    const currentDevice = sdk.deviceInfo.value;
    const currentStableMac = currentDevice.mac || currentDevice.advertis?.macInfo || '';
    return (
      currentStableMac ||
      (isColonSeparatedBleMac(currentDevice.uniMacId) ? currentDevice.uniMacId : '')
    );
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

  const normalizeScanInput = (input?: CompatScanInput) => {
    if (!input) return undefined;
    if (typeof input === 'string') return [input];
    if (Array.isArray(input)) return input;
    return input;
  };

  const runWithReady = async <T>(task: () => Promise<T>) => {
    const ready = await sdk.ensureCommunicationReady();
    if (!ready) {
      throw new Error('Ring BLE communication is not ready.');
    }
    return task();
  };

  const readLocalData = (
    readAll = false,
    time: CompatHistoryTimeInput = '',
    dataType?: CompatRwHistoryDataInput,
    readOptions: CompatReadLocalDataOptions = {}
  ) => {
    const sinceTimestamp = readAll ? undefined : parseCompatHistorySinceTimestamp(time);
    const normalizedDataTypes = Array.isArray(dataType)
      ? Array.from(new Set(dataType.map((item) => normalizeCompatRwHistoryDataName(item)).filter(Boolean)))
      : undefined;
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
    const deviceName =
      sourceDevice?.displayName ||
      sourceDevice?.deviceName ||
      sourceDevice?.name ||
      sourceDevice?.localName ||
      sdk.deviceInfo.value.name ||
      mac;
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

  const refreshHealthData = (params?: CompatRefreshOptions) =>
    runWithReady(async () => {
      try {
        return await sdk.refreshBusinessMetrics(getCompatRefreshOptions(params));
      } catch (error) {
        return createCompatRefreshFailure(error);
      }
    });
  const syncHistoricalData = readLocalData;
  const syncAllHealthData = () => runWithReady(() => sdk.syncAllHealthData());
  const syncHealthDataByType = (name?: CompatRwHistoryDataName) =>
    runWithReady(() => sdk.syncHealthDataByType(name ? normalizeCompatRwHistoryDataName(name) : undefined));
  const readRwHealthData = (name: CompatRwHealthDataName) => runWithReady(() => sdk.readRwHealthData(normalizeCompatRwHealthDataName(name)));
  const deleteRwHealthData = (name: CompatRwHealthDataName) => runWithReady(() => sdk.deleteRwHealthData(normalizeCompatRwHealthDataName(name)));
  const controlRwHealthData = (name: CompatRwHealthDataName, enabled = true) =>
    runWithReady(() => sdk.controlRwHealthData(normalizeCompatRwHealthDataName(name), enabled));
  const readRwMonitoringConfig = (name: Parameters<typeof sdk.readRwMonitoringConfig>[0]) =>
    runWithReady(() => sdk.readRwMonitoringConfig(name));
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
  const controlHealthDataJL = (name: CompatRwHealthDataName, enabled = true) =>
    runWithReady(() => sdk.controlHealthDataJL(normalizeCompatRwHealthDataName(name), enabled));
  const readBattery = () => runWithReady(() => sdk.sendBatteryCommand());
  const readFirmwareVersion = () => runWithReady(() => sdk.sendFirmwareVersion());
  const readSoftwareVersion = () => runWithReady(() => sdk.sendSoftwareVersion());
  const readHeartRate = () => runWithReady(() => sdk.sendActiveMeasureCommand());
  const readBloodOxygen = () => runWithReady(() => sdk.sendOxyGenCommand());
  const readBodyTemperature = () => runWithReady(() => sdk.sendBodyTemperatureCommand());
  const readDeviceTime = () => runWithReady(() => sdk.readDeviceTime());
  const updateDeviceTime = (...args: Parameters<typeof sdk.updateDeviceTime>) => runWithReady(() => sdk.updateDeviceTime(...args));
  const sendDeleteAllLocalDataCommand = () => runWithReady(() => sdk.sendDeleteAllLocalDataCommand());
  const sendResetCommand = () => runWithReady(() => sdk.sendResetCommand());
  const sendFactoryResetWithTimeCommand = () => runWithReady(() => sdk.sendFactoryResetWithTimeCommand());
  const sendCollectPeriodSettingCommand = (...args: Parameters<typeof sdk.sendCollectPeriodSettingCommand>) =>
    runWithReady(() => sdk.sendCollectPeriodSettingCommand(...args));
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
    return (
      device.mac ||
      device.advertis?.macInfo ||
      (isColonSeparatedBleMac(device.uniMacId) ? device.uniMacId : '') ||
      (isMacLikeCompatIdentity(fallback) ? fallback : '')
    );
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
    return stableIds.some(
      (item) =>
        item === normalizedValue ||
        (allowTail && (item.endsWith(normalizedValue.slice(-6)) || normalizedValue.endsWith(item.slice(-6))))
    );
  };

  const findScannedDevice = (deviceId: string, uniMacId = '') => {
    const sourceDevice = sdk.devices.value.find((device) => {
      const protocol = resolveRingProtocol(device);
      if (protocol === 'rw') {
        const stableTarget = [uniMacId, deviceId].find((item) => isMacLikeCompatIdentity(item)) || '';
        if (stableTarget) return matchesScannedStableIdentity(device, stableTarget, false);
        return Boolean(deviceId && device.deviceId === deviceId);
      }
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

    const hasStableRwTarget =
      protocolHint === 'rw' && [uniMacId, deviceId].some((item) => isMacLikeCompatIdentity(item));
    if (hasStableRwTarget) return undefined;

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

  const findRwCompatScanCandidate = (deviceId: string, uniMacId = '', deviceName = '') =>
    findCompatScanCandidate(deviceId, uniMacId, deviceName, 'rw');

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
    const preferredName =
      inputDevice?.displayName || inputDevice?.deviceName || inputDevice?.name || inputDevice?.localName || deviceName || requestedId;
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
        (resolveRingProtocol(sourceDevice || inputDevice || ({} as RingDeviceInfo)) === 'rw'
          ? ''
          : sourceDevice?.uniMacId || inputDevice?.uniMacId || preferredLookupId),
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
