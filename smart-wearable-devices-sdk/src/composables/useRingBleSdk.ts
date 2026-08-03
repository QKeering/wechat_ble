import { computed, ref } from 'vue';
import {
  autoReconnectLegacyRing,
  cleanupLegacyRing,
  connectLegacyRing,
  createRingBleAdapterByProtocol,
  createRingBleAdapterByProtocolAsync,
  disconnectLegacyRing,
  ensureLegacyBluetoothReady,
  handleRingParsedData,
  resolveRingProtocol,
  resetRingRuntimeState,
  refreshLegacyBusinessMetrics,
  RW_SERVICE_UUIDS,
  syncLegacyHistory,
  unbindLegacyRing,
  type LegacyRingAdapter,
  type RingBleRuntime,
  type RingDeviceInfo,
  type RingHistoricalRecord,
  type RingParsedData,
  type RingProtocolKind,
  type RingReconnectStatus,
  type RingStoreBridgeTarget,
  type RingUploadingStatus
} from '@/sdk/ring-ble';
import type { RwHealthDataName, RwHistoryDataName, RwMonitoringName } from '@/sdk/ring-ble/legacy/adapter';
import type { RwHealthMonitoringConfig, RwUserProfile } from '@/sdk/ring-ble/rw/protocol';

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

const RW_RECONNECT_SCAN_TIMEOUT_MS = 12000;
const RW_RECONNECT_CANDIDATE_TIMEOUT_MS = 12000;
const RW_RECONNECT_BOUND_CANDIDATE_TIMEOUT_MS = 30000;
const RW_RECONNECT_SCAN_ROUND_GAP_MS = 300;
const RW_DIRECT_RECONNECT_MAX_DEVICE_AGE_MS = 30000;
const RW_UPLOAD_DISCONNECT_RECOVERY_DELAY_MS = 250;
const RW_UPLOAD_SUCCESS_DISCONNECT_GRACE_MS = 5000;

export interface UseRingBleSdkOptions {
  getBoundDevice?: RingBleRuntime['getBoundDevice'];
  bindDevice?: RingBleRuntime['bindDevice'];
  unbindDevice?: RingBleRuntime['unbindDevice'];
  uploadHistoricalRecords?: (records: RingHistoricalRecord[], parsed: RingParsedData) => Promise<unknown>;
  rwReconnectScanTimeoutMs?: number;
  rwReconnectCandidateTimeoutMs?: number;
}

export interface ConnectRingDeviceOptions {
  deviceId: string;
  deviceName: string;
  uniMacId?: string;
  fromScan?: boolean;
  bindAfterConnected?: boolean;
  protocol?: RingProtocolKind;
  sourceDevice?: RingDeviceInfo;
}

type StartScanOptions = Parameters<LegacyRingAdapter['startScan']>[0];

const normalizeRwHealthDataName = (name: CompatRwHealthDataName): RwHealthDataName => {
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

const normalizeRwHistoryDataName = (name: CompatRwHistoryDataName): string => {
  const normalized = `${name}`.trim().replace(/-/g, '_').toLowerCase();
  const compact = normalized.replace(/[_\s]/g, '');
  if (compact === 'sleep' || compact === 'sleepdata' || compact === 'sleepdetail' || compact === 'sleepdetails') return 'sleep';
  if (compact === 'step' || compact === 'steps' || compact === 'stepcount' || compact === 'sport' || compact === 'activity' || compact === 'dailyactivity') {
    return 'step';
  }
  return normalizeRwHealthDataName(name as CompatRwHealthDataName);
};

export const getRingDeviceStableIdentity = (device: RingDeviceInfo) => {
  const stableMac = device.mac || device.advertis?.macInfo;
  if (stableMac) return stableMac;

  if (resolveRingProtocol(device) === 'rw') {
    if (isColonSeparatedBleMac(device.uniMacId)) return device.uniMacId;
    if (isColonSeparatedBleMac(device.deviceId)) return device.deviceId;
    return '';
  }

  return device.uniMacId || device.deviceId || '';
};

export const getRingDeviceMatchIds = (device: RingDeviceInfo) =>
  [device.deviceId, device.uniMacId, device.mac, device.advertis?.macInfo].filter(Boolean);

const normalizeRingIdentity = (value?: unknown) =>
  String(value || '')
    .replace(/[^a-fA-F0-9]/g, '')
    .toUpperCase();

const isColonSeparatedBleMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());

const hasRwNotifyDiscoverySnapshot = (device: RingDeviceInfo) =>
  Array.isArray(device.notifyCandidates) && device.notifyCandidates.length > 0;

const isCommunicationReadyDevice = (device: RingDeviceInfo) =>
  Boolean(device.deviceId && device.serviceId && device.cmdCharId && device.dataCharId);

const getRwStableConnectionIdentity = (device?: RingDeviceInfo | null, fallback?: unknown) => {
  if (device?.mac) return device.mac;
  if (device?.advertis?.macInfo) return device.advertis.macInfo;
  if (isColonSeparatedBleMac(device?.uniMacId)) return device?.uniMacId;
  if (isColonSeparatedBleMac(device?.deviceId)) return device?.deviceId;
  if (isColonSeparatedBleMac(fallback)) return String(fallback || '').trim();
  return '';
};

const getRingDeviceTailMatchIds = (device: RingDeviceInfo) =>
  [
    resolveRingProtocol(device) !== 'rw' || isColonSeparatedBleMac(device.uniMacId) ? device.uniMacId : '',
    device.mac,
    device.advertis?.macInfo,
    isColonSeparatedBleMac(device.deviceId) ? device.deviceId : ''
  ].filter(Boolean);

const normalizeRingName = (device: RingDeviceInfo) =>
  String(device.name || device.deviceName || '')
    .trim()
    .toUpperCase();

