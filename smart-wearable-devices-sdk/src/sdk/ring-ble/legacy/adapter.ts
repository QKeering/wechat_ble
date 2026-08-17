import type { RingBleAdapter, RingBleRuntime, RingBleState, RingDeviceInfo, RingParsedData } from '../types';
import type { RwHealthMonitoringConfig, RwUserProfile } from '../rw/protocol';
import { parseQkeerV2AdvertisInfo, parseRwAdvertisInfo, resolveRingProtocol } from '../protocolRegistry';
import { LegacyRingCommand } from './commands';
import { parseLegacyRingData } from './parser';
import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';
import {
  getLegacyBleHistoryExclusiveSnapshot,
  onLegacyBleCommandSessionIdle,
  releaseLegacyBleCommandSessions
} from './commandSession';
import {
  buildLegacyCommandByName,
  buildLegacyCommandBytes,
  concatBytes,
  createLegacyFrameId,
  getLegacyPlatformType,
  getTodayZeroTimestamp,
  type LegacyCommandPayload,
  numberToUint32LE,
  numberToUint64LE
} from './protocol';

export interface LegacyRingAdapter extends RingBleAdapter {
  initBluetooth: () => Promise<unknown>;
  openBluetoothAdapter: () => Promise<unknown>;
  registerConnectionStateListener: (options?: LegacyConnectionStateOptions) => void;
  checkBluetoothState: () => Promise<boolean>;
  startScan: (options?: LegacyScanOptions) => Promise<unknown>;
  stopScan: () => Promise<unknown>;
  setMTU: (deviceId: string, mtu?: number) => Promise<unknown>;
  connectDevice: (deviceId: string, deviceName?: string, sourceDevice?: RingDeviceInfo) => Promise<RingDeviceInfo>;
  connectAndDiscover: (deviceId: string, deviceName?: string, sourceDevice?: RingDeviceInfo) => Promise<RingDeviceInfo>;
  discoverServicesAndChars: (deviceId: string, deviceName?: string, sourceDevice?: RingDeviceInfo) => Promise<RingDeviceInfo>;
  enableNotify: (deviceId: string, serviceId: string, characteristicId: string) => Promise<unknown>;
  checkByRSSI: (deviceId: string) => Promise<boolean>;
  isDeviceConnected: (deviceId: string, serviceId: string) => Promise<boolean>;
  cacheServiceId: (mac: string, serviceId: string) => void;
  getCachedServiceId: (mac: string) => string;
  disconnect: (deviceId?: string) => Promise<unknown>;
  cleanup: () => Promise<void>;
  sendBytes: (bytes: Uint8Array, label?: string) => Promise<unknown>;
  sendCommand: (cmd: number, subcmd: number, payload?: LegacyCommandPayload) => Promise<unknown>;
  sendNamedCommand: (command: LegacyRingCommand, payload?: LegacyCommandPayload) => Promise<unknown>;
  waitForParsedData: (
    predicate: (parsed: RingParsedData) => boolean,
    timeoutMs?: number,
    options?: {
      replayRecent?: boolean;
      resetTimeoutOnData?: boolean;
      activityPredicate?: (parsed: RingParsedData) => boolean;
      activityTimeoutMs?: number;
    }
  ) => Promise<RingParsedData>;
  setupDataListener: (device?: RingDeviceInfo) => void;
  clearDataListener: (options?: LegacyDataListenerClearOptions) => void;
  sendBatteryCommand: () => Promise<unknown>;
  sendActiveMeasureCommand: () => Promise<unknown>;
  sendOxyGenCommand: () => Promise<unknown>;
  sendBodyTemperatureCommand: () => Promise<unknown>;
  sendFirmwareVersion: () => Promise<unknown>;
  sendSoftwareVersion: () => Promise<unknown>;
  sendReadLocalDataCommand: (sinceTimestamp?: number, readAll?: boolean) => Promise<unknown>;
  readLocalData: (options?: LegacyReadLocalDataOptions) => Promise<unknown>;
  readDeviceTime: () => Promise<unknown>;
  updateDeviceTime: (timestampMs?: number, timezone?: number) => Promise<unknown>;
  /** Legacy-only APP_CONNECT (0xA0/0x01) session handshake. */
  sendAppConnectCommand?: (options?: { timeoutMs?: number }) => Promise<unknown>;
  /** Establish the application session before issuing business commands. */
  establishAppConnectSession?: () => Promise<unknown>;
  sendCollectPeriodSettingCommand: (seconds?: number) => Promise<unknown>;
  readCollectPeriodCommand: () => Promise<unknown>;
  sendResetCommand: () => Promise<unknown>;
  sendFactoryResetWithTimeCommand: () => Promise<unknown>;
  sendDeleteAllLocalDataCommand: () => Promise<unknown>;
  readRwHealthData?: (name: RwHealthDataName) => Promise<unknown>;
  deleteRwHealthData?: (name: RwHealthDataName) => Promise<unknown>;
  controlRwHealthData?: (name: RwHealthDataName, enabled?: boolean) => Promise<unknown>;
  readRwMonitoringConfig?: (name: RwMonitoringName) => Promise<unknown>;
  setRwMonitoringConfig?: (name: RwMonitoringName, config: RwHealthMonitoringConfig) => Promise<unknown>;
  setRwUserProfile?: (profile: RwUserProfile) => Promise<unknown>;
  formatRwFileSystem?: () => Promise<unknown>;
  getTimedHeartRateJL?: () => Promise<unknown>;
  getTimedBloodOxygenJL?: () => Promise<unknown>;
  getTimedHRVJL?: () => Promise<unknown>;
  getTimedStressJL?: () => Promise<unknown>;
  getTimedBloodSugarJL?: () => Promise<unknown>;
  getTimedBloodPressureJL?: () => Promise<unknown>;
  getTimedTemperatureJL?: () => Promise<unknown>;
  setTimedHeartRateJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  setTimedBloodOxygenJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  setTimedHRVJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  setTimedStressJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  setTimedBloodSugarJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  setTimedBloodPressureJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  setTimedTemperatureJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  controlHealthDataJL?: (name: RwHealthDataName, enabled?: boolean) => Promise<unknown>;
  syncAllHealthData?: () => Promise<unknown>;
  syncHealthDataByType?: (name?: RwHistoryDataName) => Promise<unknown>;
}

export interface LegacyDataListenerClearOptions {
  reason?: string;
  caller?: string;
  sessionId?: string;
  deviceId?: string;
  force?: boolean;
}

type PendingLegacyDataListenerClear = LegacyDataListenerClearOptions & {
  listenerGeneration: number;
  listenerIdentityKey: string;
};

export type RwHealthDataName =
  | 'heart_rate'
  | 'heartRate'
  | 'heart-rate'
  | 'heartrate'
  | 'hr'
  | 'temperature'
  | 'bodyTemperature'
  | 'body-temperature'
  | 'bodyTemp'
  | 'body-temp'
  | 'skinTemperature'
  | 'skin-temperature'
  | 'skinTemp'
  | 'skin-temp'
  | 'blood_oxygen'
  | 'bloodOxygen'
  | 'blood-oxygen'
  | 'oxygen'
  | 'spo2'
  | 'spO2'
  | 'SpO2'
  | 'SPO2'
  | 'blood_sugar'
  | 'bloodSugar'
  | 'blood-sugar'
  | 'glucose'
  | 'hrv'
  | 'stress'
  | 'blood_pressure'
  | 'bloodPressure'
  | 'blood-pressure'
  | 'bp';
export type RwHistoryDataName =
  | RwHealthDataName
  | 'summary'
  | 'lastData'
  | 'last-data'
  | 'lastSnapshot'
  | 'last-snapshot'
  | 'snapshot'
  | 'vital'
  | 'vitals'
  | 'vitalSigns'
  | 'vital-signs'
  | 'sleep'
  | 'sleepData'
  | 'sleep-data'
  | 'sleepDetail'
  | 'sleep-detail'
  | 'sleepDetails'
  | 'sleep-details'
  | 'step'
  | 'steps'
  | 'stepCount'
  | 'step-count'
  | 'sport'
  | 'activity'
  | 'dailyActivity'
  | 'daily-activity'
  | 'dailyHealth'
  | 'daily-health';
export type RwMonitoringName = RwHealthDataName;

export interface LegacyScanOptions {
  prefixes?: string[];
  timeoutMs?: number;
  allowDuplicatesKey?: boolean;
  includeUnknown?: boolean;
  preserveDevices?: boolean;
  diagnosticBoundMac?: string;
  diagnosticSessionId?: string;
  diagnosticLogAllDevices?: boolean;
}

export interface LegacyConnectionStateOptions {
  onConnected?: (deviceId: string) => void;
  onDisconnected?: (deviceId: string) => void;
}