const normalizeRingUuid = (value?: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase();

const isRwServiceUuid = (value?: unknown) => {
  const serviceId = normalizeRingUuid(value);
  return Boolean(serviceId && RW_SERVICE_UUIDS.some((candidate) => normalizeRingUuid(candidate) === serviceId));
};

const hasMatchingIdentityTail = (left: RingDeviceInfo, right: RingDeviceInfo) => {
  const leftIds = getRingDeviceTailMatchIds(left)
    .map(normalizeRingIdentity)
    .filter((value) => value.length >= 6);
  const rightIds = getRingDeviceTailMatchIds(right)
    .map(normalizeRingIdentity)
    .filter((value) => value.length >= 6);

  return leftIds.some((leftId) =>
    rightIds.some((rightId) => leftId.endsWith(rightId.slice(-6)) || rightId.endsWith(leftId.slice(-6)))
  );
};

const hasConflictingProtocols = (left: RingDeviceInfo, right: RingDeviceInfo) =>
  Boolean(left.protocol && right.protocol && left.protocol !== right.protocol);

const getStableSwitchingIdentityIds = (device: RingDeviceInfo) => {
  if (resolveRingProtocol(device) === 'rw') {
    return [
      device.mac,
      device.advertis?.macInfo,
      isColonSeparatedBleMac(device.uniMacId) ? device.uniMacId : '',
      isColonSeparatedBleMac(device.deviceId) ? device.deviceId : ''
    ].filter(Boolean);
  }

  return getRingDeviceMatchIds(device);
};

const hasMatchingSwitchingIdentity = (leftIds: unknown[], rightIds: unknown[]) => {
  if (leftIds.some((id) => rightIds.includes(id))) return true;

  const normalizedLeftIds = leftIds.map(normalizeRingIdentity).filter((value) => value.length >= 6);
  const normalizedRightIds = rightIds.map(normalizeRingIdentity).filter((value) => value.length >= 6);
  return normalizedLeftIds.some((leftId) =>
    normalizedRightIds.some((rightId) => leftId.endsWith(rightId.slice(-6)) || rightId.endsWith(leftId.slice(-6)))
  );
};

const isSameSwitchingRingDevice = (left: RingDeviceInfo, right: RingDeviceInfo) => {
  if (hasConflictingProtocols(left, right)) return false;

  const isRwSwitchingScope = resolveRingProtocol(left) === 'rw' || resolveRingProtocol(right) === 'rw';
  if (!isRwSwitchingScope) return isSameRingDevice(left, right);

  if (hasSamePlatformDeviceId(left, right)) return true;

  const leftStableIds = getStableSwitchingIdentityIds(left);
  const rightStableIds = getStableSwitchingIdentityIds(right);
  if (leftStableIds.length > 0 && rightStableIds.length > 0) {
    return hasMatchingSwitchingIdentity(leftStableIds, rightStableIds);
  }
  if (leftStableIds.length > 0 || rightStableIds.length > 0) return false;

  return Boolean(left.deviceId && right.deviceId && left.deviceId === right.deviceId);
};

const hasSamePlatformDeviceId = (left: RingDeviceInfo, right: RingDeviceInfo) =>
  Boolean(left.deviceId && right.deviceId && left.deviceId === right.deviceId);

export const isSameRingDevice = (left: RingDeviceInfo, right: RingDeviceInfo) => {
  if (hasConflictingProtocols(left, right)) return false;

  const leftIds = getRingDeviceMatchIds(left);
  const rightIds = getRingDeviceMatchIds(right);
  return (
    (leftIds.length > 0 && rightIds.length > 0 && leftIds.some((id) => rightIds.includes(id))) ||
    hasMatchingIdentityTail(left, right)
  );
};

export const findReconnectScanCandidate = (target: RingDeviceInfo, scannedDevices: RingDeviceInfo[]) => {
  const protocolCandidates = scannedDevices.filter(
    (device) => !target.protocol || !device.protocol || device.protocol === target.protocol
  );
  const identityMatch = protocolCandidates.find((device) => isSameRingDevice(target, device));
  if (identityMatch) return identityMatch;

  const targetName = normalizeRingName(target);
  if (!targetName) return null;

  const nameMatches = protocolCandidates.filter((device) => normalizeRingName(device) === targetName);
  return nameMatches.length === 1 ? nameMatches[0] : null;
};

export const shouldReconnectByScanningFirst = (target?: RingDeviceInfo | null) => {
  if (!target) return false;
  // The platform deviceId is session-scoped and may change after Bluetooth,
  // permission or app lifecycle changes. Resolve every bound device that has
  // a stable identity from a fresh scan before attempting a connection.
  return Boolean(getRingDeviceStableIdentity(target));
};

const getRwReconnectTargetAgeMs = (target?: RingDeviceInfo | null, now = Date.now()) => {
  if (typeof target?.lastSeenAt !== 'number') return null;
  return now - target.lastSeenAt;
};

const isFreshRwReconnectTarget = (target?: RingDeviceInfo | null, now = Date.now()) => {
  const ageMs = getRwReconnectTargetAgeMs(target, now);
  return ageMs !== null && ageMs >= 0 && ageMs <= RW_DIRECT_RECONNECT_MAX_DEVICE_AGE_MS;
};

export const shouldSkipDirectRwReconnect = (target?: RingDeviceInfo | null) => {
  if (!target || resolveRingProtocol(target) !== 'rw') return false;
  if (target.deviceId && target.serviceId && target.cmdCharId && target.dataCharId) {
    return !isFreshRwReconnectTarget(target);
  }

  const deviceId = String(target.deviceId || '').trim();
  if (!deviceId) return true;

  const normalizedDeviceId = normalizeRingIdentity(deviceId);
  const stableIds = [target.mac, target.advertis?.macInfo, target.uniMacId]
    .map(normalizeRingIdentity)
    .filter(Boolean);
  const looksLikeStableBleMac = /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/.test(deviceId) || normalizedDeviceId.length === 12;

  return stableIds.includes(normalizedDeviceId) || looksLikeStableBleMac;
};

const hasRingReconnectTargetIdentity = (target?: RingDeviceInfo | null) => {
  if (!target) return false;
  if (getRingDeviceStableIdentity(target)) return true;
  return Boolean(
    resolveRingProtocol(target) === 'rw' &&
      target.deviceId &&
      target.serviceId &&
      target.cmdCharId &&
      target.dataCharId
  );
};

const isSameBoundReconnectDevice = (boundDevice: RingDeviceInfo, currentDevice?: RingDeviceInfo | null) => {
  if (!currentDevice?.deviceId) return false;
  const protocol = boundDevice.protocol || resolveRingProtocol(boundDevice);
  return isSameRingDevice({ ...boundDevice, protocol }, currentDevice);
};

const buildReconnectTargetFromBoundDevice = (
  boundDevice: RingDeviceInfo,
  currentDevice?: RingDeviceInfo | null
): RingDeviceInfo => {
  const protocol = boundDevice.protocol || resolveRingProtocol(boundDevice);
  if (!isSameBoundReconnectDevice(boundDevice, currentDevice)) {
    return { ...boundDevice, protocol };
  }

  return {
    ...(currentDevice || {}),
    ...boundDevice,
    deviceId: currentDevice?.deviceId || boundDevice.deviceId,
    mac: boundDevice.mac || currentDevice?.mac,
    uniMacId: boundDevice.uniMacId || currentDevice?.uniMacId,
    name: boundDevice.name || currentDevice?.name,
    deviceName: boundDevice.deviceName || boundDevice.name || currentDevice?.deviceName || currentDevice?.name,
    serviceId: currentDevice?.serviceId || boundDevice.serviceId,
    cmdCharId: currentDevice?.cmdCharId || boundDevice.cmdCharId,
    dataServiceId: currentDevice?.dataServiceId || boundDevice.dataServiceId,
    dataCharId: currentDevice?.dataCharId || boundDevice.dataCharId,
    notifyCandidates: currentDevice?.notifyCandidates || boundDevice.notifyCandidates,
    notifyEnabled: currentDevice?.notifyEnabled ?? boundDevice.notifyEnabled,
    advertis: boundDevice.advertis || currentDevice?.advertis,
    lastSeenAt: currentDevice?.lastSeenAt || boundDevice.lastSeenAt,
    protocol
  };
};

export const isSwitchingRingDevice = (currentDevice: RingDeviceInfo, targetDevice: RingDeviceInfo) => {
  const currentIds = getRingDeviceMatchIds(currentDevice);
  const targetIds = getRingDeviceMatchIds(targetDevice);
  return currentIds.length > 0 && targetIds.length > 0 && !isSameSwitchingRingDevice(currentDevice, targetDevice);
};

export const isExpectedRingDevice = (expected: RingDeviceInfo | null, payload: RingDeviceInfo) => {
  if (!expected) return true;
  const expectedIds = getRingDeviceMatchIds(expected);
  const payloadIds = getRingDeviceMatchIds(payload);
  if (expected.protocol && payload.protocol && expected.protocol !== payload.protocol) return false;
  if (expectedIds.length === 0 || payloadIds.length === 0) return true;
  return isSameRingDevice(expected, payload);
};

const getRawParsedRingIdentityIds = (device: RingDeviceInfo) => getRingDeviceMatchIds(device);

const getStableParsedRingIdentityIds = (device: RingDeviceInfo, protocolHint?: RingProtocolKind) => {
  const protocol = device.protocol || protocolHint;
  if (protocol === 'rw') {
    return [
      device.mac,
      device.advertis?.macInfo,
      isColonSeparatedBleMac(device.uniMacId) ? device.uniMacId : '',
      isColonSeparatedBleMac(device.deviceId) ? device.deviceId : ''
    ].filter(Boolean);
  }
  return getRawParsedRingIdentityIds(device);
};

const getParsedRingIdentityScope = (device: RingDeviceInfo, protocolHint?: RingProtocolKind) => ({
  ids: getStableParsedRingIdentityIds(device, protocolHint),
  hadIdentity: getRawParsedRingIdentityIds(device).length > 0
});

const hasOnlyRawDeviceIdIdentity = (device: RingDeviceInfo) =>
  Boolean(device.deviceId) && !device.uniMacId && !device.mac && !device.advertis?.macInfo;

const hasSameRawDeviceId = (left: RingDeviceInfo, right: RingDeviceInfo) =>
  Boolean(left.deviceId && right.deviceId && left.deviceId === right.deviceId);

const hasMatchingParsedRingIdentity = (leftIds: unknown[], rightIds: unknown[]) => {
  const leftRaw = leftIds.map((value) => String(value || '').trim()).filter(Boolean);
  const rightRaw = rightIds.map((value) => String(value || '').trim()).filter(Boolean);
  if (leftRaw.some((left) => rightRaw.includes(left))) return true;

  const leftNormalized = leftRaw.map(normalizeRingIdentity).filter((value) => value.length >= 6);
  const rightNormalized = rightRaw.map(normalizeRingIdentity).filter((value) => value.length >= 6);
  return leftNormalized.some((left) =>
    rightNormalized.some((right) => left.endsWith(right.slice(-6)) || right.endsWith(left.slice(-6)))
  );
};

export const isParsedDataForCurrentRing = (currentDevice: RingDeviceInfo, parsed: RingParsedData) => {
  if (parsed.protocol && currentDevice.protocol && parsed.protocol !== currentDevice.protocol) return false;

  const parsedIdentity: RingDeviceInfo = {
    deviceId: parsed.deviceId,
    uniMacId: parsed.uniMacId,
    mac: parsed.mac,
    advertis: parsed.advertis,
    protocol: parsed.protocol
  };
  const currentScope = getParsedRingIdentityScope(currentDevice, parsed.protocol);
  const parsedScope = getParsedRingIdentityScope(parsedIdentity, currentDevice.protocol);
  if (!currentScope.hadIdentity) return false;
  if (!parsedScope.hadIdentity) return true;

  const isRwScope = parsed.protocol === 'rw' || currentDevice.protocol === 'rw';
  if (isRwScope) {
    if (parsedScope.ids.length === 0 || currentScope.ids.length === 0) {
      return (
        parsedScope.ids.length === 0 &&
        currentScope.ids.length === 0 &&
        hasSameRawDeviceId(currentDevice, parsedIdentity) &&
        hasOnlyRawDeviceIdIdentity(parsedIdentity)
      );
    }
    return hasMatchingParsedRingIdentity(currentScope.ids, parsedScope.ids);
  }

  return isSameRingDevice(currentDevice, parsedIdentity);
};

export const enrichParsedDataWithCurrentRing = (currentDevice: RingDeviceInfo, parsed: RingParsedData): RingParsedData => ({
  ...parsed,
  protocol: parsed.protocol || currentDevice.protocol,
  deviceId: parsed.deviceId || currentDevice.deviceId,
  uniMacId: parsed.uniMacId || currentDevice.uniMacId,
  mac: parsed.mac || currentDevice.mac || currentDevice.advertis?.macInfo,
  deviceName: parsed.deviceName || currentDevice.deviceName || currentDevice.name,
  advertis: parsed.advertis || currentDevice.advertis
});

const isRuntimeBlePacketFromCurrentRing = (currentDevice: RingDeviceInfo, parsed: RingParsedData) => {
  const currentDeviceId = `${currentDevice.deviceId || ''}`.trim();
  const parsedDeviceId = `${parsed.deviceId || ''}`.trim();
  if (!currentDeviceId || !parsedDeviceId || currentDeviceId !== parsedDeviceId) return false;
  if (parsed.protocol && currentDevice.protocol && parsed.protocol !== currentDevice.protocol) return false;
  if (parsed.protocol !== 'rw' && currentDevice.protocol !== 'rw') return false;

  return Boolean(parsed.serviceId || parsed.characteristicId || parsed.receivedAt || parsed.parsedAt);
};

const summarizeParsedForStoreLog = (parsed: RingParsedData) => ({
  type: parsed.type,
  name: parsed.name,
  value: parsed.value,
  battery: parsed.battery,
  deviceId: parsed.deviceId,
  uniMacId: parsed.uniMacId,
  mac: parsed.mac,
  serviceId: parsed.serviceId,
  characteristicId: parsed.characteristicId
});

const isNodeRuntime = () => Boolean((globalThis as any).process?.versions?.node);

const RING_DIAGNOSTIC_LOG_STORAGE_KEY = 'qkeer:ring-diagnostic-logs';
const RING_DIAGNOSTIC_LOG_MAX_COUNT = 500;
const RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH = 4000;

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

const writeRwStoreLog = (event: string, details: Record<string, any>) => {
  if (isNodeRuntime()) {
    if ((globalThis as any).process?.env?.RING_BLE_STORE_DEBUG === '1') {
      console.info(`[RW STORE] ${event}`, details);
    }
    return;
  }
  console.info(`[RW STORE] ${event}`, details);
  try {
    const raw = uni.getStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY);
    const logs = Array.isArray(raw) ? raw : [];
    logs.push({
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      time: formatDiagnosticTime(),
      source: 'RW STORE',
      event,
      details: normalizeDiagnosticDetails(details)
    });
    uni.setStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY, logs.slice(-RING_DIAGNOSTIC_LOG_MAX_COUNT));
  } catch {
    // Diagnostic logging must not affect BLE data flow.
  }
};

const summarizeRingDeviceForStoreLog = (device?: RingDeviceInfo | null) => ({
  deviceId: device?.deviceId,
  name: device?.name || device?.deviceName || device?.localName || device?.displayName,
  protocol: device?.protocol,
  uniMacId: device?.uniMacId,
  mac: device?.mac || device?.advertis?.macInfo,
  serviceId: device?.serviceId,
  cmdCharId: device?.cmdCharId,
  dataServiceId: device?.dataServiceId,
  dataCharId: device?.dataCharId,
  lastSeenAt: device?.lastSeenAt
});

const summarizeRingDeviceIdentityForStoreLog = (device?: RingDeviceInfo | null) => {
  if (!device) return null;
  return {
    ...summarizeRingDeviceForStoreLog(device),
    nameKey: normalizeRingName(device),
    stableIdentity: getRingDeviceStableIdentity(device),
    stableConnectionIdentity: getRwStableConnectionIdentity(device),
    matchIds: getRingDeviceMatchIds(device),
    tailMatchIds: getRingDeviceTailMatchIds(device)
  };
};

const shouldIgnoreRwReconnectDisconnectNoise = (
  device: RingDeviceInfo,
  expected: RingDeviceInfo | null,
  reconnecting: boolean
) => {
  if (!reconnecting || !expected) return false;
  if (resolveRingProtocol(device) !== 'rw' && resolveRingProtocol(expected) !== 'rw') return false;
  return !isCommunicationReadyDevice(device);
};