export interface LegacyReadLocalDataOptions {
  readAll?: boolean;
  sinceTimestamp?: number;
  time?: 'day' | string;
  dataType?: string;
  dataTypes?: string[];
}

const DEFAULT_SCAN_PREFIXES = ['HR', 'IF', 'QK', 'QKeeRing', 'PPlus'];
const LEGACY_PRIMARY_SERVICE_UUID = 'BAE80001-4F05-4503-8E65-3AF1F7329D1F';
const LEGACY_SERVICE_MARKERS = ['BAE8', '4F05-4503-8E65-3AF1F7329D1F'];
const SERVICE_CACHE_KEY = 'deviceServiceCache';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isAlreadyConnectedError = (error: unknown) => {
  const record = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  const message = `${record.errMsg || record.message || error || ''}`.toLowerCase();
  return message.includes('already connect') || message.includes('already connected');
};

type BluetoothDeviceFoundCallback = Parameters<typeof uni.onBluetoothDeviceFound>[0];
type BleConnectionStateCallback = Parameters<typeof uni.onBLEConnectionStateChange>[0];
type BleCharacteristicValueCallback = Parameters<typeof uni.onBLECharacteristicValueChange>[0];
type BluetoothAdapterStateCallback = (result: { available?: boolean; discovering?: boolean }) => void;

const offBluetoothDeviceFound = (callback: BluetoothDeviceFoundCallback) => {
  (uni.offBluetoothDeviceFound as unknown as (callback: BluetoothDeviceFoundCallback) => void)(callback);
};

const offBleConnectionStateChange = (callback: BleConnectionStateCallback) => {
  (uni.offBLEConnectionStateChange as unknown as (callback?: BleConnectionStateCallback) => void)(callback);
};

const offBleCharacteristicValueChange = (callback: BleCharacteristicValueCallback) => {
  (uni.offBLECharacteristicValueChange as unknown as (callback?: BleCharacteristicValueCallback) => void)(callback);
};

const offBluetoothAdapterStateChange = (callback: BluetoothAdapterStateCallback) => {
  (uni.offBluetoothAdapterStateChange as unknown as ((callback?: BluetoothAdapterStateCallback) => void) | undefined)?.(callback);
};

const ensureWriteDevice = (runtime: RingBleRuntime) => {
  const deviceInfo = runtime.getDeviceInfo();
  const { deviceId, serviceId, cmdCharId } = deviceInfo;

  if (!deviceId || !serviceId || !cmdCharId) {
    throw new Error('Ring BLE device is not ready for command writes.');
  }

  return { deviceId, serviceId, cmdCharId };
};

const isTargetDevice = (name: string | undefined, prefixes: string[]) => {
  if (!name) return false;
  const normalizedName = `${name}`.trim().toUpperCase();
  return prefixes.some((prefix) => normalizedName.startsWith(`${prefix}`.trim().toUpperCase()));
};

const getMacFromAdvertisData = (buffer?: ArrayBuffer) => {
  if (!buffer || buffer.byteLength < 6) return '';

  const hexArr = Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, '0').toUpperCase());
  return hexArr.slice(-6).reverse().join(':');
};

const getAdvertisHex = (value?: ArrayBuffer | string | number[]) => {
  if (!value) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, '').toUpperCase();
  if (Array.isArray(value)) {
    return value.map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
};

const formatLegacyFrameByte = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return `0x${(value & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;
};

const getLegacyBytesHex = (bytes: Uint8Array | ArrayBuffer | number[]) => {
  if (bytes instanceof Uint8Array) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return getAdvertisHex(bytes);
};

const summarizeLegacyBleFrame = (bytes: Uint8Array, label?: string) => {
  const payload = bytes.length > 4 ? bytes.slice(4) : new Uint8Array();
  return {
    label: label || '',
    length: bytes.length,
    frameType: formatLegacyFrameByte(bytes[0]),
    frameTypeValue: bytes[0],
    frameId: formatLegacyFrameByte(bytes[1]),
    frameIdValue: bytes[1],
    cmd: formatLegacyFrameByte(bytes[2]),
    cmdValue: bytes[2],
    subcmd: formatLegacyFrameByte(bytes[3]),
    subcmdValue: bytes[3],
    payloadHex: getLegacyBytesHex(payload),
    rawHex: getLegacyBytesHex(bytes)
  };
};

const formatLegacyBleError = (error: unknown) => {
  if (!error) return '';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const SCAN_DEVICE_RECORD_LOG_THROTTLE_MS = 5000;
const scanDeviceRecordLogTimes = new Map<string, number>();

const sanitizeScanLogValue = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') return undefined;
  if (value instanceof ArrayBuffer) {
    return {
      byteLength: value.byteLength,
      hex: getAdvertisHex(value)
    };
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const bytes = Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return {
      byteLength: view.byteLength,
      hex: getAdvertisHex(bytes)
    };
  }
  if (Array.isArray(value)) {
    if (depth >= 2) return `[array:${value.length}]`;
    return value.slice(0, 80).map((item) => sanitizeScanLogValue(item, depth + 1, seen));
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (depth >= 2) return '[object]';
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 80)
        .map(([key, item]) => [key, sanitizeScanLogValue(item, depth + 1, seen)])
        .filter(([, item]) => typeof item !== 'undefined')
    );
  }
  return String(value);
};

const appendScanDeviceRecordLog = (
  rawDevice: unknown,
  matchedDevice: RingDeviceInfo,
  parsedMac: string,
  advertisHex: string,
  matchedKeys: string[]
) => {
  const logKey = `${matchedDevice.deviceId || ''}|${parsedMac || matchedDevice.uniMacId || ''}|${matchedDevice.mac || ''}|${advertisHex}`;
  const now = Date.now();
  const lastLoggedAt = scanDeviceRecordLogTimes.get(logKey) || 0;
  if (now - lastLoggedAt < SCAN_DEVICE_RECORD_LOG_THROTTLE_MS) return;
  scanDeviceRecordLogTimes.set(logKey, now);

  appendRingDiagnosticLog('BLE SCAN', 'scan-device-record', {
    deviceId: matchedDevice.deviceId || '',
    name: matchedDevice.name || '',
    localName: matchedDevice.localName || '',
    displayName: matchedDevice.displayName || '',
    protocol: matchedDevice.protocol || '',
    parsedMac,
    uniMacId: matchedDevice.uniMacId || '',
    mac: matchedDevice.mac || '',
    advertisMacInfo: matchedDevice.advertis?.macInfo || '',
    advertisHex,
    advertisDataByteLength:
      matchedDevice.advertisData instanceof ArrayBuffer
        ? matchedDevice.advertisData.byteLength
        : Array.isArray(matchedDevice.advertisData)
          ? matchedDevice.advertisData.length
          : typeof matchedDevice.advertisData === 'string'
            ? Math.floor(matchedDevice.advertisData.replace(/\s+/g, '').length / 2)
            : 0,
    advertis: sanitizeScanLogValue(matchedDevice.advertis),
    matchedKeys,
    rawDevice: sanitizeScanLogValue(rawDevice)
  });
};

type RawScanDiagnosticContext = {
  boundMac: string;
  sessionId: string;
  startedAt: number;
};

export const getScannedDeviceMergeKeys = (device: RingDeviceInfo) => {
  const name = `${device.displayName || device.name || device.localName || device.bleName || ''}`.trim().toUpperCase();
  const protocol = resolveRingProtocol(device);
  const advertisHex = getAdvertisHex(device.advertisData);
  const advertisTail = advertisHex.slice(-24);
  const serviceIds = [
    device.serviceId,
    ...(Array.isArray(device.advertisServiceUUIDs) ? device.advertisServiceUUIDs : []),
    ...(Array.isArray(device.advertisServiceUUIDsList) ? device.advertisServiceUUIDsList : [])
  ]
    .filter(Boolean)
    .map((value) => `${value}`.toUpperCase())
    .join('|');

  return [
    device.deviceId ? `device:${device.deviceId}` : '',
    device.uniMacId ? `mac:${device.uniMacId}` : '',
    device.mac ? `mac:${device.mac}` : '',
    device.advertis?.macInfo ? `mac:${device.advertis.macInfo}` : '',
    advertisTail ? `adv:${protocol}:${advertisTail}` : '',
    name && advertisTail ? `name-adv:${protocol}:${name}:${advertisTail}` : '',
    !device.deviceId && name && serviceIds ? `name-service:${protocol}:${name}:${serviceIds}` : ''
  ].filter(Boolean);
};

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, message: string) => {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))]);
};

const LEGACY_COMMAND_WRITE_TIMEOUT_MS = 2500;

export const createLegacyRingAdapter = (state: RingBleState, runtime?: RingBleRuntime): LegacyRingAdapter => {
  let scanTimeout: ReturnType<typeof setTimeout> | null = null;
  let scanPollTimer: ReturnType<typeof setInterval> | null = null;
  let scanPrefixes = DEFAULT_SCAN_PREFIXES;
  let includeUnknownScanDevices = false;
  let rawScanDiagnostic: RawScanDiagnosticContext | null = null;
  const rawScanDiagnosticLoggedKeys = new Set<string>();
  const rawScanDiagnosticDevices = new Map<string, Record<string, unknown>>();
  const parsedWaiters: Array<{
    predicate: (parsed: RingParsedData) => boolean;
    resolve: (parsed: RingParsedData) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    resetTimeoutOnData: boolean;
    activityPredicate?: (parsed: RingParsedData) => boolean;
    activityTimeoutMs: number;
    resetTimer: (nextTimeoutMs?: number) => void;
  }> = [];
  const rawFrameWaiters: Array<{
    predicate: (bytes: Uint8Array) => boolean;
    resolve: (bytes: Uint8Array) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  let legacyCommandWriteQueue: Promise<unknown> = Promise.resolve();
  let legacyCommandWriteQueueSeq = 0;
  let legacyCommandWriteQueueGeneration = 0;
  let legacyLastCommandWriteAt = 0;
  let lastAppConnectAt = 0;
  let appConnectReadyGeneration = -1;
  let appConnectInFlight: Promise<unknown> | null = null;
  let appConnectInFlightGeneration = -1;
  let legacyPhysicalConnectedAt = 0;
  let establishAppConnectSession: () => Promise<unknown> = async () => undefined;
  let connectionStateHandler: BleConnectionStateCallback | null = null;
  let bluetoothAdapterStateHandler: BluetoothAdapterStateCallback | null = null;
  let dataListenerHandler: BleCharacteristicValueCallback | null = null;
  let dataListenerIdentityKey = '';
  let dataListenerDeviceId = '';
  let dataListenerServiceId = '';
  let dataListenerDataCharId = '';
  let dataListenerDeviceName = '';
  let dataListenerGeneration = 0;
  let pendingDataListenerClear: PendingLegacyDataListenerClear | null = null;
  let historyWireTrace: {
    startedAt: number;
    sinceTimestamp: number;
    readAll: boolean;
    subcmd: number;
    payloadHex: string;
    notifyCount: number;
    firstPacketAt: number;
    lastPacketAt: number;
    maxPacketGapMs: number;
    totalRecordCount: number;
  } | null = null;

  const finalizeHistoryWireTrace = (reason: string, details: Record<string, unknown> = {}) => {
    const trace = historyWireTrace;
    if (!trace) return;
    const now = Date.now();
    appendRingDiagnosticLog('L19 BLE', 'legacy-history-wire-summary', {
      reason,
      elapsedMs: now - trace.startedAt,
      firstPacketDelayMs: trace.firstPacketAt ? trace.firstPacketAt - trace.startedAt : null,
      lastPacketElapsedMs: trace.lastPacketAt ? trace.lastPacketAt - trace.startedAt : null,
      notifyCount: trace.notifyCount,
      totalRecordCount: trace.totalRecordCount,
      maxPacketGapMs: trace.maxPacketGapMs,
      historyCmd: '0x36',
      historySubcmd: formatLegacyFrameByte(trace.subcmd),
      sinceTimestamp: trace.sinceTimestamp,
      readAll: trace.readAll,
      requestPayloadHex: trace.payloadHex,
      ...details
    });
    historyWireTrace = null;
  };

  const resetLegacyCommandWriteQueue = (reason: string, deviceId = '') => {
    finalizeHistoryWireTrace(`command-queue-reset:${reason}`, { deviceId });
    legacyCommandWriteQueueGeneration += 1;
    legacyCommandWriteQueue = Promise.resolve();
    legacyLastCommandWriteAt = 0;
    appendRingDiagnosticLog('L19 BLE', 'legacy-command-write-queue-reset', {
      reason,
      deviceId: deviceId || runtime?.getDeviceInfo?.().deviceId,
      generation: legacyCommandWriteQueueGeneration
    });
  };

  // The command-session lease can expire while a large history response is still
  // arriving.  Treat the actual wire read as authoritative as well, otherwise a
  // page cleanup/recovery path may close the connection in the middle of history
  // transfer (the B7 long-session failure).  The age cap prevents a lost terminal
  // packet from protecting a dead connection forever.
  const getActiveHistoryReadGuard = () => {
    const session = getLegacyBleHistoryExclusiveSnapshot(
      runtime?.getDeviceInfo?.() || dataListenerDeviceId
    );
    const wireElapsedMs = historyWireTrace ? Date.now() - historyWireTrace.startedAt : 0;
    const wireActive = Boolean(historyWireTrace && wireElapsedMs <= 120000);
    return {
      ...session,
      active: session.active || wireActive,
      sessionId: session.sessionId || (wireActive ? `wire-${historyWireTrace?.startedAt}` : ''),
      wireActive,
      wireElapsedMs
    };
  };

  const appendHistoryWireNotifyLog = (
    event: string,
    result: any,
    notifyFrame: ReturnType<typeof summarizeLegacyBleFrame>,
    parsed?: RingParsedData | null
  ) => {
    const trace = historyWireTrace;
    if (!trace) return;

    const now = Date.now();
    const elapsedMs = now - trace.startedAt;
    const previousPacketAt = trace.lastPacketAt;
    if (!trace.firstPacketAt) trace.firstPacketAt = now;
    if (previousPacketAt) trace.maxPacketGapMs = Math.max(trace.maxPacketGapMs, now - previousPacketAt);
    trace.lastPacketAt = now;
    trace.notifyCount += 1;
    const parsedRecordCount = Array.isArray((parsed as any)?.records) ? (parsed as any).records.length : undefined;
    const parsedDataCount = Array.isArray((parsed as any)?.data) ? (parsed as any).data.length : undefined;
    trace.totalRecordCount += parsedRecordCount ?? parsedDataCount ?? 0;
    const parsedStatus = (parsed as any)?.status;
    if (trace.notifyCount === 1) {
      appendRingDiagnosticLog('L19 BLE', 'legacy-history-wire-first-packet', {
        firstPacketDelayMs: trace.firstPacketAt - trace.startedAt,
        historySubcmd: formatLegacyFrameByte(trace.subcmd),
        sinceTimestamp: trace.sinceTimestamp,
        ...notifyFrame,
        parsedType: parsed?.type,
        status: parsedStatus,
        recordCount: parsedRecordCount,
        dataCount: parsedDataCount
      });
    }
    // Normal frames are deliberately not logged one by one. The first-packet
    // event above plus the terminal summary retain enough timing evidence to
    // distinguish device latency, packet gaps and post-processing latency.
    const shouldLog = parsedStatus === 'complete' || parsedStatus === 'empty' || !parsed;

    if (!shouldLog) return;

    appendRingDiagnosticLog('L19 BLE', event, {
      elapsedMs,
      notifyCount: trace.notifyCount,
      historyCmd: '0x36',
      historySubcmd: formatLegacyFrameByte(trace.subcmd),
      sinceTimestamp: trace.sinceTimestamp,
      readAll: trace.readAll,
      requestPayloadHex: trace.payloadHex,
      deviceId: result?.deviceId,
      serviceId: result?.serviceId,
      characteristicId: result?.characteristicId,
      ...notifyFrame,
      parsedType: parsed?.type,
      status: parsedStatus,
      recordCount: parsedRecordCount,
      dataCount: parsedDataCount
    });

    if (parsedStatus === 'complete' || parsedStatus === 'empty') {
      finalizeHistoryWireTrace('terminal-frame', {
        terminalStatus: parsedStatus,
        terminalFrame: notifyFrame,
        terminalRecordCount: parsedRecordCount,
        terminalDataCount: parsedDataCount
      });
    }
  };

  const openBluetoothAdapter = () => {
    return new Promise<unknown>((resolve, reject) => {
      uni.openBluetoothAdapter({
        success: resolve,
        fail: reject
      });
    });
  };

  const clearConnectionStateListener = () => {
    if (!connectionStateHandler) return;
    offBleConnectionStateChange(connectionStateHandler);
    connectionStateHandler = null;
  };

  const clearBluetoothAdapterStateListener = () => {
    if (!bluetoothAdapterStateHandler) return;
    offBluetoothAdapterStateChange(bluetoothAdapterStateHandler);
    bluetoothAdapterStateHandler = null;
  };

  const registerConnectionStateListener = (options: LegacyConnectionStateOptions = {}) => {
    clearConnectionStateListener();
    connectionStateHandler = (result) => {
      const eventDeviceId = `${result?.deviceId || ''}`;
      const currentDeviceId = runtime?.getDeviceInfo?.().deviceId;
      if (currentDeviceId && eventDeviceId && eventDeviceId !== currentDeviceId) {
        appendRingDiagnosticLog(
          'L19 BLE',
          result.connected ? 'connection-state-ignore-non-target-connected' : 'connection-state-ignore-non-target-disconnected',
          {
            currentDeviceId,
            eventDeviceId,
            connected: Boolean(result.connected)
          }
        );
        return;
      }

      if (result.connected) {
        legacyPhysicalConnectedAt = Date.now();
        lastAppConnectAt = 0;
        options.onConnected?.(eventDeviceId || result.deviceId);
        return;
      }

      legacyPhysicalConnectedAt = 0;
      lastAppConnectAt = 0;
      releaseLegacyBleCommandSessions(runtime?.getDeviceInfo?.() || eventDeviceId, 'physical-disconnect');
      resetLegacyCommandWriteQueue('physical-disconnect', eventDeviceId);

      clearDataListener({
        reason: 'physical-disconnect',
        caller: 'connection-state-listener',
        deviceId: eventDeviceId
      });
      options.onDisconnected?.(eventDeviceId || result.deviceId);
      runtime?.onDisconnected?.(result);
    };
    uni.onBLEConnectionStateChange(connectionStateHandler);

    clearBluetoothAdapterStateListener();
    bluetoothAdapterStateHandler = (result) => {
      runtime?.onBluetoothReadyChange?.(Boolean(result.available));
      if (result.available) return;

      void stopScan();
      releaseLegacyBleCommandSessions(runtime?.getDeviceInfo?.(), 'bluetooth-adapter-unavailable');
      resetLegacyCommandWriteQueue('bluetooth-adapter-unavailable');
      clearDataListener({
        reason: 'bluetooth-adapter-unavailable',
        caller: 'bluetooth-adapter-state-listener',
        force: true
      });
      runtime?.onDisconnected?.({
        reason: 'bluetooth_adapter_unavailable',
        available: false,
        discovering: result.discovering
      });
    };
    uni.onBluetoothAdapterStateChange?.(bluetoothAdapterStateHandler);
  };

  const initBluetooth = async () => {
    const result = await openBluetoothAdapter();
    registerConnectionStateListener();
    return result;
  };

  const checkBluetoothState = () => {
    return new Promise<boolean>((resolve) => {
      uni.getBluetoothAdapterState({
        success: (stateResult) => resolve(Boolean(stateResult.available)),
        fail: () => resolve(false)
      });
    });
  };

  const appendRawScanDiagnosticLogs = (devices: any[], source: string) => {
    const diagnostic = rawScanDiagnostic;
    if (!diagnostic || !Array.isArray(devices)) return;

    devices.forEach((device: any) => {
      const advertisHex = getAdvertisHex(device?.advertisData);
      const parsedMac = getMacFromAdvertisData(device?.advertisData);
      const deviceId = `${device?.deviceId || ''}`;
      const name = `${device?.name || ''}`;
      const localName = `${device?.localName || ''}`;
      const recordKey = [diagnostic.sessionId, deviceId, advertisHex, name, localName].join('|');
      if (rawScanDiagnosticLoggedKeys.has(recordKey)) return;

      rawScanDiagnosticLoggedKeys.add(recordKey);
      const record = {
        boundMac: diagnostic.boundMac,
        sessionId: diagnostic.sessionId,
        source,
        deviceId,
        name,
        localName,
        RSSI: device?.RSSI,
        protocol: resolveRingProtocol(device),
        parsedMac,
        mac: device?.mac || '',
        uniMacId: device?.uniMacId || '',
        advertisHex,
        advertisDataByteLength:
          device?.advertisData instanceof ArrayBuffer
            ? device.advertisData.byteLength
            : Array.isArray(device?.advertisData)
              ? device.advertisData.length
              : typeof device?.advertisData === 'string'
                ? Math.floor(device.advertisData.replace(/\s+/g, '').length / 2)
                : 0,
        advertisServiceUUIDs: sanitizeScanLogValue(device?.advertisServiceUUIDs),
        advertisServiceUUIDsList: sanitizeScanLogValue(device?.advertisServiceUUIDsList),
        serviceData: sanitizeScanLogValue(device?.serviceData),
        rawDevice: sanitizeScanLogValue(device)
      };

      rawScanDiagnosticDevices.set(recordKey, record);
      appendRingDiagnosticLog('BLE SCAN', 'scan-device-raw-record', record);
    });
  };

  const finishRawScanDiagnostic = (reason: string) => {
    if (!rawScanDiagnostic) return;

    appendRingDiagnosticLog('BLE SCAN', 'scan-device-raw-summary', {
      boundMac: rawScanDiagnostic.boundMac,
      sessionId: rawScanDiagnostic.sessionId,
      reason,
      elapsedMs: Date.now() - rawScanDiagnostic.startedAt,
      rawDeviceCount: rawScanDiagnosticDevices.size,
      devices: Array.from(rawScanDiagnosticDevices.values()).slice(0, 80)
    });
    rawScanDiagnostic = null;
    rawScanDiagnosticLoggedKeys.clear();
    rawScanDiagnosticDevices.clear();
  };

  const mergeScannedDevices = (devices: any[], source = 'unknown') => {
    if (!state.isScanning.value || !Array.isArray(devices)) return;
    appendRawScanDiagnosticLogs(devices, source);
    const platform = uni.getSystemInfoSync().platform?.toLowerCase?.() || '';

    devices.forEach((device: any) => {
      const name = device.name || device.localName;
      const protocol = resolveRingProtocol(device);
      if (!includeUnknownScanDevices && protocol === 'legacy' && !isTargetDevice(name, scanPrefixes)) return;

      const parsedMac = getMacFromAdvertisData(device.advertisData);
      const uniMacId = parsedMac || (platform.includes('ios') ? device.uniMacId : undefined);
      const advertis =
        protocol === 'qkeer-v2'
          ? device.advertis || parseQkeerV2AdvertisInfo(device) || undefined
          : protocol === 'rw'
            ? device.advertis || parseRwAdvertisInfo(device) || undefined
            : device.advertis;
      const matchedDevice = {
        ...device,
        displayName: name,
        protocol,
        advertis,
        uniMacId,
        mac: parsedMac || advertis?.macInfo || device.mac,
        lastSeenAt: Date.now()
      };
      const matchedKeys = getScannedDeviceMergeKeys(matchedDevice);
      appendScanDeviceRecordLog(device, matchedDevice, parsedMac, getAdvertisHex(device.advertisData), matchedKeys);
      const existingIndex = state.devices.value.findIndex((item) => {
        const itemKeys = getScannedDeviceMergeKeys(item);
        return itemKeys.some((key) => matchedKeys.includes(key));
      });

      if (existingIndex >= 0) {
        const previous = state.devices.value[existingIndex];
        state.devices.value.splice(existingIndex, 1, {
          ...previous,
          ...matchedDevice,
          displayName: matchedDevice.displayName || previous.displayName,
          name: matchedDevice.name || previous.name,
          localName: matchedDevice.localName || previous.localName,
          protocol: matchedDevice.protocol === 'legacy' ? previous.protocol || matchedDevice.protocol : matchedDevice.protocol,
          uniMacId: matchedDevice.uniMacId || previous.uniMacId
        });
        return;
      }

      state.devices.value.push(matchedDevice);
    });
  };

  const handleDeviceFound = (result: any) => {
    mergeScannedDevices(result?.devices, 'onBluetoothDeviceFound');
  };

  const stopScan = () => {
    return new Promise<unknown>((resolve) => {
      if (scanTimeout) {
        clearTimeout(scanTimeout);
        scanTimeout = null;
      }
      if (scanPollTimer) {
        clearInterval(scanPollTimer);
        scanPollTimer = null;
      }

      offBluetoothDeviceFound(handleDeviceFound);

      if (!state.isScanning.value) {
        finishRawScanDiagnostic('already-stopped');
        resolve(undefined);
        return;
      }

      uni.stopBluetoothDevicesDiscovery({
        success: (result) => {
          state.isScanning.value = false;
          finishRawScanDiagnostic('stop-success');
          resolve(result);
        },
        fail: (error) => {
          state.isScanning.value = false;
          finishRawScanDiagnostic('stop-fail');
          resolve(error);
        }
      });
    });
  };

  const startScan = (options: LegacyScanOptions = {}) => {
    if (state.isScanning.value) return Promise.resolve(undefined);

    scanPrefixes = options.prefixes?.length ? options.prefixes : DEFAULT_SCAN_PREFIXES;
    includeUnknownScanDevices = Boolean(options.includeUnknown);
    rawScanDiagnostic = options.diagnosticLogAllDevices || options.diagnosticBoundMac
      ? {
          boundMac: options.diagnosticBoundMac || '',
          sessionId: options.diagnosticSessionId || `scan-${Date.now()}`,
          startedAt: Date.now()
        }
      : null;
    rawScanDiagnosticLoggedKeys.clear();
    rawScanDiagnosticDevices.clear();
    if (rawScanDiagnostic) {
      appendRingDiagnosticLog('BLE SCAN', 'scan-device-raw-start', {
        boundMac: rawScanDiagnostic.boundMac,
        sessionId: rawScanDiagnostic.sessionId,
        prefixes: scanPrefixes,
        includeUnknown: includeUnknownScanDevices,
        timeoutMs: options.timeoutMs ?? 20000
      });
    }
    if (!options.preserveDevices) state.devices.value = [];
    state.isScanning.value = true;
    offBluetoothDeviceFound(handleDeviceFound);
    if (scanPollTimer) {
      clearInterval(scanPollTimer);
      scanPollTimer = null;
    }

    scanTimeout = setTimeout(() => {
      void stopScan();
    }, options.timeoutMs ?? 20000);

    return new Promise<unknown>((resolve, reject) => {
      uni.startBluetoothDevicesDiscovery({
        allowDuplicatesKey: options.allowDuplicatesKey ?? true,
        success: (result) => {
          uni.onBluetoothDeviceFound(handleDeviceFound);
          scanPollTimer = setInterval(() => {
            uni.getBluetoothDevices({
              success: (devicesResult) => mergeScannedDevices(devicesResult.devices, 'getBluetoothDevices'),
              fail: () => undefined
            });
          }, 1500);
          resolve(result);
        },
        fail: (error) => {
          state.isScanning.value = false;
          finishRawScanDiagnostic('start-fail');
          offBluetoothDeviceFound(handleDeviceFound);
          if (scanTimeout) {
            clearTimeout(scanTimeout);
            scanTimeout = null;
          }
          if (scanPollTimer) {
            clearInterval(scanPollTimer);
            scanPollTimer = null;
          }
          reject(error);
        }
      });
    });
  };

  const setMTU = (deviceId: string, mtu = 247) => {
    if (uni.getSystemInfoSync().platform !== 'android') return Promise.resolve(undefined);

    return new Promise<unknown>((resolve) => {
      uni.setBLEMTU({
        deviceId,
        mtu,
        success: resolve,
        fail: (error) => resolve({ ignoredMtuError: error })
      });
    });
  };

  const getConnectedLegacyDeviceIds = () => {
    return new Promise<string[]>((resolve) => {
      uni.getConnectedBluetoothDevices({
        services: [LEGACY_PRIMARY_SERVICE_UUID],
        success: (result) => {
          resolve((result.devices || []).map((device) => device.deviceId).filter(Boolean));
        },
        fail: () => resolve([])
      });
    });
  };

  const closeBleConnectionQuietly = (deviceId: string) => {
    if (!deviceId) return Promise.resolve(undefined);
    return new Promise<unknown>((resolve) => {
      uni.closeBLEConnection({
        deviceId,
        success: resolve,
        fail: resolve
      });
    });
  };

  const createBleConnectionOnce = (deviceId: string, deviceName = '') => {
    return new Promise<RingDeviceInfo>((resolve, reject) => {
      uni.createBLEConnection({
        deviceId,
        timeout: 10000,
        success: () => {
          legacyPhysicalConnectedAt = Date.now();
          lastAppConnectAt = 0;
          const delay = /ios/i.test(uni.getSystemInfoSync().system || '') ? 1000 : 1500;
          setTimeout(() => resolve({ deviceId, name: deviceName, protocol: 'legacy' }), delay);
        },
        fail: reject
      });
    });
  };

  const connectDevice = async (deviceId: string, deviceName = '', sourceDevice?: RingDeviceInfo) => {
    try {
      return { ...sourceDevice, ...(await createBleConnectionOnce(deviceId, deviceName)) };
    } catch (error) {
      if (!isAlreadyConnectedError(error)) throw error;

      const connectedDeviceIds = await getConnectedLegacyDeviceIds();
      if (connectedDeviceIds.includes(deviceId)) {
        return { ...sourceDevice, deviceId, name: deviceName, protocol: 'legacy' as const };
      }

      appendRingDiagnosticLog('L19 BLE', 'already-connected-target-retry-without-closing-others', {
        deviceId,
        connectedDeviceIds
      });
      await closeBleConnectionQuietly(deviceId);
      await sleep(350);
      return { ...sourceDevice, ...(await createBleConnectionOnce(deviceId, deviceName)) };
    }
  };

  const connectAndDiscover = async (deviceId: string, deviceName = '', sourceDevice?: RingDeviceInfo) => {
    await connectDevice(deviceId, deviceName, sourceDevice);
    await setMTU(deviceId);
    return discoverServicesAndChars(deviceId, deviceName, sourceDevice);
  };

  const enableNotify = (deviceId: string, serviceId: string, characteristicId: string) => {
    return new Promise<unknown>((resolve, reject) => {
      uni.notifyBLECharacteristicValueChange({
        deviceId,
        serviceId,
        characteristicId,
        state: true,
        success: resolve,
        fail: reject
      });
    });
  };

  const cacheServiceId = (mac: string, serviceId: string) => {
    if (!mac || !serviceId) return;

    const cache = uni.getStorageSync(SERVICE_CACHE_KEY) || {};
    cache[mac] = serviceId;
    uni.setStorageSync(SERVICE_CACHE_KEY, cache);
  };

  const getCachedServiceId = (mac: string) => {
    const cache = uni.getStorageSync(SERVICE_CACHE_KEY) || {};
    return cache[mac] || '';
  };

  const discoverServicesAndChars = async (deviceId: string, deviceName = '', sourceDevice?: RingDeviceInfo) => {
    const serviceResult: any = await withTimeout(
      new Promise((resolve, reject) => uni.getBLEDeviceServices({ deviceId, success: resolve, fail: reject })),
      10000,
      'Get BLE services timeout.'
    );

    if (!Array.isArray(serviceResult.services)) {
      throw new Error('BLE services are unavailable.');
    }

    const service = serviceResult.services.find((item: any) => {
      const uuid = `${item.uuid || ''}`.toUpperCase();
      return LEGACY_SERVICE_MARKERS.every((marker) => uuid.includes(marker));
    });

    if (!service?.uuid) {
      throw new Error('Legacy ring service was not found.');
    }

    const serviceId = service.uuid;
    const characteristicResult: any = await new Promise((resolve, reject) => {
      uni.getBLEDeviceCharacteristics({
        deviceId,
        serviceId,
        success: resolve,
        fail: reject
      });
    });

    if (!Array.isArray(characteristicResult.characteristics)) {
      throw new Error('BLE characteristics are unavailable.');
    }

    let cmdCharId = '';
    let dataCharId = '';

    for (const characteristic of characteristicResult.characteristics) {
      if (!cmdCharId && (characteristic.properties?.write || characteristic.properties?.writeWithoutResponse)) {
        cmdCharId = characteristic.uuid;
      }

      if (!dataCharId && characteristic.properties?.notify) {
        dataCharId = characteristic.uuid;
      }

      if (cmdCharId && dataCharId) break;
    }

    if (!cmdCharId) throw new Error('Writable command characteristic was not found.');
    if (!dataCharId) throw new Error('Notify data characteristic was not found.');

    await enableNotify(deviceId, serviceId, dataCharId);

    const deviceInfo = {
      ...(sourceDevice || {}),
      deviceId,
      name: deviceName,
      serviceId,
      cmdCharId,
      dataCharId,
      protocol: 'legacy' as const
    };

    runtime?.onDeviceReady?.(deviceInfo);
    cacheServiceId(deviceId, serviceId);
    setupDataListener(deviceInfo);

    // APP_CONNECT is the common legacy session gate. Some reconnect paths call
    // discoverServicesAndChars directly, so keeping it only in connectAndDiscover
    // leaves those paths physically connected but without a protocol session.
    await establishAppConnectSession();

    return deviceInfo;
  };

  const checkByRSSI = (deviceId: string) => {
    return new Promise<boolean>((resolve) => {
      uni.getBLEDeviceRSSI({
        deviceId,
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    });
  };

  const isDeviceConnected = (deviceId: string, serviceId: string) => {
    return new Promise<boolean>((resolve) => {
      uni.getConnectedBluetoothDevices({
        services: [serviceId],
        success: (result) => {
          const connected = result.devices.some((device) => device.deviceId === deviceId);
          if (connected) {
            resolve(true);
            return;
          }

          void checkByRSSI(deviceId).then(resolve);
        },
        fail: () => resolve(false)
      });
    });
  };

  const disconnect = (targetDeviceId?: string) => {
    const deviceId = targetDeviceId || runtime?.getDeviceInfo().deviceId;
    const session = getActiveHistoryReadGuard();
    if (session.active) {
      pendingDataListenerClear = {
        reason: 'disconnect-deferred',
        caller: 'disconnect',
        sessionId: session.sessionId,
        deviceId,
        listenerGeneration: dataListenerGeneration,
        listenerIdentityKey: dataListenerIdentityKey
      };
      appendRingDiagnosticLog('L19 BLE', 'legacy-disconnect-deferred-history-active', {
        deviceId,
        sessionId: session.sessionId,
        remainingMs: session.remainingMs,
        wireActive: session.wireActive,
        wireElapsedMs: session.wireElapsedMs
      });
      return Promise.resolve({ deferred: true, reason: 'history-active', sessionId: session.sessionId });
    }
    clearDataListener({ reason: 'disconnect-request', caller: 'disconnect', deviceId });

    if (!deviceId) return Promise.resolve(undefined);

    return new Promise<unknown>((resolve) => {
      uni.closeBLEConnection({
        deviceId,
        success: resolve,
        fail: resolve
      });
    });
  };

  const cleanup = async () => {
    await stopScan();
    const session = getActiveHistoryReadGuard();
    clearDataListener({
      reason: session.active ? 'cleanup-deferred' : 'cleanup-request',
      caller: 'cleanup',
      sessionId: session.sessionId,
      deviceId: runtime?.getDeviceInfo().deviceId
    });
    if (session.active) {
      appendRingDiagnosticLog('L19 BLE', 'legacy-cleanup-deferred-history-active', {
        deviceId: runtime?.getDeviceInfo().deviceId,
        sessionId: session.sessionId,
        remainingMs: session.remainingMs,
        wireActive: session.wireActive,
        wireElapsedMs: session.wireElapsedMs
      });
      return;
    }
    clearConnectionStateListener();
    clearBluetoothAdapterStateListener();
  };

  const sendBytes = (bytes: Uint8Array, label = '') => {
    const queueSeq = ++legacyCommandWriteQueueSeq;
    const queueGeneration = legacyCommandWriteQueueGeneration;
    const queuedAt = Date.now();
    const frame = summarizeLegacyBleFrame(bytes, label);
    const run = legacyCommandWriteQueue
      .catch(() => undefined)
      .then(async () => {
        if (queueGeneration !== legacyCommandWriteQueueGeneration) {
          const error = new Error('Legacy BLE command was discarded because the connection session changed.');
          appendRingDiagnosticLog('L19 BLE', 'legacy-command-write-discarded-stale-session', {
            queueSeq,
            queuedMs: Date.now() - queuedAt,
            queuedGeneration: queueGeneration,
            currentGeneration: legacyCommandWriteQueueGeneration,
            ...frame,
            error: formatLegacyBleError(error)
          });
          throw error;
        }
        if (!runtime) {
          throw new Error('Legacy ring adapter runtime is not configured.');
        }

        const { deviceId, serviceId, cmdCharId } = ensureWriteDevice(runtime);
        const commandIntervalWaitMs = Math.max(0, 300 - (Date.now() - legacyLastCommandWriteAt));
        if (commandIntervalWaitMs > 0) {
          await sleep(commandIntervalWaitMs);
        }
        legacyLastCommandWriteAt = Date.now();
        const startedAt = Date.now();
        appendRingDiagnosticLog('L19 BLE', 'legacy-command-write-start', {
          queueSeq,
          queuedMs: startedAt - queuedAt,
          deviceId,
          serviceId,
          characteristicId: cmdCharId,
          ...frame
        });

        const writeValue =
          bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
            ? bytes.buffer
            : bytes.slice().buffer;
        return new Promise<unknown>((resolve, reject) => {
          let settled = false;
          const writeTimeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            const error = new Error(`Legacy BLE command write timeout after ${LEGACY_COMMAND_WRITE_TIMEOUT_MS}ms.`);
            appendRingDiagnosticLog('L19 BLE', 'legacy-command-write-timeout', {
              queueSeq,
              elapsedMs: Date.now() - startedAt,
              timeoutMs: LEGACY_COMMAND_WRITE_TIMEOUT_MS,
              deviceId,
              serviceId,
              characteristicId: cmdCharId,
              ...frame,
              error: formatLegacyBleError(error)
            });
            reject(error);
          }, LEGACY_COMMAND_WRITE_TIMEOUT_MS);

          uni.writeBLECharacteristicValue({
            deviceId,
            serviceId,
            characteristicId: cmdCharId,
            value: writeValue as any,
            success: (result) => {
              appendRingDiagnosticLog('L19 BLE', settled ? 'legacy-command-write-late-result' : 'legacy-command-write-result', {
                queueSeq,
                elapsedMs: Date.now() - startedAt,
                deviceId,
                serviceId,
                characteristicId: cmdCharId,
                ...frame,
                result
              });
              if (settled) return;
              settled = true;
              clearTimeout(writeTimeout);
              resolve(result);
            },
            fail: (error) => {
              appendRingDiagnosticLog('L19 BLE', settled ? 'legacy-command-write-late-failed' : 'legacy-command-write-failed', {
                queueSeq,
                elapsedMs: Date.now() - startedAt,
                deviceId,
                serviceId,
                characteristicId: cmdCharId,
                ...frame,
                error: formatLegacyBleError(error),
                rawError: error
              });
              if (settled) return;
              settled = true;
              clearTimeout(writeTimeout);
              reject(error);
            }
          });
        });
      });

    legacyCommandWriteQueue = run.catch(() => undefined);
    return run;
  };

  const sendCommand = (cmd: number, subcmd: number, payload?: LegacyCommandPayload) => {
    return sendBytes(buildLegacyCommandBytes(cmd, subcmd, { payload }), `cmd:${formatLegacyFrameByte(cmd)}:${formatLegacyFrameByte(subcmd)}`);
  };

  const sendNamedCommand = (command: LegacyRingCommand, payload?: LegacyCommandPayload) => {
    return sendBytes(buildLegacyCommandByName(command, { payload }), `named:${command}`);
  };

  const sendReadLocalDataCommand = (sinceTimestamp = 0, readAll = true) => {
    finalizeHistoryWireTrace('superseded-by-new-read');
    const subcmd = readAll ? 0x01 : 0x00;
    const payload = numberToUint32LE(sinceTimestamp);
    const startedAt = Date.now();
    historyWireTrace = {
      startedAt,
      sinceTimestamp,
      readAll,
      subcmd,
      payloadHex: getLegacyBytesHex(payload),
      notifyCount: 0,
      firstPacketAt: 0,
      lastPacketAt: 0,
      maxPacketGapMs: 0,
      totalRecordCount: 0
    };
    appendRingDiagnosticLog('L19 BLE', 'legacy-history-wire-write', {
      historyCmd: '0x36',
      historySubcmd: formatLegacyFrameByte(subcmd),
      sinceTimestamp,
      readAll,
      payloadHex: historyWireTrace.payloadHex
    });
    return sendCommand(0x36, subcmd, payload)
      .then((result) => {
        appendRingDiagnosticLog('L19 BLE', 'legacy-history-wire-write-result', {
          elapsedMs: Date.now() - startedAt,
          historyCmd: '0x36',
          historySubcmd: formatLegacyFrameByte(subcmd),
          sinceTimestamp,
          readAll,
          result
        });
        return result;
      })
      .catch((error) => {
        appendRingDiagnosticLog('L19 BLE', 'legacy-history-wire-write-failed', {
          elapsedMs: Date.now() - startedAt,
          historyCmd: '0x36',
          historySubcmd: formatLegacyFrameByte(subcmd),
          sinceTimestamp,
          readAll,
          error: formatLegacyBleError(error),
          rawError: error
        });
        finalizeHistoryWireTrace('write-failed', {
          error: formatLegacyBleError(error)
        });
        throw error;
      });
  };

  const readLocalData = (options: LegacyReadLocalDataOptions = {}) => {
    const readAll = options.readAll ?? false;
    let sinceTimestamp = options.sinceTimestamp;

    if (sinceTimestamp === undefined) {
      sinceTimestamp = readAll ? 0 : getTodayZeroTimestamp();
    }

    return sendReadLocalDataCommand(sinceTimestamp, readAll);
  };

  const readDeviceTime = () => {
    return sendCommand(0x10, 0x01);
  };

  const waitForRawFrame = (predicate: (bytes: Uint8Array) => boolean, timeoutMs = 8000) => {
    const promise = new Promise<Uint8Array>((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = rawFrameWaiters.indexOf(waiter);
          if (index >= 0) rawFrameWaiters.splice(index, 1);
          reject(new Error('Timed out waiting for legacy raw frame.'));
        }, timeoutMs)
      };
      rawFrameWaiters.push(waiter);
    });
    promise.catch(() => undefined);
    return promise;
  };

  const sendAppConnectCommand = async (options: { timeoutMs?: number } = {}) => {
    const commandGeneration = legacyCommandWriteQueueGeneration;
    const timeoutMs = Math.max(3000, Number(options.timeoutMs) || 8000);
    const frameId = createLegacyFrameId();
    const timestampMs = Date.now();
    const timezone = 8;
    const payload = concatBytes(
      numberToUint64LE(timestampMs),
      new Uint8Array([timezone, getLegacyPlatformType()])
    );
    const bytes = buildLegacyCommandBytes(0xa0, 0x01, {
      frameType: 0x00,
      frameId,
      payload
    });
    const startedAt = Date.now();
    appendRingDiagnosticLog('L19 BLE', 'legacy-app-connect-start', {
      deviceId: runtime?.getDeviceInfo().deviceId,
      cmd: 0xa0,
      subcmd: 0x01,
      frameId,
      timestampMs,
      timezone,
      platform: getLegacyPlatformType(),
      payloadHex: Array.from(payload).map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase(),
      timeoutMs
    });
    const ackPromise = waitForRawFrame(
      (value) => value.length >= 4 && value[1] === frameId && value[2] === 0xa0 && value[3] === 0x01,
      timeoutMs
    );
    try {
      const writeResult = await sendBytes(bytes, 'app-connect:A0:01');
      appendRingDiagnosticLog('L19 BLE', 'legacy-app-connect-write-result', {
        deviceId: runtime?.getDeviceInfo().deviceId,
        frameId,
        elapsedMs: Date.now() - startedAt,
        result: writeResult
      });
      const ack = await ackPromise;
      if (legacyCommandWriteQueueGeneration === commandGeneration) {
        lastAppConnectAt = Date.now();
        appConnectReadyGeneration = commandGeneration;
      }
      appendRingDiagnosticLog('L19 BLE', 'legacy-app-connect-result', {
        deviceId: runtime?.getDeviceInfo().deviceId,
        frameId,
        elapsedMs: Date.now() - startedAt,
        ackHex: Array.from(ack).map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()
      });
      return { writeResult, ack, frameId };
    } catch (error) {
      appendRingDiagnosticLog('L19 BLE', 'legacy-app-connect-failed', {
        deviceId: runtime?.getDeviceInfo().deviceId,
        frameId,
        elapsedMs: Date.now() - startedAt,
        error: formatLegacyBleError(error)
      });
      throw error;
    }
  };
  establishAppConnectSession = async () => {
    const currentGeneration = legacyCommandWriteQueueGeneration;
    const appConnectElapsedMs = lastAppConnectAt > 0 ? Date.now() - lastAppConnectAt : Number.POSITIVE_INFINITY;
    if (lastAppConnectAt > 0 && appConnectReadyGeneration === currentGeneration) {
      appendRingDiagnosticLog('L19 BLE', 'legacy-app-connect-skipped', {
        reason: 'session-already-established',
        appConnectElapsedMs,
        connectionGeneration: currentGeneration
      });
      return { skipped: true, reason: 'session-already-established' };
    }

    if (appConnectInFlight && appConnectInFlightGeneration === currentGeneration) {
      appendRingDiagnosticLog('L19 BLE', 'legacy-app-connect-await-shared', {
        connectionGeneration: currentGeneration
      });
      return appConnectInFlight;
    }

    appConnectInFlightGeneration = currentGeneration;
    // Register the shared task before the mandatory post-connect wait. Several
    // restore/page-show callers can arrive during this window; registering only
    // after the wait lets every caller pass the in-flight guard and send its own
    // APP_CONNECT frame when the wait expires.
    const task = (async () => {
      const connectedElapsedMs = legacyPhysicalConnectedAt > 0 ? Date.now() - legacyPhysicalConnectedAt : 0;
      const waitMs = Math.max(0, 3000 - connectedElapsedMs);
      if (waitMs > 0) {
        appendRingDiagnosticLog('L19 BLE', 'legacy-app-connect-post-physical-wait-start', {
          deviceId: runtime?.getDeviceInfo().deviceId,
          connectedElapsedMs,
          waitMs
        });
        await sleep(waitMs);
      }
      return sendAppConnectCommand();
    })();
    appConnectInFlight = task;
    try {
      return await task;
    } finally {
      if (appConnectInFlight === task) {
        appConnectInFlight = null;
        appConnectInFlightGeneration = -1;
      }
    }
  };

  const updateDeviceTime = async (timestampMs = Date.now(), timezone = 8) => {
    if (lastAppConnectAt > 0 && appConnectReadyGeneration === legacyCommandWriteQueueGeneration) {
      appendRingDiagnosticLog('L19 BLE', 'legacy-device-time-write-skipped', {
        reason: 'app-connect-already-synced-time',
        appConnectElapsedMs: Date.now() - lastAppConnectAt
      });
      return { skipped: true, reason: 'app-connect-already-synced-time' };
    }
    const payload = concatBytes(numberToUint64LE(timestampMs), new Uint8Array([timezone & 0xff]));
    const result = await sendBytes(buildLegacyCommandBytes(0x10, 0x00, { frameType: 0x01, payload }), 'device-time-write');
    appendRingDiagnosticLog('L19 BLE', 'legacy-device-time-write-only', {
      timestampMs,
      timezone,
      reason: 'skip-readback-to-avoid-history-sync-blocking'
    });
    return result;
  };

  const sendFactoryResetWithTimeCommand = () => {
    const payload = concatBytes(numberToUint64LE(Date.now()), new Uint8Array([0x08, getLegacyPlatformType()]));
    return sendCommand(0xa0, 0x00, payload);
  };

  const waitForParsedData = (
    predicate: (parsed: RingParsedData) => boolean,
    timeoutMs = 15000,
    options: {
      replayRecent?: boolean;
      resetTimeoutOnData?: boolean;
      activityPredicate?: (parsed: RingParsedData) => boolean;
      activityTimeoutMs?: number;
    } = {}
  ) => {
    const promise = new Promise<RingParsedData>((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: null as unknown as ReturnType<typeof setTimeout>,
        resetTimeoutOnData: options.resetTimeoutOnData === true,
        activityPredicate: options.activityPredicate,
        activityTimeoutMs: Math.max(1000, Number(options.activityTimeoutMs) || timeoutMs),
        resetTimer: (nextTimeoutMs = timeoutMs) => {
          if (waiter.timer) clearTimeout(waiter.timer);
          waiter.timer = setTimeout(() => {
            const index = parsedWaiters.indexOf(waiter);
            if (index >= 0) parsedWaiters.splice(index, 1);
            reject(new Error('Timed out waiting for ring data.'));
          }, nextTimeoutMs);
        }
      };
      waiter.resetTimer();

      parsedWaiters.push(waiter);
    });
    promise.catch(() => undefined);
    return promise;
  };

  const setupDataListener = (device?: RingDeviceInfo) => {
    if (!runtime) return;

    const resolvedDevice = device || runtime.getDeviceInfo();
    const { deviceId, serviceId, dataCharId } = resolvedDevice;
    if (!deviceId || !serviceId || !dataCharId) return;
    const identityDevice = resolvedDevice as typeof resolvedDevice & {
      uniMacId?: string;
      mac?: string;
      name?: string;
      advertis?: { macInfo?: string };
    };

    // deviceId may be regenerated by WeChat on iOS/Harmony.  The listener
    // belongs to the physical ring, so use the advertised/backend MAC as the
    // stable identity and keep the current transport deviceId mutable.
    const physicalIdentity = `${
      identityDevice.uniMacId || identityDevice.mac || identityDevice.advertis?.macInfo || deviceId
    }`.toLowerCase();
    const identityKey = `${physicalIdentity}|${serviceId}|${dataCharId}`.toLowerCase();
    if (dataListenerHandler && dataListenerIdentityKey === identityKey) {
      dataListenerDeviceId = deviceId;
      dataListenerServiceId = serviceId;
      dataListenerDataCharId = dataCharId;
      dataListenerDeviceName = identityDevice.name || '';
      // Reusing the listener means a new/renewed communication lease. Any
      // deferred clear created by an older disconnect must not remove it.
      dataListenerGeneration += 1;
      if (pendingDataListenerClear) {
        appendRingDiagnosticLog('L19 BLE', 'legacy-data-listener-pending-clear-cancelled-on-reuse', {
          deviceId,
          identityKey,
          listenerGeneration: dataListenerGeneration,
          pendingReason: pendingDataListenerClear.reason,
          pendingGeneration: pendingDataListenerClear.listenerGeneration
        });
        pendingDataListenerClear = null;
      }
      appendRingDiagnosticLog('L19 BLE', 'legacy-data-listener-reuse', { deviceId, serviceId, dataCharId });
      return;
    }

    if (dataListenerHandler) {
      const session = getLegacyBleHistoryExclusiveSnapshot(runtime?.getDeviceInfo?.() || deviceId);
      if (session.active) {
        appendRingDiagnosticLog('L19 BLE', 'legacy-data-listener-replace-skipped-history-active', {
          deviceId,
          serviceId,
          dataCharId,
          currentIdentityKey: dataListenerIdentityKey,
          sessionId: session.sessionId
        });
        return;
      }
      offBleCharacteristicValueChange(dataListenerHandler);
      dataListenerHandler = null;
      dataListenerIdentityKey = '';
    }

    dataListenerDeviceId = deviceId;
    dataListenerServiceId = serviceId;
    dataListenerDataCharId = dataCharId;
    dataListenerDeviceName = identityDevice.name || '';
    dataListenerHandler = (result) => {
      if (
        result.deviceId !== dataListenerDeviceId ||
        result.serviceId !== dataListenerServiceId ||
        result.characteristicId !== dataListenerDataCharId
      ) return;

      const notifyBytes = new Uint8Array(result.value);
      for (const waiter of [...rawFrameWaiters]) {
        if (!waiter.predicate(notifyBytes)) continue;
        clearTimeout(waiter.timer);
        const index = rawFrameWaiters.indexOf(waiter);
        if (index >= 0) rawFrameWaiters.splice(index, 1);
        waiter.resolve(notifyBytes);
      }
      const notifyFrame = summarizeLegacyBleFrame(notifyBytes);
      const isHistoryWireNotify = Boolean(historyWireTrace);
      if (!isHistoryWireNotify) {
        appendRingDiagnosticLog('L19 BLE', 'legacy-notify-received', {
          deviceId: result.deviceId,
          serviceId: result.serviceId,
          characteristicId: result.characteristicId,
          ...notifyFrame
        });
      }

      const parsed = parseLegacyRingData(notifyBytes);
      if (parsed) {
        appendHistoryWireNotifyLog('legacy-history-wire-notify-parsed', result, notifyFrame, parsed);
        if (!isHistoryWireNotify) {
          appendRingDiagnosticLog('L19 BLE', 'legacy-notify-parsed', {
            deviceId: result.deviceId,
            serviceId: result.serviceId,
            characteristicId: result.characteristicId,
            ...notifyFrame,
            parsedType: parsed.type,
            status: (parsed as any).status,
            recordCount: Array.isArray((parsed as any).records) ? (parsed as any).records.length : undefined
          });
        }
        const parsedWithDevice = {
          ...parsed,
          protocol: 'legacy' as const,
          deviceId: dataListenerDeviceId,
          deviceName: dataListenerDeviceName
        };

        for (const waiter of [...parsedWaiters]) {
          const hasMatchingActivity = waiter.resetTimeoutOnData
            && (waiter.activityPredicate?.(parsedWithDevice) ?? true);
          if (hasMatchingActivity) {
            waiter.resetTimer(waiter.activityTimeoutMs);
          }
          if (!waiter.predicate(parsedWithDevice)) continue;

          clearTimeout(waiter.timer);
          const index = parsedWaiters.indexOf(waiter);
          if (index >= 0) parsedWaiters.splice(index, 1);
          waiter.resolve(parsedWithDevice);
        }
        runtime.onParsedData?.(parsedWithDevice);
      } else {
        appendHistoryWireNotifyLog('legacy-history-wire-notify-unparsed', result, notifyFrame, null);
        if (!isHistoryWireNotify) {
          appendRingDiagnosticLog('L19 BLE', 'legacy-notify-unparsed', {
            deviceId: result.deviceId,
            serviceId: result.serviceId,
            characteristicId: result.characteristicId,
            ...notifyFrame
          });
        }
      }
    };
    uni.onBLECharacteristicValueChange(dataListenerHandler);
    dataListenerIdentityKey = identityKey;
    dataListenerGeneration += 1;
    pendingDataListenerClear = null;
    appendRingDiagnosticLog('L19 BLE', 'legacy-data-listener-registered', {
      deviceId,
      serviceId,
      dataCharId,
      identityKey,
      listenerGeneration: dataListenerGeneration
    });
  };

  const clearDataListener = (options: LegacyDataListenerClearOptions = {}) => {
    const session = getActiveHistoryReadGuard();
    const metadata = {
      reason: options.reason || 'unspecified',
      caller: options.caller || 'unknown',
      sessionId: options.sessionId || session.sessionId,
      deviceId: options.deviceId || runtime?.getDeviceInfo().deviceId,
      force: Boolean(options.force),
      historyActive: session.active,
      historyWireActive: session.wireActive,
      historyWireElapsedMs: session.wireElapsedMs,
      listenerIdentityKey: dataListenerIdentityKey,
      waiterCount: parsedWaiters.length
    };
    appendRingDiagnosticLog('L19 BLE', 'legacy-data-listener-clear-request', metadata);
    if (session.active && !options.force) {
      pendingDataListenerClear = {
        ...options,
        sessionId: metadata.sessionId,
        deviceId: metadata.deviceId,
        listenerGeneration: dataListenerGeneration,
        listenerIdentityKey: dataListenerIdentityKey
      };
      appendRingDiagnosticLog('L19 BLE', 'legacy-data-listener-clear-deferred', metadata);
      return;
    }
    for (const waiter of parsedWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Ring data listener was cleared.'));
    }
    for (const waiter of rawFrameWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Ring data listener was cleared.'));
    }
    if (dataListenerHandler) {
      offBleCharacteristicValueChange(dataListenerHandler);
      dataListenerHandler = null;
    }
    dataListenerIdentityKey = '';
    dataListenerDeviceId = '';
    dataListenerServiceId = '';
    dataListenerDataCharId = '';
    dataListenerDeviceName = '';
    pendingDataListenerClear = null;
    appendRingDiagnosticLog('L19 BLE', 'legacy-data-listener-clear-completed', metadata);
  };

  onLegacyBleCommandSessionIdle(() => {
    if (!pendingDataListenerClear) return;
    const pending = pendingDataListenerClear;
    pendingDataListenerClear = null;
    if (
      pending.listenerGeneration !== dataListenerGeneration ||
      pending.listenerIdentityKey !== dataListenerIdentityKey
    ) {
      appendRingDiagnosticLog('L19 BLE', 'legacy-data-listener-deferred-clear-skipped-stale', {
        reason: pending.reason,
        caller: pending.caller,
        deviceId: pending.deviceId,
        pendingGeneration: pending.listenerGeneration,
        currentGeneration: dataListenerGeneration,
        pendingIdentityKey: pending.listenerIdentityKey,
        currentIdentityKey: dataListenerIdentityKey
      });
      return;
    }
    clearDataListener({ ...pending, reason: pending.reason || 'deferred-session-idle', caller: pending.caller || 'session-idle' });
  }, () => runtime?.getDeviceInfo?.() || dataListenerDeviceId);

  return {
    protocol: 'legacy',
    state,
    initBluetooth,
    openBluetoothAdapter,
    registerConnectionStateListener,
    checkBluetoothState,
    startScan,
    stopScan,
    setMTU,
    connectDevice,
    connectAndDiscover,
    discoverServicesAndChars,
    enableNotify,
    checkByRSSI,
    isDeviceConnected,
    cacheServiceId,
    getCachedServiceId,
    disconnect,
    cleanup,
    sendBytes,
    sendCommand,
    sendNamedCommand,
    waitForParsedData,
    setupDataListener,
    clearDataListener,
    sendBatteryCommand: () => sendNamedCommand(LegacyRingCommand.Battery),
    sendActiveMeasureCommand: () => sendNamedCommand(LegacyRingCommand.ActiveMeasure, 0x1e),
    sendOxyGenCommand: () => sendNamedCommand(LegacyRingCommand.BloodOxygen, 0x1e),
    sendBodyTemperatureCommand: () => sendNamedCommand(LegacyRingCommand.BodyTemperature, 0x00),
    sendFirmwareVersion: () => sendNamedCommand(LegacyRingCommand.HardwareVersion),
    sendSoftwareVersion: () => sendNamedCommand(LegacyRingCommand.SoftwareVersion),
    sendReadLocalDataCommand,
    readLocalData,
    readDeviceTime,
    updateDeviceTime,
    sendAppConnectCommand,
    establishAppConnectSession,
    sendCollectPeriodSettingCommand: (seconds = 1200) => sendNamedCommand(LegacyRingCommand.SetCollectPeriod, numberToUint32LE(seconds)),
    readCollectPeriodCommand: () => sendNamedCommand(LegacyRingCommand.ReadCollectPeriod),
    sendResetCommand: () => sendNamedCommand(LegacyRingCommand.FactoryReset),
    sendFactoryResetWithTimeCommand,
    sendDeleteAllLocalDataCommand: () => sendNamedCommand(LegacyRingCommand.DeleteAllLocalData)
  };
};