export const useRingBleSdk = (options: UseRingBleSdkOptions = {}) => {
  const devices = ref<RingDeviceInfo[]>([]);
  const deviceInfo = ref<RingDeviceInfo>({});
  const receivedData = ref<RingParsedData[]>([]);
  const normalizedData = ref<any[]>([]);
  const isScanning = ref(false);
  const isBluetoothReady = ref(false);
  const reconnectStatus = ref<RingReconnectStatus>('idle');
  const reconnectResult = ref<boolean | null>(null);
  const uploadingStatus = ref<RingUploadingStatus>('idle');
  let expectedConnectionDevice: RingDeviceInfo | null = null;
  let lastCommunicationReadyAt = 0;
  let connectionAttemptToken = 0;
  let connectionLifecycleToken = 0;
  let connectInFlight: Promise<RingDeviceInfo> | null = null;
  let connectInFlightKey = '';
  let connectInFlightStartedAt = 0;
  let reconnectInFlight: Promise<boolean> | null = null;
  let reconnectInFlightStartedAt = 0;
  let rwUploadDisconnectRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let rwUploadDisconnectRecoveryToken = 0;
  let lastUploadingStatusChangedAt = 0;

  const clearRwUploadDisconnectRecovery = () => {
    rwUploadDisconnectRecoveryToken += 1;
    if (!rwUploadDisconnectRecoveryTimer) return;
    clearTimeout(rwUploadDisconnectRecoveryTimer);
    rwUploadDisconnectRecoveryTimer = null;
  };

  const expirePendingConnectionAttempt = () => {
    connectionLifecycleToken += 1;
    connectionAttemptToken += 1;
    expectedConnectionDevice = { deviceId: '__cancelled_connection__' };
    connectInFlight = null;
    connectInFlightKey = '';
    reconnectInFlight = null;
    clearRwUploadDisconnectRecovery();
    lastCommunicationReadyAt = 0;
  };

  const isConnectionLifecycleCurrent = (token: number) => token === connectionLifecycleToken;

  const clearExpiredConnectionLifecycle = () => {
    lastCommunicationReadyAt = 0;
    reconnectStatus.value = 'idle';
    reconnectResult.value = null;
  };

  const state = {
    devices,
    isScanning
  };

  const bridgeTarget: RingStoreBridgeTarget = {
    get deviceInfo() {
      return deviceInfo.value;
    },
    get receivedData() {
      return receivedData.value;
    },
    get normalizedRingData() {
      return normalizedData.value;
    },
    handleParsedData(parsed) {
      receivedData.value = [...receivedData.value, enrichParsedDataWithCurrentRing(deviceInfo.value, parsed)];
    },
    handleNormalizedRingData(normalized) {
      normalizedData.value = [...normalizedData.value, normalized];
    },
    updateDeviceInfo(payload) {
      deviceInfo.value = payload;
    },
    updateReceivedData(payload) {
      receivedData.value = payload;
    },
    updateNormalizedRingData(payload) {
      normalizedData.value = payload;
    }
  };

  const runtime: RingBleRuntime = {
    getDeviceInfo: () => deviceInfo.value,
    onParsedData: (parsed) => {
      const currentDevice = deviceInfo.value;
      const isForCurrentRing =
        isParsedDataForCurrentRing(currentDevice, parsed) || isRuntimeBlePacketFromCurrentRing(currentDevice, parsed);
      if (!isForCurrentRing) {
        if (parsed.protocol === 'rw' || currentDevice.protocol === 'rw') {
          writeRwStoreLog('parsed-rejected', {
            currentDeviceId: currentDevice.deviceId,
            currentUniMacId: currentDevice.uniMacId,
            currentMac: currentDevice.mac,
            parsed: summarizeParsedForStoreLog(parsed)
          });
        }
        return;
      }
      const parsedForCurrentRing = enrichParsedDataWithCurrentRing(currentDevice, parsed);
      const receivedCountBefore = receivedData.value.length;
      const normalizedCountBefore = normalizedData.value.length;
      handleRingParsedData(bridgeTarget, parsedForCurrentRing);
      if (parsedForCurrentRing.protocol === 'rw' || currentDevice.protocol === 'rw') {
        writeRwStoreLog('parsed-accepted', {
          parsed: summarizeParsedForStoreLog(parsedForCurrentRing),
          receivedCountBefore,
          receivedCountAfter: receivedData.value.length,
          normalizedCountBefore,
          normalizedCountAfter: normalizedData.value.length,
          appendedReceived: receivedData.value.length !== receivedCountBefore,
          appendedNormalized: normalizedData.value.length !== normalizedCountBefore,
          latestNormalized: normalizedData.value[normalizedData.value.length - 1]
        });
      }
    },
    onDeviceReady: (payload) => {
      if (!isExpectedRingDevice(expectedConnectionDevice, payload)) return;
      if (payload.protocol === 'rw' || expectedConnectionDevice?.protocol === 'rw') {
        clearRwUploadDisconnectRecovery();
      }
      deviceInfo.value = payload;
    },
    onDisconnected: (reason) => {
      const disconnectedDeviceId = (reason as Record<string, any> | undefined)?.deviceId;
      if (disconnectedDeviceId && deviceInfo.value.deviceId && disconnectedDeviceId !== deviceInfo.value.deviceId) {
        if (deviceInfo.value.protocol === 'rw' || expectedConnectionDevice?.protocol === 'rw') {
          writeRwStoreLog('disconnected-ignored', {
            reason,
            current: summarizeRingDeviceIdentityForStoreLog(deviceInfo.value),
            expected: summarizeRingDeviceIdentityForStoreLog(expectedConnectionDevice)
          });
        }
        return;
      }
      if (shouldIgnoreRwReconnectDisconnectNoise(deviceInfo.value, expectedConnectionDevice, reconnectStatus.value === 'reconnecting')) {
        writeRwStoreLog('disconnected-ignored-during-reconnect', {
          reason,
          current: summarizeRingDeviceIdentityForStoreLog(deviceInfo.value),
          expected: summarizeRingDeviceIdentityForStoreLog(expectedConnectionDevice),
          connectInFlightKey,
          elapsedMs: connectInFlightStartedAt ? Date.now() - connectInFlightStartedAt : 0,
          lifecycleToken: connectionLifecycleToken,
          attemptToken: connectionAttemptToken
        });
        return;
      }
      if (deviceInfo.value.protocol === 'rw' || expectedConnectionDevice?.protocol === 'rw') {
        const isManualDisconnect = expectedConnectionDevice?.deviceId === '__cancelled_connection__';
        const uploadStatusAgeMs = lastUploadingStatusChangedAt ? Date.now() - lastUploadingStatusChangedAt : Number.POSITIVE_INFINITY;
        const isDuringOrJustAfterUpload =
          uploadingStatus.value === 'uploading' ||
          (uploadingStatus.value === 'success' && uploadStatusAgeMs <= RW_UPLOAD_SUCCESS_DISCONNECT_GRACE_MS);
        if (!isManualDisconnect && isDuringOrJustAfterUpload) {
          const targetDevice: RingDeviceInfo = {
            ...expectedConnectionDevice,
            ...deviceInfo.value,
            protocol: 'rw',
            notifyEnabled: false
          };
          const recoveryToken = (rwUploadDisconnectRecoveryToken += 1);
          expectedConnectionDevice = targetDevice;
          deviceInfo.value = targetDevice;
          reconnectStatus.value = 'reconnecting';
          reconnectResult.value = null;
          writeRwStoreLog('upload-disconnect-recovery-start', {
            reason,
            uploadingStatus: uploadingStatus.value,
            uploadStatusAgeMs,
            target: summarizeRingDeviceForStoreLog(targetDevice),
            elapsedMs: lastCommunicationReadyAt ? Date.now() - lastCommunicationReadyAt : null
          });
          if (rwUploadDisconnectRecoveryTimer) {
            clearTimeout(rwUploadDisconnectRecoveryTimer);
          }
          rwUploadDisconnectRecoveryTimer = setTimeout(() => {
            rwUploadDisconnectRecoveryTimer = null;
            void reconnect()
              .then((success) => {
                if (recoveryToken !== rwUploadDisconnectRecoveryToken) return;
                writeRwStoreLog('upload-disconnect-recovery-result', {
                  success,
                  target: summarizeRingDeviceForStoreLog(targetDevice),
                  current: summarizeRingDeviceForStoreLog(deviceInfo.value)
                });
                if (!success) {
                  clearDisconnectedRuntimeState();
                }
              })
              .catch((error) => {
                if (recoveryToken !== rwUploadDisconnectRecoveryToken) return;
                writeRwStoreLog('upload-disconnect-recovery-failed', {
                  target: summarizeRingDeviceForStoreLog(targetDevice),
                  message: error instanceof Error ? error.message : String(error)
                });
                clearDisconnectedRuntimeState();
              });
          }, RW_UPLOAD_DISCONNECT_RECOVERY_DELAY_MS);
          return;
        }
        writeRwStoreLog('disconnected-runtime-reset', {
          reason,
          current: summarizeRingDeviceIdentityForStoreLog(deviceInfo.value),
          expected: summarizeRingDeviceIdentityForStoreLog(expectedConnectionDevice),
          connectInFlightKey,
          elapsedMs: connectInFlightStartedAt ? Date.now() - connectInFlightStartedAt : 0,
          lifecycleTokenBefore: connectionLifecycleToken,
          attemptTokenBefore: connectionAttemptToken
        });
      }
      expirePendingConnectionAttempt();
      resetRingRuntimeState(bridgeTarget);
      expectedConnectionDevice = null;
      uploadingStatus.value = 'idle';
      reconnectStatus.value = 'failed';
      reconnectResult.value = false;
    },
    onBluetoothReadyChange: (ready) => {
      isBluetoothReady.value = ready;
    },
    onReconnectStatusChange: (status) => {
      reconnectStatus.value = status;
    },
    onReconnectResultChange: (success) => {
      reconnectResult.value = success;
    },
    onUploadingStatusChange: (status) => {
      uploadingStatus.value = status;
      lastUploadingStatusChangedAt = Date.now();
    },
    getBoundDevice: options.getBoundDevice,
    bindDevice: options.bindDevice,
    unbindDevice: options.unbindDevice,
    uploadHistoricalRecords: options.uploadHistoricalRecords
  };

  let adapter: LegacyRingAdapter = createRingBleAdapterByProtocol('legacy', state, runtime);

  const switchAdapter = async (protocol: RingProtocolKind) => {
    if (adapter.protocol === protocol) return adapter;
    await adapter.cleanup();
    adapter = await createRingBleAdapterByProtocolAsync(protocol, state, runtime);
    return adapter;
  };

  const isConnected = computed(() => isCommunicationReadyDevice(deviceInfo.value));

  const initBluetoothForProtocol = async (protocol: RingProtocolKind) => {
    const targetAdapter = await switchAdapter(protocol);
    return ensureLegacyBluetoothReady(targetAdapter, runtime);
  };

  const initBluetooth = async () => {
    const currentDevice = deviceInfo.value as RingDeviceInfo;
    const protocol = currentDevice.protocol || resolveRingProtocol(currentDevice);
    return initBluetoothForProtocol(protocol);
  };

  const normalizeScanOptions = (input?: string[] | StartScanOptions): StartScanOptions => {
    if (Array.isArray(input)) return { prefixes: input };
    return input || {};
  };

  const findKnownDevice = (...ids: Array<string | undefined>) => {
    const targets = ids.filter(Boolean) as string[];
    if (targets.length === 0) return null;
    return (
      devices.value.find((device) => {
        const deviceIds = getRingDeviceMatchIds(device);
        return targets.some((id) => deviceIds.includes(id) || isSameRingDevice(device, { deviceId: id } as RingDeviceInfo));
      }) || null
    );
  };

  const startScanWithProtocol = async (protocol: RingProtocolKind, input?: string[] | StartScanOptions) => {
    await initBluetoothForProtocol(protocol);
    return adapter.startScan(normalizeScanOptions(input));
  };

  const startScan = async (input?: string[] | StartScanOptions) => {
    if (!deviceInfo.value.deviceId) {
      return startScanWithProtocol('legacy', input);
    }
    await initBluetooth();
    return adapter.startScan(normalizeScanOptions(input));
  };

  const stopScan = () => adapter.stopScan();

  const connectDevice = async (payload: ConnectRingDeviceOptions) => {
    const sourceDevice = payload.sourceDevice || findKnownDevice(payload.deviceId, payload.uniMacId);
    const protocol = payload.protocol || resolveRingProtocol(sourceDevice || payload);
    const currentDevice = deviceInfo.value;
    const sourceStableIdentity =
      protocol === 'rw'
        ? getRwStableConnectionIdentity(sourceDevice, payload.uniMacId)
        : sourceDevice?.mac || sourceDevice?.advertis?.macInfo;
    const targetDevice: RingDeviceInfo = {
      ...sourceDevice,
      deviceId: payload.deviceId || sourceDevice?.deviceId,
      uniMacId:
        protocol === 'rw'
          ? sourceStableIdentity
          : payload.uniMacId || sourceDevice?.uniMacId || sourceStableIdentity,
      mac: sourceStableIdentity,
      protocol
    };
    const connectKey = [
      protocol,
      targetDevice.deviceId || payload.deviceId || '',
      sourceStableIdentity || targetDevice.uniMacId || targetDevice.mac || ''
    ].join('|');
    if (connectInFlight && connectInFlightKey === connectKey) {
      if (protocol === 'rw') {
        writeRwStoreLog('connect-reuse-inflight', {
          connectKey,
          elapsedMs: connectInFlightStartedAt ? Date.now() - connectInFlightStartedAt : 0,
          target: summarizeRingDeviceForStoreLog(targetDevice)
        });
      }
      return connectInFlight;
    }
    if (connectInFlight) {
      if (protocol === 'rw') {
        writeRwStoreLog('connect-wait-other-inflight', {
          connectKey,
          pendingKey: connectInFlightKey,
          elapsedMs: connectInFlightStartedAt ? Date.now() - connectInFlightStartedAt : 0,
          target: summarizeRingDeviceForStoreLog(targetDevice)
        });
      }
      const pendingConnect = connectInFlight;
      const pendingConnectedDevice = await pendingConnect.catch(() => null);
      if (pendingConnectedDevice && isSameSwitchingRingDevice(pendingConnectedDevice, targetDevice)) {
        if (protocol === 'rw') {
          writeRwStoreLog('connect-other-inflight-matched', {
            connectKey,
            connected: summarizeRingDeviceForStoreLog(pendingConnectedDevice)
          });
        }
        return pendingConnectedDevice;
      }
    }

    const runConnect = async () => {
      const switchingDevice = isSwitchingRingDevice(currentDevice, targetDevice);

      if (switchingDevice) {
        if (protocol === 'rw') {
          writeRwStoreLog('connect-switch-device', {
            current: summarizeRingDeviceForStoreLog(currentDevice),
            target: summarizeRingDeviceForStoreLog(targetDevice)
          });
        }
        await disconnectLegacyRing(adapter, runtime, currentDevice.deviceId);
        resetRingRuntimeState(bridgeTarget);
      }

      const startToken = connectionAttemptToken;
      const targetAdapter = await switchAdapter(protocol);
      if (startToken !== connectionAttemptToken) {
        lastCommunicationReadyAt = 0;
        if (protocol === 'rw') {
          writeRwStoreLog('connect-cancelled-before-start', {
            connectKey,
            startToken,
            currentToken: connectionAttemptToken
          });
        }
        throw new Error('Ring BLE connection attempt was cancelled.');
      }
      const attemptToken = (connectionAttemptToken += 1);
      expectedConnectionDevice = targetDevice;
      if (protocol === 'rw') {
        writeRwStoreLog('connect-attempt-start', {
          connectKey,
          attemptToken,
          payload: {
            deviceId: payload.deviceId,
            deviceName: payload.deviceName,
            uniMacId: payload.uniMacId,
            fromScan: payload.fromScan,
            bindAfterConnected: payload.bindAfterConnected
          },
          target: summarizeRingDeviceForStoreLog(targetDevice),
          sourceDevice: summarizeRingDeviceForStoreLog(sourceDevice),
          current: summarizeRingDeviceForStoreLog(currentDevice)
        });
      }
      const connected = await connectLegacyRing(targetAdapter, runtime, { ...payload, sourceDevice: targetDevice });
      if (attemptToken !== connectionAttemptToken || !isExpectedRingDevice(expectedConnectionDevice, connected)) {
        lastCommunicationReadyAt = 0;
        if (protocol === 'rw') {
          writeRwStoreLog('connect-cancelled-after-result', {
            connectKey,
            attemptToken,
            currentToken: connectionAttemptToken,
            expected: summarizeRingDeviceForStoreLog(expectedConnectionDevice),
            connected: summarizeRingDeviceForStoreLog(connected)
          });
        }
        throw new Error('Ring BLE connection attempt was cancelled.');
      }
      lastCommunicationReadyAt = Date.now();
      if (isCommunicationReadyDevice(connected)) {
        reconnectStatus.value = 'success';
        reconnectResult.value = true;
      }
      if (protocol === 'rw') {
        writeRwStoreLog('connect-attempt-result', {
          connectKey,
          ready: isCommunicationReadyDevice(connected),
          connected: summarizeRingDeviceForStoreLog(connected)
        });
      }
      return connected;
    };

    connectInFlightKey = connectKey;
    connectInFlightStartedAt = Date.now();
    if (protocol === 'rw') {
      writeRwStoreLog('connect-request', {
        connectKey,
        target: summarizeRingDeviceForStoreLog(targetDevice),
        sourceDevice: summarizeRingDeviceForStoreLog(sourceDevice),
        current: summarizeRingDeviceForStoreLog(currentDevice)
      });
    }
    connectInFlight = runConnect();
    try {
      return await connectInFlight;
    } catch (error) {
      if (protocol === 'rw') {
        writeRwStoreLog('connect-attempt-error', {
          connectKey,
          elapsedMs: connectInFlightStartedAt ? Date.now() - connectInFlightStartedAt : 0,
          message: error instanceof Error ? error.message : String(error)
        });
      }
      throw error;
    } finally {
      if (connectInFlightKey === connectKey) {
        connectInFlight = null;
        connectInFlightKey = '';
        connectInFlightStartedAt = 0;
      }
    }
  };

  const handleConnectDevice = (deviceId: string, deviceName: string, uniMacId = '', fromScan = false) => {
    return connectDevice({
      deviceId,
      deviceName,
      uniMacId,
      fromScan,
      bindAfterConnected: true
    });
  };

  const restartScan = async (input?: string[] | StartScanOptions) => {
    await stopScan();
    return startScan(input);
  };

  const reScan = async (input?: string[] | StartScanOptions) => {
    await initBluetooth();

    if (isScanning.value) {
      await stopScan();
    }

    if (deviceInfo.value.deviceId) {
      await disconnect();
    }

    clearData();
    return startScan(input);
  };

  const disconnect = async () => {
    const currentDeviceId = deviceInfo.value.deviceId;
    expirePendingConnectionAttempt();
    const result = await disconnectLegacyRing(adapter, runtime, currentDeviceId);
    resetRingRuntimeState(bridgeTarget);
    return result;
  };

  const ensureCommunicationReady = async () => {
    const lifecycleToken = connectionLifecycleToken;
    await initBluetooth();
    const currentDevice = deviceInfo.value as RingDeviceInfo;
    const protocol = currentDevice.protocol || resolveRingProtocol(currentDevice);
    const targetAdapter = await switchAdapter(protocol);
    if (protocol === 'rw') {
      writeRwStoreLog('ensure-ready-start', {
        lifecycleToken,
        current: summarizeRingDeviceForStoreLog(currentDevice),
        ready: isCommunicationReadyDevice(currentDevice),
        notifySnapshot: hasRwNotifyDiscoverySnapshot(currentDevice),
        lastCommunicationAgeMs: lastCommunicationReadyAt ? Date.now() - lastCommunicationReadyAt : null
      });
    }
    if (!isConnectionLifecycleCurrent(lifecycleToken)) {
      if (protocol === 'rw') {
        writeRwStoreLog('ensure-ready-cancelled-before-listener', {
          lifecycleToken,
          currentToken: connectionLifecycleToken
        });
      }
      clearExpiredConnectionLifecycle();
      return false;
    }
    targetAdapter.registerConnectionStateListener();
    let readyDevice = currentDevice;
    const shouldRefreshRwDiscovery = protocol === 'rw' && !hasRwNotifyDiscoverySnapshot(currentDevice);
    const notifyServiceId = readyDevice.dataServiceId || readyDevice.serviceId;

    if (
      readyDevice.deviceId &&
      readyDevice.serviceId &&
      readyDevice.cmdCharId &&
      readyDevice.dataCharId &&
      readyDevice.notifyEnabled !== false &&
      !shouldRefreshRwDiscovery &&
      isConnected.value === true &&
      Date.now() - lastCommunicationReadyAt < 8000
    ) {
      if (protocol === 'rw') {
        writeRwStoreLog('ensure-ready-reuse-recent', {
          device: summarizeRingDeviceForStoreLog(readyDevice)
        });
      }
      return true;
    }

    if (readyDevice.deviceId && readyDevice.serviceId && readyDevice.cmdCharId && readyDevice.dataCharId && notifyServiceId) {
      try {
        if (shouldRefreshRwDiscovery) {
          if (protocol === 'rw') {
            writeRwStoreLog('ensure-ready-discover-refresh-start', {
              device: summarizeRingDeviceForStoreLog(readyDevice)
            });
          }
          const discovered = await targetAdapter.discoverServicesAndChars(
            readyDevice.deviceId,
            readyDevice.deviceName || readyDevice.name || '',
            readyDevice
          );
          if (!isConnectionLifecycleCurrent(lifecycleToken)) {
            if (protocol === 'rw') {
              writeRwStoreLog('ensure-ready-cancelled-after-discover', {
                lifecycleToken,
                currentToken: connectionLifecycleToken
              });
            }
            clearExpiredConnectionLifecycle();
            return false;
          }
          readyDevice = {
            ...readyDevice,
            ...discovered
          };
        }
        const readyDeviceId = readyDevice.deviceId;
        const primaryNotifyServiceId = readyDevice.dataServiceId || readyDevice.serviceId;
        const primaryNotifyCharacteristicId = readyDevice.dataCharId;
        if (!readyDeviceId || !primaryNotifyServiceId || !primaryNotifyCharacteristicId) {
          throw new Error('Ring BLE communication is not ready.');
        }

        targetAdapter.setupDataListener();
        await targetAdapter.enableNotify(readyDeviceId, primaryNotifyServiceId, primaryNotifyCharacteristicId);
        if (!isConnectionLifecycleCurrent(lifecycleToken)) {
          if (protocol === 'rw') {
            writeRwStoreLog('ensure-ready-cancelled-after-notify', {
              lifecycleToken,
              currentToken: connectionLifecycleToken
            });
          }
          clearExpiredConnectionLifecycle();
          return false;
        }
        runtime?.onDeviceReady?.({
          ...readyDevice,
          notifyEnabled: true,
          notifyError: ''
        });
        reconnectStatus.value = 'success';
        reconnectResult.value = true;
        lastCommunicationReadyAt = Date.now();
        if (protocol === 'rw') {
          writeRwStoreLog('ensure-ready-notify-restored', {
            device: summarizeRingDeviceForStoreLog(readyDevice)
          });
        }
        return true;
      } catch (error) {
        if (!isConnectionLifecycleCurrent(lifecycleToken)) {
          if (protocol === 'rw') {
            writeRwStoreLog('ensure-ready-cancelled-after-restore-error', {
              lifecycleToken,
              currentToken: connectionLifecycleToken,
              message: error instanceof Error ? error.message : String(error)
            });
          }
          clearExpiredConnectionLifecycle();
          return false;
        }
        if (protocol === 'rw') {
          writeRwStoreLog('ensure-ready-notify-restore-failed', {
            device: summarizeRingDeviceForStoreLog(readyDevice),
            message: error instanceof Error ? error.message : String(error)
          });
        }
        // Fall through to a full reconnect when the platform cannot restore notify in place.
      }
    }

    const reconnected = await reconnect();
    if (reconnected) lastCommunicationReadyAt = Date.now();
    if (protocol === 'rw') {
      writeRwStoreLog('ensure-ready-reconnect-result', {
        success: reconnected,
        device: summarizeRingDeviceForStoreLog(deviceInfo.value)
      });
    }
    return reconnected;
  };

  const cancelPendingConnection = (deviceId = '') => {
    const pendingDeviceId = deviceId || expectedConnectionDevice?.deviceId || '';
    writeRwStoreLog('cancel-pending-connection', {
      requestedDeviceId: deviceId,
      pendingDeviceId,
      expected: summarizeRingDeviceForStoreLog(expectedConnectionDevice),
      current: summarizeRingDeviceForStoreLog(deviceInfo.value),
      connectInFlightKey,
      elapsedMs: connectInFlightStartedAt ? Date.now() - connectInFlightStartedAt : 0
    });
    expirePendingConnectionAttempt();
    if (!pendingDeviceId || pendingDeviceId === '__cancelled_connection__') return Promise.resolve();
    return adapter.disconnect(pendingDeviceId).catch(() => undefined);
  };

  const clearDisconnectedRuntimeState = () => {
    resetRingRuntimeState(bridgeTarget);
    expectedConnectionDevice = null;
    uploadingStatus.value = 'idle';
    lastCommunicationReadyAt = 0;
    clearRwUploadDisconnectRecovery();
  };

  const setExpectedReconnectTarget = (target: RingDeviceInfo) => {
    expectedConnectionDevice = {
      ...target,
      protocol: target.protocol || resolveRingProtocol(target)
    };
  };

  const getRwReconnectScanTimeoutMs = () => options.rwReconnectScanTimeoutMs ?? RW_RECONNECT_SCAN_TIMEOUT_MS;
  const getRwReconnectCandidateTimeoutMs = (target?: RingDeviceInfo | null) => {
    if (options.rwReconnectCandidateTimeoutMs != null) return options.rwReconnectCandidateTimeoutMs;
    if (target && resolveRingProtocol(target) === 'rw' && getRingDeviceStableIdentity(target)) {
      return RW_RECONNECT_BOUND_CANDIDATE_TIMEOUT_MS;
    }
    return RW_RECONNECT_CANDIDATE_TIMEOUT_MS;
  };

  const getFreshReconnectScanDevices = (minLastSeenAt?: number) => {
    if (!minLastSeenAt) return devices.value;
    return devices.value.filter((device) => {
      const lastSeenAt = Number(device.lastSeenAt || 0);
      return Number.isFinite(lastSeenAt) && lastSeenAt >= minLastSeenAt - 500;
    });
  };

  const findFreshReconnectScanCandidate = (target: RingDeviceInfo, minLastSeenAt?: number) =>
    findReconnectScanCandidate(target, getFreshReconnectScanDevices(minLastSeenAt));

  const waitForReconnectScanCandidate = async (
    target: RingDeviceInfo,
    timeoutMs = getRwReconnectCandidateTimeoutMs(target),
    minLastSeenAt?: number
  ) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const candidate = findFreshReconnectScanCandidate(target, minLastSeenAt);
      if (candidate) return candidate;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return findFreshReconnectScanCandidate(target, minLastSeenAt);
  };

  const reconnectByScanning = async (target: RingDeviceInfo) => {
    const lifecycleToken = connectionLifecycleToken;
    reconnectStatus.value = 'reconnecting';
    reconnectResult.value = null;
    let scanStarted = false;

    try {
      const scanProtocol = target.protocol || resolveRingProtocol(target);
      const scanTimeoutMs = getRwReconnectScanTimeoutMs();
      const candidateTimeoutMs = getRwReconnectCandidateTimeoutMs(target);
      const scanStartedAt = Date.now();
      writeRwStoreLog('reconnect-scan-start', {
        target: summarizeRingDeviceForStoreLog(target),
        targetIdentity: summarizeRingDeviceIdentityForStoreLog(target),
        scanProtocol,
        knownDeviceCount: devices.value.length,
        scanTimeoutMs,
        candidateTimeoutMs
      });
      let scanRound = 0;
      let candidate: RingDeviceInfo | null = null;
      while (!candidate && Date.now() - scanStartedAt < candidateTimeoutMs) {
        scanRound += 1;
        const remainingMs = Math.max(1000, candidateTimeoutMs - (Date.now() - scanStartedAt));
        const roundTimeoutMs = Math.min(scanTimeoutMs, remainingMs);
        writeRwStoreLog('reconnect-scan-round-start', {
          round: scanRound,
          target: summarizeRingDeviceForStoreLog(target),
          targetIdentity: summarizeRingDeviceIdentityForStoreLog(target),
          timeoutMs: roundTimeoutMs,
          elapsedMs: Date.now() - scanStartedAt,
          scannedDeviceCount: devices.value.length
        });
        await startScanWithProtocol(scanProtocol, {
          includeUnknown: true,
          allowDuplicatesKey: true,
          preserveDevices: true,
          timeoutMs: roundTimeoutMs
        });
        writeRwStoreLog('reconnect-scan-started', {
          round: scanRound,
          target: summarizeRingDeviceForStoreLog(target),
          scannedDeviceCount: devices.value.length
        });
        scanStarted = true;
        if (!isConnectionLifecycleCurrent(lifecycleToken)) {
          clearExpiredConnectionLifecycle();
          return false;
        }

        writeRwStoreLog('reconnect-candidate-wait-start', {
          round: scanRound,
          target: summarizeRingDeviceForStoreLog(target),
          candidateTimeoutMs: roundTimeoutMs,
          scannedDeviceCount: devices.value.length,
          freshScannedDeviceCount: getFreshReconnectScanDevices(scanStartedAt).length
        });
        candidate = await waitForReconnectScanCandidate(target, roundTimeoutMs, scanStartedAt);
        writeRwStoreLog('reconnect-scan-round-result', {
          round: scanRound,
          found: Boolean(candidate?.deviceId),
          target: summarizeRingDeviceForStoreLog(target),
          candidate: summarizeRingDeviceForStoreLog(candidate),
          elapsedMs: Date.now() - scanStartedAt,
          scannedDeviceCount: devices.value.length,
          freshScannedDeviceCount: getFreshReconnectScanDevices(scanStartedAt).length,
          scannedTail: devices.value.slice(-6).map(summarizeRingDeviceForStoreLog),
          scannedIdentityTail: devices.value.slice(-6).map(summarizeRingDeviceIdentityForStoreLog)
        });
        if (!isConnectionLifecycleCurrent(lifecycleToken)) {
          clearExpiredConnectionLifecycle();
          return false;
        }
        if (!candidate && Date.now() - scanStartedAt < candidateTimeoutMs) {
          await stopScan().catch(() => undefined);
          scanStarted = false;
          await new Promise((resolve) => setTimeout(resolve, RW_RECONNECT_SCAN_ROUND_GAP_MS));
        }
      }
      writeRwStoreLog('reconnect-scan-candidate', {
        found: Boolean(candidate?.deviceId),
        target: summarizeRingDeviceForStoreLog(target),
        targetIdentity: summarizeRingDeviceIdentityForStoreLog(target),
        candidate: summarizeRingDeviceForStoreLog(candidate),
        candidateIdentity: summarizeRingDeviceIdentityForStoreLog(candidate),
        elapsedMs: Date.now() - scanStartedAt,
        scanRounds: scanRound,
        scannedDeviceCount: devices.value.length,
        freshScannedDeviceCount: getFreshReconnectScanDevices(scanStartedAt).length,
        scannedTail: devices.value.slice(-6).map(summarizeRingDeviceForStoreLog),
        scannedIdentityTail: devices.value.slice(-6).map(summarizeRingDeviceIdentityForStoreLog)
      });
      if (!isConnectionLifecycleCurrent(lifecycleToken)) {
        clearExpiredConnectionLifecycle();
        return false;
      }
      if (!candidate?.deviceId) {
        reconnectStatus.value = 'failed';
        reconnectResult.value = false;
        return false;
      }

      await stopScan();
      scanStarted = false;
      const protocol = candidate.protocol || target.protocol || resolveRingProtocol(candidate);
      expectedConnectionDevice = { ...candidate, protocol };
      writeRwStoreLog('reconnect-connect-start', {
        protocol,
        target: summarizeRingDeviceForStoreLog(target),
        candidate: summarizeRingDeviceForStoreLog(candidate)
      });
      await connectDevice({
        deviceId: candidate.deviceId,
        deviceName: candidate.deviceName || candidate.name || target.deviceName || target.name || '',
        uniMacId:
          candidate.uniMacId ||
          candidate.mac ||
          candidate.advertis?.macInfo ||
          target.uniMacId ||
          target.mac ||
          target.advertis?.macInfo,
        fromScan: true,
        bindAfterConnected: true,
        protocol,
        sourceDevice: { ...candidate, protocol }
      });
      if (!isConnectionLifecycleCurrent(lifecycleToken)) {
        clearExpiredConnectionLifecycle();
        return false;
      }
      if (!isSameRingDevice({ ...target, protocol }, { ...candidate, ...deviceInfo.value, protocol: deviceInfo.value.protocol || protocol })) {
        writeRwStoreLog('reconnect-connect-result', {
          success: false,
          reason: 'unexpected-device',
          target: summarizeRingDeviceForStoreLog({ ...target, protocol }),
          candidate: summarizeRingDeviceForStoreLog(candidate),
          deviceInfo: summarizeRingDeviceForStoreLog(deviceInfo.value)
        });
        await disconnect().catch(() => undefined);
        setExpectedReconnectTarget({ ...target, protocol });
        reconnectStatus.value = 'failed';
        reconnectResult.value = false;
        return false;
      }
      reconnectStatus.value = 'success';
      reconnectResult.value = true;
      writeRwStoreLog('reconnect-connect-result', {
        success: true,
        deviceInfo: summarizeRingDeviceForStoreLog(deviceInfo.value)
      });
      return true;
    } catch (error) {
      if (!isConnectionLifecycleCurrent(lifecycleToken)) {
        clearExpiredConnectionLifecycle();
        return false;
      }
      setExpectedReconnectTarget(target);
      lastCommunicationReadyAt = 0;
      reconnectStatus.value = 'failed';
      reconnectResult.value = false;
      writeRwStoreLog('reconnect-connect-result', {
        success: false,
        target: summarizeRingDeviceForStoreLog(target),
        message: error instanceof Error ? error.message : String(error)
      });
      return false;
    } finally {
      if (scanStarted) {
        await stopScan().catch(() => undefined);
      }
    }
  };

  const runReconnect = async () => {
    const lifecycleToken = connectionLifecycleToken;
    const currentDevice = deviceInfo.value;
    let boundDevice: RingDeviceInfo | null | undefined = null;
    try {
      boundDevice = await options.getBoundDevice?.();
    } catch {
      boundDevice = null;
    }
    const hasBoundReconnectTarget = hasRingReconnectTargetIdentity(boundDevice);
    const currentMatchesBound = hasBoundReconnectTarget
      ? isSameBoundReconnectDevice(boundDevice as RingDeviceInfo, currentDevice)
      : false;
    const targetDevice = (
      hasBoundReconnectTarget
        ? buildReconnectTargetFromBoundDevice(boundDevice as RingDeviceInfo, currentDevice)
        : currentDevice.deviceId
        ? {
            ...boundDevice,
            ...currentDevice,
            mac: currentDevice.mac || boundDevice?.mac,
            uniMacId: currentDevice.uniMacId || boundDevice?.uniMacId,
            name: currentDevice.name || boundDevice?.name,
            deviceName: currentDevice.deviceName || currentDevice.name || boundDevice?.deviceName || boundDevice?.name,
            protocol: currentDevice.protocol || boundDevice?.protocol
          }
        : boundDevice
    ) as RingDeviceInfo | undefined;
    writeRwStoreLog('reconnect-start', {
      lifecycleToken,
      boundTargetLocked: hasBoundReconnectTarget,
      currentMatchesBound,
      current: summarizeRingDeviceForStoreLog(currentDevice),
      bound: summarizeRingDeviceForStoreLog(boundDevice),
      target: summarizeRingDeviceForStoreLog(targetDevice)
    });
    if (!hasRingReconnectTargetIdentity(targetDevice)) {
      reconnectStatus.value = 'failed';
      reconnectResult.value = false;
      writeRwStoreLog('reconnect-no-target', {
        current: summarizeRingDeviceForStoreLog(currentDevice),
        bound: summarizeRingDeviceForStoreLog(boundDevice)
      });
      return false;
    }
    if (!isConnectionLifecycleCurrent(lifecycleToken)) {
      clearExpiredConnectionLifecycle();
      return false;
    }
    const protocol = resolveRingProtocol(targetDevice as RingDeviceInfo);
    const targetWithProtocol = { ...targetDevice, protocol };
    setExpectedReconnectTarget(targetWithProtocol);
    const targetAdapter = await switchAdapter(protocol);
    if (!isConnectionLifecycleCurrent(lifecycleToken)) {
      clearExpiredConnectionLifecycle();
      return false;
    }
    if (shouldReconnectByScanningFirst(targetWithProtocol)) {
      const scannedConnected = await reconnectByScanning(targetWithProtocol);
      if (!isConnectionLifecycleCurrent(lifecycleToken)) {
        clearExpiredConnectionLifecycle();
        return false;
      }
      if (scannedConnected) return true;
      if (shouldSkipDirectRwReconnect(targetWithProtocol)) {
        writeRwStoreLog('reconnect-skip-direct', {
          reason: 'rw-no-fresh-scan-candidate',
          targetAgeMs: getRwReconnectTargetAgeMs(targetWithProtocol),
          maxFreshAgeMs: RW_DIRECT_RECONNECT_MAX_DEVICE_AGE_MS,
          target: summarizeRingDeviceForStoreLog(targetWithProtocol)
        });
        clearDisconnectedRuntimeState();
        return false;
      }
    }
    writeRwStoreLog('reconnect-direct-start', {
      target: summarizeRingDeviceForStoreLog({ ...targetDevice, protocol })
    });
    const directlyConnected = await autoReconnectLegacyRing(targetAdapter, runtime, { maxAttempts: 1, delayMs: 0 });
    if (!isConnectionLifecycleCurrent(lifecycleToken)) {
      clearExpiredConnectionLifecycle();
      return false;
    }
    if (directlyConnected && !isSameRingDevice(targetWithProtocol, deviceInfo.value)) {
      writeRwStoreLog('reconnect-direct-result', {
        success: false,
        reason: 'unexpected-device',
        target: summarizeRingDeviceForStoreLog(targetWithProtocol),
        deviceInfo: summarizeRingDeviceForStoreLog(deviceInfo.value)
      });
      await disconnect().catch(() => undefined);
      setExpectedReconnectTarget(targetWithProtocol);
      reconnectStatus.value = 'failed';
      reconnectResult.value = false;
      return false;
    }
    if (directlyConnected) lastCommunicationReadyAt = Date.now();
    writeRwStoreLog('reconnect-direct-result', {
      success: directlyConnected,
      deviceInfo: summarizeRingDeviceForStoreLog(deviceInfo.value)
    });
    if (directlyConnected || !targetDevice) return directlyConnected;
    return reconnectByScanning(targetWithProtocol);
  };
  const reconnect = async () => {
    if (reconnectInFlight) {
      const currentDevice = deviceInfo.value;
      writeRwStoreLog('reconnect-reuse-inflight', {
        elapsedMs: reconnectInFlightStartedAt ? Date.now() - reconnectInFlightStartedAt : 0,
        current: summarizeRingDeviceForStoreLog(currentDevice),
        expected: summarizeRingDeviceForStoreLog(expectedConnectionDevice)
      });
      return reconnectInFlight;
    }

    reconnectInFlightStartedAt = Date.now();
    const currentReconnect = runReconnect();
    reconnectInFlight = currentReconnect;
    try {
      return await currentReconnect;
    } finally {
      if (reconnectInFlight === currentReconnect) {
        reconnectInFlight = null;
        reconnectInFlightStartedAt = 0;
      }
    }
  };
  const autoConnectLastDevice = reconnect;
  const registerGlobalListeners = async () => {
    const currentDevice = deviceInfo.value as RingDeviceInfo;
    const protocol = currentDevice.protocol || resolveRingProtocol(currentDevice);
    const targetAdapter = await switchAdapter(protocol);
    targetAdapter.registerConnectionStateListener();
  };

  const runWithReady = async <T>(task: () => Promise<T>) => {
    const currentDevice = deviceInfo.value as RingDeviceInfo;
    const shouldEnsureRwServiceReadyWithoutStableIdentity =
      resolveRingProtocol(currentDevice) === 'rw' &&
      isConnected.value &&
      (!hasRwNotifyDiscoverySnapshot(currentDevice) || currentDevice.notifyEnabled === false);
    if (!getRingDeviceStableIdentity(currentDevice) && !shouldEnsureRwServiceReadyWithoutStableIdentity) {
      return task();
    }
    const ready = await ensureCommunicationReady();
    if (!ready) {
      throw new Error('Ring BLE communication is not ready.');
    }
    return task();
  };

  const switchAdapterForDeviceTool = async (deviceId?: string, serviceId?: string) => {
    const matchedDevice = findKnownDevice(deviceId);
    const currentDevice = deviceInfo.value;
    const currentMatchesDevice =
      Boolean(deviceId) &&
      getRingDeviceMatchIds(currentDevice).length > 0 &&
      isSameRingDevice(currentDevice, { deviceId });
    const currentMatchesService =
      Boolean(serviceId) &&
      [currentDevice.serviceId, currentDevice.dataServiceId].filter(Boolean).some((id) => normalizeRingUuid(id) === normalizeRingUuid(serviceId));
    const protocol =
      (isRwServiceUuid(serviceId) ? 'rw' : undefined) ||
      matchedDevice?.protocol ||
      (currentMatchesDevice || currentMatchesService ? currentDevice.protocol : undefined) ||
      resolveRingProtocol(matchedDevice || currentDevice);
    return switchAdapter(protocol);
  };

  const resolvePlatformDeviceIdForDeviceTool = (deviceId?: string) => {
    if (!deviceId) return deviceId || '';

    const matchedDevice = findKnownDevice(deviceId);
    if (matchedDevice?.deviceId) return matchedDevice.deviceId;

    const currentDevice = deviceInfo.value;
    if (
      currentDevice.deviceId &&
      getRingDeviceMatchIds(currentDevice).length > 0 &&
      isSameRingDevice(currentDevice, { deviceId })
    ) {
      return currentDevice.deviceId;
    }

    return deviceId;
  };

  const enableNotify = async (...args: Parameters<LegacyRingAdapter['enableNotify']>) => {
    const [deviceId, serviceId] = args;
    const targetAdapter = await switchAdapterForDeviceTool(deviceId, serviceId);
    return targetAdapter.enableNotify(...args);
  };

  const checkByRSSI = async (...args: Parameters<LegacyRingAdapter['checkByRSSI']>) => {
    const [deviceId] = args;
    const targetAdapter = await switchAdapterForDeviceTool(deviceId);
    return targetAdapter.checkByRSSI(resolvePlatformDeviceIdForDeviceTool(deviceId));
  };

  const isDeviceConnected = async (...args: Parameters<LegacyRingAdapter['isDeviceConnected']>) => {
    const [deviceId, serviceId] = args;
    const targetAdapter = await switchAdapterForDeviceTool(deviceId, serviceId);
    return targetAdapter.isDeviceConnected(resolvePlatformDeviceIdForDeviceTool(deviceId), serviceId);
  };

  const discoverServicesAndChars = async (...args: Parameters<LegacyRingAdapter['discoverServicesAndChars']>) => {
    const [deviceId, deviceName = '', sourceDevice] = args;
    const matchedDevice = sourceDevice || findKnownDevice(deviceId, deviceName);
    const deviceNameOrId = deviceName || matchedDevice?.deviceName || matchedDevice?.name || deviceId;
    const protocolSource: RingDeviceInfo = {
      ...matchedDevice,
      deviceId: matchedDevice?.deviceId || deviceId,
      uniMacId: matchedDevice?.uniMacId || matchedDevice?.mac || matchedDevice?.advertis?.macInfo,
      mac: matchedDevice?.mac || matchedDevice?.advertis?.macInfo,
      name: matchedDevice?.name || deviceNameOrId,
      deviceName: matchedDevice?.deviceName || deviceNameOrId,
      localName: matchedDevice?.localName || deviceNameOrId,
      displayName: matchedDevice?.displayName || deviceNameOrId,
      protocol: matchedDevice?.protocol
    };
    const protocol = protocolSource.protocol || resolveRingProtocol(protocolSource);
    const startToken = connectionAttemptToken;
    const targetAdapter = await switchAdapter(protocol);
    if (startToken !== connectionAttemptToken) {
      throw new Error('Ring BLE discovery attempt was cancelled.');
    }
    const attemptToken = (connectionAttemptToken += 1);
    const platformDeviceId = protocolSource.deviceId || deviceId;
    expectedConnectionDevice = { ...protocolSource, deviceId: platformDeviceId, protocol };
    const discovered = await targetAdapter.discoverServicesAndChars(platformDeviceId, deviceNameOrId, {
      ...protocolSource,
      deviceId: platformDeviceId,
      protocol
    });
    if (attemptToken !== connectionAttemptToken || !isExpectedRingDevice(expectedConnectionDevice, discovered)) {
      lastCommunicationReadyAt = 0;
      throw new Error('Ring BLE discovery attempt was cancelled.');
    }
    lastCommunicationReadyAt = Date.now();
    return discovered;
  };

  const syncHistory = (params?: Parameters<typeof syncLegacyHistory>[2]) => {
    return runWithReady(() => syncLegacyHistory(adapter, runtime, params));
  };

  const syncRwHistoryAlias = (name?: CompatRwHistoryDataName) => {
    return runWithReady(async () => {
      const normalizedName = name ? normalizeRwHistoryDataName(name) : undefined;
      if (adapter.protocol !== 'rw') {
        return syncLegacyHistory(adapter, runtime, {
          readAll: true
        });
      }
      return syncLegacyHistory(adapter, runtime, {
        readAll: true,
        ...(normalizedName ? { dataType: normalizedName } : {})
      });
    });
  };

  const refreshBusinessMetrics = (params?: Parameters<typeof refreshLegacyBusinessMetrics>[2]) => {
    return runWithReady(() => refreshLegacyBusinessMetrics(adapter, runtime, params));
  };

  const callRwAdapterMethod = <T extends keyof LegacyRingAdapter>(method: T, ...args: any[]) => {
    return runWithReady(async () => {
      const fn = adapter[method];
      if (typeof fn !== 'function') {
        throw new Error(`当前协议不支持 ${String(method)}`);
      }
      return (fn as (...methodArgs: any[]) => Promise<unknown>)(...args);
    });
  };

  const unbind = async () => {
    const currentDeviceId = getRingDeviceStableIdentity(deviceInfo.value);
    let targetBindIdentity = currentDeviceId;
    if (!targetBindIdentity) {
      try {
        const boundDevice = await options.getBoundDevice?.();
        targetBindIdentity = boundDevice ? getRingDeviceStableIdentity(boundDevice as RingDeviceInfo) : '';
      } catch {
        targetBindIdentity = '';
      }
    }
    expirePendingConnectionAttempt();
    const result = await unbindLegacyRing(adapter, runtime, targetBindIdentity);
    resetRingRuntimeState(bridgeTarget);
    return result;
  };

  const cleanup = async () => {
    await cancelPendingConnection();
    await cleanupLegacyRing(adapter, runtime);
    resetRingRuntimeState(bridgeTarget);
  };

  const clearData = () => {
    receivedData.value = [];
    normalizedData.value = [];
  };

  return {
    get adapter() {
      return adapter;
    },
    devices,
    deviceInfo,
    receivedData,
    normalizedData,
    isScanning,
    isBluetoothReady,
    isConnected,
    reconnectStatus,
    reconnectResult,
    uploadingStatus,
    initBluetooth,
    startScan,
    restartScan,
    stopScan,
    connectDevice,
    cancelPendingConnection,
    handleConnectDevice,
    discoverServicesAndChars,
    enableNotify,
    disconnect,
    ensureCommunicationReady,
    reScan,
    reconnect,
    autoConnectLastDevice,
    registerGlobalListeners,
    syncHistory,
    refreshBusinessMetrics,
    unbind,
    cleanup,
    clearData,
    checkBluetoothState: () => adapter.checkBluetoothState(),
    checkByRSSI,
    isDeviceConnected,
    getCachedServiceId: (...args: Parameters<LegacyRingAdapter['getCachedServiceId']>) => adapter.getCachedServiceId(...args),
    sendBytes: (...args: Parameters<LegacyRingAdapter['sendBytes']>) => runWithReady(() => adapter.sendBytes(...args)),
    waitForParsedData: (...args: Parameters<LegacyRingAdapter['waitForParsedData']>) => adapter.waitForParsedData(...args),
    sendBatteryCommand: () => runWithReady(() => adapter.sendBatteryCommand()),
    sendActiveMeasureCommand: () => runWithReady(() => adapter.sendActiveMeasureCommand()),
    sendOxyGenCommand: () => runWithReady(() => adapter.sendOxyGenCommand()),
    sendBodyTemperatureCommand: () => runWithReady(() => adapter.sendBodyTemperatureCommand()),
    sendFirmwareVersion: () => runWithReady(() => adapter.sendFirmwareVersion()),
    sendSoftwareVersion: () => runWithReady(() => adapter.sendSoftwareVersion()),
    readLocalData: (...args: Parameters<LegacyRingAdapter['readLocalData']>) => runWithReady(() => adapter.readLocalData(...args)),
    readDeviceTime: () => runWithReady(() => adapter.readDeviceTime()),
    updateDeviceTime: (...args: Parameters<LegacyRingAdapter['updateDeviceTime']>) =>
      runWithReady(() => adapter.updateDeviceTime(...args)),
    sendCollectPeriodSettingCommand: (...args: Parameters<LegacyRingAdapter['sendCollectPeriodSettingCommand']>) =>
      runWithReady(() => adapter.sendCollectPeriodSettingCommand(...args)),
    readCollectPeriodCommand: () => runWithReady(() => adapter.readCollectPeriodCommand()),
    sendResetCommand: () => runWithReady(() => adapter.sendResetCommand()),
    sendFactoryResetWithTimeCommand: () => runWithReady(() => adapter.sendFactoryResetWithTimeCommand()),
    sendDeleteAllLocalDataCommand: () => runWithReady(() => adapter.sendDeleteAllLocalDataCommand()),
    readRwHealthData: (name: CompatRwHealthDataName) => callRwAdapterMethod('readRwHealthData', normalizeRwHealthDataName(name)),
    deleteRwHealthData: (name: CompatRwHealthDataName) => callRwAdapterMethod('deleteRwHealthData', normalizeRwHealthDataName(name)),
    controlRwHealthData: (name: CompatRwHealthDataName, enabled = true) =>
      callRwAdapterMethod('controlRwHealthData', normalizeRwHealthDataName(name), enabled),
    readRwMonitoringConfig: (name: CompatRwHealthDataName) =>
      callRwAdapterMethod('readRwMonitoringConfig', normalizeRwHealthDataName(name) as RwMonitoringName),
    setRwMonitoringConfig: (name: CompatRwHealthDataName, config: RwHealthMonitoringConfig) =>
      callRwAdapterMethod('setRwMonitoringConfig', normalizeRwHealthDataName(name) as RwMonitoringName, config),
    setRwUserProfile: (profile: RwUserProfile) => callRwAdapterMethod('setRwUserProfile', profile),
    formatRwFileSystem: () => callRwAdapterMethod('formatRwFileSystem'),
    getTimedHeartRateJL: () => callRwAdapterMethod('getTimedHeartRateJL'),
    getTimedBloodOxygenJL: () => callRwAdapterMethod('getTimedBloodOxygenJL'),
    getTimedHRVJL: () => callRwAdapterMethod('getTimedHRVJL'),
    getTimedStressJL: () => callRwAdapterMethod('getTimedStressJL'),
    getTimedBloodSugarJL: () => callRwAdapterMethod('getTimedBloodSugarJL'),
    getTimedBloodPressureJL: () => callRwAdapterMethod('getTimedBloodPressureJL'),
    getTimedTemperatureJL: () => callRwAdapterMethod('getTimedTemperatureJL'),
    setTimedHeartRateJL: (config: RwHealthMonitoringConfig) => callRwAdapterMethod('setTimedHeartRateJL', config),
    setTimedBloodOxygenJL: (config: RwHealthMonitoringConfig) => callRwAdapterMethod('setTimedBloodOxygenJL', config),
    setTimedHRVJL: (config: RwHealthMonitoringConfig) => callRwAdapterMethod('setTimedHRVJL', config),
    setTimedStressJL: (config: RwHealthMonitoringConfig) => callRwAdapterMethod('setTimedStressJL', config),
    setTimedBloodSugarJL: (config: RwHealthMonitoringConfig) => callRwAdapterMethod('setTimedBloodSugarJL', config),
    setTimedBloodPressureJL: (config: RwHealthMonitoringConfig) => callRwAdapterMethod('setTimedBloodPressureJL', config),
    setTimedTemperatureJL: (config: RwHealthMonitoringConfig) => callRwAdapterMethod('setTimedTemperatureJL', config),
    controlHealthDataJL: (name: CompatRwHealthDataName, enabled = true) =>
      callRwAdapterMethod('controlHealthDataJL', normalizeRwHealthDataName(name), enabled),
    syncAllHealthData: () => syncRwHistoryAlias(),
    syncHealthDataByType: (name?: CompatRwHistoryDataName) => syncRwHistoryAlias(name)
  };
};
