import type { RingBleAdapter, RingBleRuntime, RingBleState, RingDeviceInfo, RingParsedData } from '../types';
import type { RwHealthMonitoringConfig, RwUserProfile } from '../rw/protocol';
import { parseQkeerV2AdvertisInfo, parseRwAdvertisInfo, resolveRingProtocol } from '../protocolRegistry';
import { LegacyRingCommand } from './commands';
import { parseLegacyRingData } from './parser';
import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';
import { ensureWechatBluetoothPrivacyAuthorization, isBluetoothPrivacyError, normalizeBluetoothPrivacyError } from '@/utils/wechatBluetoothPrivacy';
import { getLegacyBleHistoryExclusiveSnapshot, onLegacyBleCommandSessionIdle, renewLegacyBleCommandSessionActivity, releaseLegacyBleCommandSessions } from './commandSession';
import {
  buildLegacyBloodOxygenMeasurementPayload,
  buildLegacyCommandByName,
  buildLegacyCommandBytes,
  buildLegacyHeartRateMeasurementPayload,
  concatBytes,
  createLegacyFrameId,
  getLegacyPlatformType,
  getTodayZeroTimestamp,
  type LegacyCommandPayload,
  numberToUint32LE,
  numberToUint64LE
} from './protocol';

export interface RingWriteOptions {
  /**
   * 写超时后是否允许降级重发（如改 writeNoResponse 再发一次）。
   * 删除/格式化/恢复出厂这类非幂等命令必须传 `false`：超时意味着无法确认
   * 帧有没有发出去，再发一次可能被执行两遍。
   */
  allowTimeoutFallback?: boolean;
}

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
  sendBytes: (bytes: Uint8Array, label?: string, options?: RingWriteOptions) => Promise<unknown>;
  /** Whether the active device should use the QKeeRingL19/QKL19 history compatibility path. */
  isL19HistoryDevice?: () => boolean;
  /** Start/end a history session bound to the current platform BLE device and connection generation. */
  beginL19HistorySession?: () => number | null;
  endL19HistorySession?: (generation?: number | null) => void;
  /** Write an L19 history frame with the platform-default write semantics (no explicit writeType). */
  sendL19HistoryBytes?: (bytes: Uint8Array, label?: string) => Promise<unknown>;
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
  finishHistoryReadTrace?: (reason: string, details?: Record<string, unknown>) => void;
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
  // 历史会话期间收到的 disconnect 只是被延后：会话结束后必须真的关闭链路，
  // 否则戒指会一直保持连接（后台断连形同虚设）。
  closeConnection?: boolean;
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
const LEGACY_GATT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LEGACY_TARGET_MTU = 247;
// The shortest L19 history Notify observed on the wire is 29 bytes. ATT keeps
// three bytes for its own header, so MTU must be at least 32 for the existing
// complete-frame parser to receive one history frame intact.
const LEGACY_HISTORY_MINIMUM_MTU = 32;
const LEGACY_MTU_MAX_ATTEMPTS = 2;
type LegacyGattCacheEntry = {
  serviceId: string;
  cmdCharId?: string;
  dataCharId?: string;
  writeType?: 'write' | 'writeNoResponse';
  updatedAt?: number;
};
// Service/characteristic discovery and Notify setup already consume part of the
// controller settle window. Normal rings consistently acknowledge APP_CONNECT
// in well under one second, so do not add another unconditional three seconds.
// A failed handshake switches subsequent physical reconnects back to the old
// conservative window for compatibility with slower phones/rings.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// WeChat may return BLE identifiers with different casing/separators between
// scan/connect and characteristic callbacks (especially on Android/Harmony).
// Compare their canonical hex identity instead of dropping a valid notify.
const normalizeBleIdentifier = (value: unknown) =>
  `${value || ''}`
    .trim()
    .replace(/[{}:\-\s]/g, '')
    .toLowerCase();

const isAlreadyConnectedError = (error: unknown) => {
  const record = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  const message = `${record.errMsg || record.message || error || ''}`.toLowerCase();
  return message.includes('already connect') || message.includes('already connected');
};

const isBleConnectOperateTimeout = (error: unknown) => {
  const record = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  const message = `${record.errMsg || record.message || error || ''}`.toLowerCase();
  return message.includes('createbleconnection') && (message.includes('operate time out') || message.includes('operation timeout'));
};

// Android 上 status:133 / errCode 10003 是"链路被占用或旧连接尚未释放"的典型
// 返回，通常立刻失败，适合短暂清理后重试；真正的超时不会命中这里。
const isTransientLegacyConnectFailure = (error: unknown) => {
  const record = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  const message = `${record.errMsg || record.message || error || ''}`.toLowerCase();
  const errorCode = Number(record.errCode ?? record.errno ?? 0);
  return (
    errorCode === 133 || errorCode === 10003 || message.includes('createbleconnection:fail:connection fail') || message.includes('status:133') || message.includes('status 133')
  );
};

type BluetoothDeviceFoundCallback = Parameters<typeof uni.onBluetoothDeviceFound>[0];
type BleConnectionStateCallback = Parameters<typeof uni.onBLEConnectionStateChange>[0];
type BleCharacteristicValueCallback = Parameters<typeof uni.onBLECharacteristicValueChange>[0];
type BluetoothAdapterStateCallback = (result: { available?: boolean; discovering?: boolean }) => void;

// 这三个原本是裸调用。App 端只要某个 off* API 不存在，调用处就会抛 TypeError；
// 调用点如果在 Promise 之外（startScan 就是），整次扫描会当场静默死掉 —— 日志里
// 只剩 log 起点、列表永远是空的，且没有任何报错。全部改成可选调用，与下面的
// offBluetoothAdapterStateChange 保持一致。
const offBluetoothDeviceFound = (callback: BluetoothDeviceFoundCallback) => {
  (uni.offBluetoothDeviceFound as unknown as ((callback?: BluetoothDeviceFoundCallback) => void) | undefined)?.(callback);
};

const offBleConnectionStateChange = (callback: BleConnectionStateCallback) => {
  (uni.offBLEConnectionStateChange as unknown as ((callback?: BleConnectionStateCallback) => void) | undefined)?.(callback);
};

const offBleCharacteristicValueChange = (callback: BleCharacteristicValueCallback) => {
  (uni.offBLECharacteristicValueChange as unknown as ((callback?: BleCharacteristicValueCallback) => void) | undefined)?.(callback);
};

const offBluetoothAdapterStateChange = (callback: BluetoothAdapterStateCallback) => {
  (uni.offBluetoothAdapterStateChange as unknown as ((callback?: BluetoothAdapterStateCallback) => void) | undefined)?.(callback);
};

const ensureWriteDevice = (runtime: RingBleRuntime, pendingDevice?: RingDeviceInfo | null) => {
  // During first binding, GATT discovery must be able to send APP_CONNECT before
  // the device is published to the shared store. Publishing it here used to set
  // reconnectResult=true and let the hidden home page start history sync before
  // APP_CONNECT/backend binding had completed.
  const deviceInfo = pendingDevice?.deviceId ? pendingDevice : runtime.getDeviceInfo();
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
    return value
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
};

const formatLegacyFrameByte = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return `0x${(value & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;
};

const getLegacyBytesHex = (bytes: Uint8Array | ArrayBuffer | number[]) => {
  if (bytes instanceof Uint8Array) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
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

const appendScanDeviceRecordLog = (rawDevice: unknown, matchedDevice: RingDeviceInfo, parsedMac: string, advertisHex: string, matchedKeys: string[]) => {
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
const LEGACY_SCAN_STOP_TIMEOUT_MS = 3000;
// App 端 closeBLEConnection / MTU 查询等调用可能既不回 success 也不回 fail。
// 这类调用只需"尽力而为"，超时按失败/无结果结算，避免连接流程永久挂起。
const LEGACY_QUIET_BLE_CALL_TIMEOUT_MS = 2000;
// createBLEConnection 的平台 timeout 参数在部分 Android 基座上不生效，
// JS 侧必须再兜一层，否则握手会一直停在建链这一步。
const LEGACY_CONNECT_CALL_TIMEOUT_MS = 15000;
// 建链瞬时失败（Android status:133 / errCode 10003）多由上一轮连接尚未释放
// 引起，快速重试通常能成功。这里只重试"快速失败"，不重试超时：超时说明戒指
// 很可能还被另一台手机占着，再等一轮只会让用户多等十几秒。
const LEGACY_CREATE_CONNECTION_RETRY_DELAYS_MS = [0, 900, 1800];
const LEGACY_MAPPED_IDENTITY_TIMEOUT_RETRY_DELAY_MS = 1200;
const LEGACY_ALREADY_CONNECTED_RETRY_DELAY_MS = 350;
const LEGACY_GATT_CELL_TIMEOUT_MS = 10000;
const BLUETOOTH_ADAPTER_STATE_CHECK_TIMEOUT_MS = 800;
const BLUETOOTH_ADAPTER_OPEN_FOREGROUND_TIMEOUT_MS = 3000;
const BLUETOOTH_ADAPTER_OPEN_CALLBACK_EXPIRY_MS = 12000;

type BluetoothAdapterStateSnapshot = {
  available: boolean;
  discovering: boolean;
  source: 'state' | 'unsupported' | 'timeout' | 'failed';
  error?: unknown;
};

type BluetoothAdapterOpenOperation = {
  promise: Promise<unknown>;
  startedAt: number;
  foregroundTimedOut: boolean;
};

/**
 * 平台回调里的错误形状不确定（uni 的 errMsg / 原生 message / 纯字符串），
 * 统一压成纯对象再进日志，避免 Error 实例被序列化成 {}。
 */
const describeScanError = (error: unknown): Record<string, unknown> => {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return {
      errMsg: `${record.errMsg ?? record.message ?? ''}`,
      errCode: record.errCode ?? record.code ?? ''
    };
  }
  return { errMsg: `${error ?? ''}` };
};

/**
 * `startBluetoothDevicesDiscovery` 正常在毫秒级就会回调；等 5 秒还没有动静，
 * 基本可以判定这个平台的回调不会来了，而不是「回调很快但日志没传上去」。
 */
const SCAN_CALLBACK_WATCHDOG_MS = 5000;

/** 扫描期间整表轮询的间隔。 */
const SCAN_POLL_INTERVAL_MS = 1500;

/**
 * 整表轮询（`getBluetoothDevices`）是给「Harmony/iOS 不回写 `onBluetoothDeviceFound`」兜底的。
 * 代价是每轮把原生累计的设备列表整份重合并一遍 —— 实测 267 台时 JS 侧约 200ms（真机更慢），
 * 而且会把「上一轮扫描留在原生缓存里的历史设备」一起灌进列表（实测能到 267 台）。
 *
 * Android 上事件上报是活的（日志里 `advertisData` 齐全），这活就是纯重复劳动：每 1.5s 把
 * 200+ 行对象换一遍，页面跟着整列表重渲染，点击（连接/取消/导航栏返回）就被挤在同一个
 * 逻辑层队列里。所以「最近收到过设备广播」的时间窗内直接跳过整表轮询。
 *
 * 扫描刚开始、一条事件都还没收到时窗口不生效，轮询照常跑 —— 兜底平台的时序与改动前一致。
 */
const SCAN_POLL_EVENT_FLOW_WINDOW_MS = 4000;

/**
 * 轮询定时器迟到的上报阈值。健康的逻辑层里 1500ms 的 `setInterval` 偏差只有几十毫秒；
 * 明显迟到就说明逻辑层线程被占住了 —— 点击和它排同一个队列，所以这条埋点是
 * 「点了要等一会才响应」的直接度量：偏差只有几十毫秒时，点击不可能被延迟到有感。
 */
const SCAN_POLL_LATE_LOG_MS = 300;

/**
 * 设备广播的合并间隔。
 *
 * `allowDuplicatesKey: true` 时平台把**每一包广播**都回调一次 —— 真机日志实测
 * 568~626 条 / 1.5s（约 400 条/秒）。每条都当场整表合并的话，逻辑层（单线程）根本
 * 排不完：同一次扫描里 1500ms 的轮询定时器**迟到 10 秒**（`legacy-scan-poll-late`
 * 的 `lateMs: 10055`），而点击事件和它排同一个队列 —— 症状就是「点连接/取消/导航栏
 * 返回都要等一会才响应，搜索一停就立刻响应」。
 *
 * 所以收到的事件先攒进 `pendingScanDevices`，按这个间隔统一合并一次。合并本身是幂等的
 * （同一台设备重复广告只会覆盖同一行），把 400 次/秒压到 4 次/秒不改变最终列表，
 * 只是让列表最多晚 250ms 出现 —— 肉眼无感，逻辑层却空出来了。
 */
const SCAN_EVENT_MERGE_INTERVAL_MS = 250;

/**
 * 业务扫描「名字认得出是戒指」的前缀，与 rw adapter 的 `isAllowedBusinessScanDevice` 同源。
 * 比 `DEFAULT_SCAN_PREFIXES` 多两个 qkeer-v2 的名字：v2 正常由 `registerRingProtocolDetector`
 * 注册的检测器按协议认出，但检测器没注册时（只跑 legacy adapter 的场景）名字前缀是最后
 * 一道识别，少了这两个就会把 v2 戒指当杂项设备挡掉。
 */
const BUSINESS_SCAN_EXTRA_NAME_PREFIXES = ['MUSLEEP_RING', 'QKV2'];

export const createLegacyRingAdapter = (state: RingBleState, runtime?: RingBleRuntime): LegacyRingAdapter => {
  let scanTimeout: ReturnType<typeof setTimeout> | null = null;
  let scanPollTimer: ReturnType<typeof setInterval> | null = null;
  // 本轮扫描最近一次收到设备广播的时刻；0 表示本轮还没收到过，此时整表轮询照常跑。
  let lastScanDeviceEventAt = 0;
  // 相邻两次轮询之间收到的设备广播条数，以及本次轮询理论上应触发的时刻。
  // 只用于「轮询迟到」那条埋点：迟到说明逻辑层被占住，顺带把事件流强度一起带出来。
  let scanDeviceEventCount = 0;
  let scanPollDueAt = 0;
  // 两次合并之间攒下来的原始广播。键取 `deviceId`（同一台设备在原生侧 id 稳定），
  // 后到的覆盖先到的 —— 合并只关心「这轮看到过哪些设备、最后一次的广播长什么样」，
  // 中间那几十包重复内容没有信息量，先丢掉能省掉绝大部分合并开销。
  let pendingScanDevices = new Map<string, any>();
  let scanMergeTimer: ReturnType<typeof setTimeout> | null = null;
  // `startBluetoothDevicesDiscovery` 的 success/fail「一个都不回」是本项目 App 端最难查的
  // 一种故障（不报错、列表为空、日志空白）。有了这个看门狗，就能把「平台没回调」
  // 和「回调了但日志没传上去」两件事彻底分开。
  let scanCallbackWatchdog: ReturnType<typeof setTimeout> | null = null;
  // 本次扫描 `startBluetoothDevicesDiscovery` 到底回没回回调。这是「Android 静默失败」的
  // 唯一判据；但一次成功扫描会产出几百条 `scan-device-record` 把上传队列灌满、按「丢最旧」
  // 淘汰，队头的 `legacy-scan-armed` / `legacy-scan-discovery-*` 会被挤掉。所以这个信号
  // 必须搭在队尾的 `legacy-scan-stop` 上，才能活着传到后端。
  let scanStartCallbackState: 'none' | 'success' | 'fail' = 'none';
  // 每次 startScan 的调用代际。start 的 success/fail 可能迟到（甚至 20s 后），
  // 迟到的旧回调不能去拆新一轮扫描的监听器和定时器。
  let scanInvocationGeneration = 0;
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
  let useConservativeAppConnectSettle = false;
  let legacyCommandWriteType: 'write' | 'writeNoResponse' = 'writeNoResponse';
  let pendingCommandDevice: RingDeviceInfo | null = null;
  let establishAppConnectSession: () => Promise<unknown> = async () => undefined;
  let connectionStateHandler: BleConnectionStateCallback | null = null;
  let bluetoothAdapterStateHandler: BluetoothAdapterStateCallback | null = null;
  let bluetoothAdapterOpenOperation: BluetoothAdapterOpenOperation | null = null;
  let dataListenerHandler: BleCharacteristicValueCallback | null = null;
  let dataListenerIdentityKey = '';
  let dataListenerDeviceId = '';
  let dataListenerStableDeviceId = '';
  let dataListenerServiceId = '';
  let dataListenerDataCharId = '';
  let dataListenerDeviceName = '';
  let dataListenerNormalizedIdentityLogged = false;
  let dataListenerGeneration = 0;
  let pendingDataListenerClear: PendingLegacyDataListenerClear | null = null;
  // cleanup 撞上历史会话时，连接状态监听器要等会话结束再注销，不能无限期留着。
  let cancelCleanupIdleWait: (() => void) | null = null;
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

  const isL19HistoryDevice = () => {
    const device = runtime?.getDeviceInfo?.() as RingDeviceInfo | undefined;
    const candidates = [device?.name, device?.deviceName, device?.model, device?.modelKey, device?.productName];
    return candidates.some((value) => {
      const normalized = String(value || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      return normalized.includes('QKEERINGL19') || normalized.includes('QKL19');
    });
  };

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
    const session = getLegacyBleHistoryExclusiveSnapshot(runtime?.getDeviceInfo?.() || dataListenerDeviceId);
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

  const appendHistoryWireNotifyLog = (event: string, result: any, notifyFrame: ReturnType<typeof summarizeLegacyBleFrame>, parsed?: RingParsedData | null) => {
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

  const getBluetoothAdapterStateSnapshot = (reason: string) => {
    const startedAt = Date.now();
    appendRingDiagnosticLog('L19 BLE', 'legacy-bluetooth-adapter-state-check-start', { reason });
    return new Promise<BluetoothAdapterStateSnapshot>((resolve) => {
      let settled = false;
      const finish = (snapshot: BluetoothAdapterStateSnapshot, event: string) => {
        if (settled) {
          appendRingDiagnosticLog('L19 BLE', 'legacy-bluetooth-adapter-state-check-late-result', {
            reason,
            available: snapshot.available,
            discovering: snapshot.discovering,
            source: snapshot.source,
            elapsedMs: Date.now() - startedAt,
            error: formatLegacyBleError(snapshot.error)
          });
          if (snapshot.available) runtime?.onBluetoothReadyChange?.(true);
          return;
        }
        settled = true;
        clearTimeout(timer);
        appendRingDiagnosticLog('L19 BLE', event, {
          reason,
          available: snapshot.available,
          discovering: snapshot.discovering,
          source: snapshot.source,
          elapsedMs: Date.now() - startedAt,
          error: formatLegacyBleError(snapshot.error)
        });
        resolve(snapshot);
      };
      const timer = setTimeout(() => {
        finish({ available: false, discovering: false, source: 'timeout' }, 'legacy-bluetooth-adapter-state-check-timeout');
      }, BLUETOOTH_ADAPTER_STATE_CHECK_TIMEOUT_MS);

      if (typeof uni.getBluetoothAdapterState !== 'function') {
        finish({ available: false, discovering: false, source: 'unsupported' }, 'legacy-bluetooth-adapter-state-check-unsupported');
        return;
      }

      uni.getBluetoothAdapterState({
        success: (result) =>
          finish(
            {
              available: Boolean(result.available),
              discovering: Boolean(result.discovering),
              source: 'state'
            },
            'legacy-bluetooth-adapter-state-check-result'
          ),
        fail: (error) => finish({ available: false, discovering: false, source: 'failed', error }, 'legacy-bluetooth-adapter-state-check-failed')
      });
    });
  };

  const startBluetoothAdapterOpenOperation = () => {
    const startedAt = Date.now();
    const operation = {
      promise: Promise.resolve(undefined) as Promise<unknown>,
      startedAt,
      foregroundTimedOut: false
    } satisfies BluetoothAdapterOpenOperation;

    appendRingDiagnosticLog('L19 BLE', 'legacy-bluetooth-adapter-open-start', {
      foregroundTimeoutMs: BLUETOOTH_ADAPTER_OPEN_FOREGROUND_TIMEOUT_MS,
      callbackExpiryMs: BLUETOOTH_ADAPTER_OPEN_CALLBACK_EXPIRY_MS
    });

    operation.promise = ensureWechatBluetoothPrivacyAuthorization()
      .then(
        () =>
          new Promise<unknown>((resolve, reject) => {
            let callbackSettled = false;
            const expiryTimer = setTimeout(() => {
              if (callbackSettled) return;
              callbackSettled = true;
              const error = new Error('Open Bluetooth adapter callback expired.');
              appendRingDiagnosticLog('L19 BLE', 'legacy-bluetooth-adapter-open-callback-expired', {
                elapsedMs: Date.now() - startedAt,
                foregroundTimedOut: operation.foregroundTimedOut
              });
              reject(error);
            }, BLUETOOTH_ADAPTER_OPEN_CALLBACK_EXPIRY_MS);

            uni.openBluetoothAdapter({
              success: (result) => {
                if (callbackSettled) {
                  appendRingDiagnosticLog('L19 BLE', 'legacy-bluetooth-adapter-open-expired-success', {
                    elapsedMs: Date.now() - startedAt
                  });
                  runtime?.onBluetoothReadyChange?.(true);
                  return;
                }
                callbackSettled = true;
                clearTimeout(expiryTimer);
                appendRingDiagnosticLog('L19 BLE', operation.foregroundTimedOut ? 'legacy-bluetooth-adapter-open-late-success' : 'legacy-bluetooth-adapter-open-success', {
                  elapsedMs: Date.now() - startedAt,
                  foregroundTimedOut: operation.foregroundTimedOut
                });
                runtime?.onBluetoothReadyChange?.(true);
                resolve(result);
              },
              fail: (error) => {
                const normalizedError = normalizeBluetoothPrivacyError(error);
                if (callbackSettled) {
                  appendRingDiagnosticLog('L19 BLE', 'legacy-bluetooth-adapter-open-expired-failed', {
                    elapsedMs: Date.now() - startedAt,
                    error: formatLegacyBleError(normalizedError)
                  });
                  return;
                }
                callbackSettled = true;
                clearTimeout(expiryTimer);
                appendRingDiagnosticLog('L19 BLE', operation.foregroundTimedOut ? 'legacy-bluetooth-adapter-open-late-failed' : 'legacy-bluetooth-adapter-open-failed', {
                  elapsedMs: Date.now() - startedAt,
                  foregroundTimedOut: operation.foregroundTimedOut,
                  error: formatLegacyBleError(normalizedError),
                  privacyBlocked: isBluetoothPrivacyError(normalizedError)
                });
                reject(normalizedError);
              }
            });
          })
      )
      .catch((error) => {
        const normalizedError = normalizeBluetoothPrivacyError(error);
        if (isBluetoothPrivacyError(normalizedError)) {
          appendRingDiagnosticLog('L19 BLE', 'legacy-bluetooth-privacy-authorization-required', {
            elapsedMs: Date.now() - startedAt,
            retryable: false,
            error: formatLegacyBleError(normalizedError)
          });
        }
        throw normalizedError;
      });

    bluetoothAdapterOpenOperation = operation;
    operation.promise.then(
      () => {
        if (bluetoothAdapterOpenOperation === operation) bluetoothAdapterOpenOperation = null;
      },
      () => {
        if (bluetoothAdapterOpenOperation === operation) bluetoothAdapterOpenOperation = null;
      }
    );
    return operation;
  };

  const openBluetoothAdapter = () => {
    const existingOperation = bluetoothAdapterOpenOperation;
    const operation = existingOperation || startBluetoothAdapterOpenOperation();
    if (existingOperation) {
      appendRingDiagnosticLog('L19 BLE', 'legacy-bluetooth-adapter-open-reuse', {
        elapsedMs: Date.now() - operation.startedAt,
        foregroundTimedOut: operation.foregroundTimedOut
      });
    }
    const elapsedMs = Date.now() - operation.startedAt;
    const remainingMs = Math.max(0, BLUETOOTH_ADAPTER_OPEN_FOREGROUND_TIMEOUT_MS - elapsedMs);
    return new Promise<unknown>((resolve, reject) => {
      let foregroundSettled = false;
      const timer = setTimeout(() => {
        if (foregroundSettled) return;
        foregroundSettled = true;
        operation.foregroundTimedOut = true;
        appendRingDiagnosticLog('L19 BLE', 'legacy-bluetooth-adapter-open-foreground-timeout', {
          elapsedMs: Date.now() - operation.startedAt,
          timeoutMs: BLUETOOTH_ADAPTER_OPEN_FOREGROUND_TIMEOUT_MS
        });
        reject(new Error('Open Bluetooth adapter foreground timeout.'));
      }, remainingMs);
      operation.promise.then(
        (result) => {
          if (foregroundSettled) return;
          foregroundSettled = true;
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          if (foregroundSettled) return;
          foregroundSettled = true;
          clearTimeout(timer);
          reject(error);
        }
      );
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
        appendRingDiagnosticLog('L19 BLE', result.connected ? 'connection-state-ignore-non-target-connected' : 'connection-state-ignore-non-target-disconnected', {
          currentDeviceId,
          eventDeviceId,
          connected: Boolean(result.connected)
        });
        return;
      }
      if (!currentDeviceId && !result.connected) {
        // 刚断开/正在重连时 runtime 还没有"当前设备"，事件无法按设备归属。
        // 只有它确实对应本适配器跟踪的监听器时才处理，避免一条延迟的旧断开
        // 事件把新建的监听器、历史会话和写队列全部清掉。
        const trackedDeviceId = dataListenerDeviceId;
        if (!trackedDeviceId || (eventDeviceId && eventDeviceId !== trackedDeviceId)) {
          appendRingDiagnosticLog('L19 BLE', 'connection-state-ignore-unowned-disconnect', {
            eventDeviceId,
            trackedDeviceId,
            connected: false
          });
          return;
        }
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
    registerConnectionStateListener();
    // getBluetoothAdapterState before openBluetoothAdapter produces the
    // removable "not init" noise seen on real devices. Open first; the
    // existing foreground timeout/retry path still surfaces a user hint when
    // the OS genuinely does not finish initialization.
    const openResult = await openBluetoothAdapter();
    const stateSnapshot = await getBluetoothAdapterStateSnapshot('init-bluetooth-after-open');
    if (stateSnapshot.available) {
      runtime?.onBluetoothReadyChange?.(true);
      appendRingDiagnosticLog('L19 BLE', 'legacy-bluetooth-adapter-state-after-open', {
        reason: 'open-succeeded-state-confirmed',
        discovering: stateSnapshot.discovering
      });
      return stateSnapshot;
    }
    appendRingDiagnosticLog('L19 BLE', 'legacy-bluetooth-adapter-state-after-open-unconfirmed', {
      source: stateSnapshot.source,
      error: stateSnapshot.error
    });
    return openResult;
  };

  const checkBluetoothState = async () => {
    const stateSnapshot = await getBluetoothAdapterStateSnapshot('check-bluetooth-state');
    return stateSnapshot.available;
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

  // 无绑定设备时的扫描是唯一没有 bound 诊断兜底的路径：它一旦悄悄失败，日志里
  // 什么都不剩，只看到「扫描列表为空」。这里按批次指纹变化记一条汇总，只回答三个
  // 问题：系统到底给了几个设备、几个进了列表、几个被名字前缀挡掉了。
  let lastScanBatchSignature = '';

  const reportScanBatch = (source: string, received: number, merged: number, filteredByPrefix: number) => {
    const signature = `${received}|${merged}|${filteredByPrefix}`;
    if (signature === lastScanBatchSignature) return;
    lastScanBatchSignature = signature;
    appendRingDiagnosticLog('L19 BLE', 'legacy-scan-batch', {
      source,
      received,
      merged,
      filteredByPrefix,
      listed: state.devices.value.length
    });
  };

  // 一轮合并里，「已列出设备」的合并键只算一次。
  //
  // 原来命中前要对列表里每个 item 重算一次 `getScannedDeviceMergeKeys`，而 `getBluetoothDevices`
  // 轮询（见 startScan）会把整份已扫描列表重新灌进来 —— 设备越多越贵。实测（256 个已列出 /
  // 267 个重灌，桌面 Node，真机更慢）单次轮询阻塞主线程约 200ms，扫描期间每 1.5s 来一次；
  // 这段时间里点「连接」「取消」都要排队，症状就是「点一下要等一会才响应，而搜索一停就立刻
  // 响应」—— 轮询随扫描一起停。
  //
  // 轮询现在按事件流门控（见 SCAN_POLL_EVENT_FLOW_WINDOW_MS），但事件流静默的兜底平台仍会跑，
  // 这里该省的还是要省。
  //
  // 换成「合并键 -> 下标最小的持有者」之后，一轮合并从 O(N²) 降到 O(N)。语义用两点保证
  // 不变：candidate 必然 `<=` 原来 findIndex 的结果，且 candidate 本身已校验确实与
  // matchedKeys 相交，两者只能相等；万一表在本轮里失真（前面的合并让某项丢了某个键，
  // 极少见），退回原来的线性查找，结果与改动前完全一致。
  const buildScanMergeKeyIndex = (items: RingDeviceInfo[]) => {
    const index = new Map<string, number>();
    items.forEach((item, at) => {
      getScannedDeviceMergeKeys(item).forEach((key) => {
        if (!index.has(key)) index.set(key, at);
      });
    });
    return index;
  };

  const findScanMergeCandidate = (mergeKeyIndex: Map<string, number>, matchedKeys: string[]) => {
    let found = -1;
    matchedKeys.forEach((key) => {
      const at = mergeKeyIndex.get(key);
      if (at === undefined) return;
      if (found < 0 || at < found) found = at;
    });
    return found;
  };

  // 业务扫描（`includeUnknown: true`）要保留的是「协议已识别成 rw / qkeer-v2 的设备」和
  // 「名字命中 legacy 戒指前缀的设备」，**不是「附近所有蓝牙设备」** —— 后者是 rw adapter
  // 的 `isAllowedBusinessScanDevice` 早就否掉的语义，legacy 这边却写成了
  // 「`includeUnknown` 为真就一律放行」，于是商场/办公室里上百台无关设备（实测日志里
  // `EDIFIER BLE` / `LAPTOP-BQ7R2O3M` / 随机 base64 名字）全被灌进 `state.devices`，
  // 列表涨到 252 台，每一包广播都要在 252 行的表上做一遍合并 —— 这才是上面那个
  // 「逻辑层被占住 10 秒」的直接来源。这里与 rw 侧对齐：
  // 名字认不出是戒指、协议也认不出是 rw/v2 的设备，一律不进列表。
  const isResolvedRingScanDevice = (device: any, name: string, protocol: string) => {
    if (protocol === 'rw' || protocol === 'qkeer-v2') return true;
    // 名字字段各家平台填得不一样（`name` / `localName` / `bleName`），
    // `resolveRingProtocol` 认的那几个字段这里也要一起认，避免漏掉真戒指。
    const names = [name, device?.bleName, device?.displayName, device?.deviceName].map((candidate) => (candidate ? `${candidate}` : ''));
    return names.some((candidate) => isTargetDevice(candidate, scanPrefixes) || isTargetDevice(candidate, BUSINESS_SCAN_EXTRA_NAME_PREFIXES));
  };

  const mergeScannedDevices = (devices: any[], source = 'unknown') => {
    if (!state.isScanning.value || !Array.isArray(devices)) return;
    appendRawScanDiagnosticLogs(devices, source);
    const platform = uni.getSystemInfoSync().platform?.toLowerCase?.() || '';
    let mergedCount = 0;
    let filteredByPrefixCount = 0;
    const mergeKeyIndex = buildScanMergeKeyIndex(state.devices.value);

    devices.forEach((device: any) => {
      const name = device.name || device.localName;
      const protocol = resolveRingProtocol(device);
      // `includeUnknown` 只放宽「要不要认得 rw/v2 这类跨协议候选」，并不放宽
      // 「认不出的杂项设备也要收」—— 见 isResolvedRingScanDevice 上的注释。
      const allowed = !includeUnknownScanDevices && protocol === 'legacy' ? isTargetDevice(name, scanPrefixes) : isResolvedRingScanDevice(device, name, protocol);
      if (!allowed) {
        filteredByPrefixCount += 1;
        return;
      }
      mergedCount += 1;

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
        // RW/QKeer advertisements already expose the canonical business MAC.
        // The generic tail parser reverses the last six bytes for legacy rings,
        // so it must not overwrite the protocol-specific decoded identity.
        mac: advertis?.macInfo || parsedMac || device.mac,
        lastSeenAt: Date.now()
      };
      const matchedKeys = getScannedDeviceMergeKeys(matchedDevice);
      appendScanDeviceRecordLog(device, matchedDevice, parsedMac, getAdvertisHex(device.advertisData), matchedKeys);
      let existingIndex = findScanMergeCandidate(mergeKeyIndex, matchedKeys);
      if (existingIndex >= 0) {
        const candidateKeys = getScannedDeviceMergeKeys(state.devices.value[existingIndex]);
        if (!candidateKeys.some((key) => matchedKeys.includes(key))) {
          // 表失真时的兜底：走原来的线性查找，结果与改动前逐字一致。
          existingIndex = state.devices.value.findIndex((item) => getScannedDeviceMergeKeys(item).some((key) => matchedKeys.includes(key)));
        }
      }

      if (existingIndex >= 0) {
        const previous = state.devices.value[existingIndex];
        const merged: RingDeviceInfo = {
          ...previous,
          ...matchedDevice,
          displayName: matchedDevice.displayName || previous.displayName,
          name: matchedDevice.name || previous.name,
          localName: matchedDevice.localName || previous.localName,
          protocol: matchedDevice.protocol === 'legacy' ? previous.protocol || matchedDevice.protocol : matchedDevice.protocol,
          uniMacId: matchedDevice.uniMacId || previous.uniMacId
        };
        state.devices.value.splice(existingIndex, 1, merged);
        // 合并后可能多解析出键（例如 advertis 解出了 macInfo），补进表里；已有映射不动，
        // 表里存的是「下标最小的持有者」。表每轮重建，不存在跨轮过期。
        getScannedDeviceMergeKeys(merged).forEach((key) => {
          if (!mergeKeyIndex.has(key)) mergeKeyIndex.set(key, existingIndex);
        });
        return;
      }

      state.devices.value.push(matchedDevice);
      matchedKeys.forEach((key) => {
        if (!mergeKeyIndex.has(key)) mergeKeyIndex.set(key, state.devices.value.length - 1);
      });
    });
    reportScanBatch(source, devices.length, mergedCount, filteredByPrefixCount);
  };

  const flushPendingScanDevices = () => {
    if (scanMergeTimer) {
      clearTimeout(scanMergeTimer);
      scanMergeTimer = null;
    }
    if (pendingScanDevices.size === 0) return;
    // 先取走再合并：合并过程里若又收到广播，会重新开一个窗口，不会丢。
    const buffered = Array.from(pendingScanDevices.values());
    pendingScanDevices = new Map();
    mergeScannedDevices(buffered, 'onBluetoothDeviceFound');
  };

  const schedulePendingScanFlush = () => {
    if (scanMergeTimer) return;
    scanMergeTimer = setTimeout(() => {
      scanMergeTimer = null;
      flushPendingScanDevices();
    }, SCAN_EVENT_MERGE_INTERVAL_MS);
  };

  const handleDeviceFound = (result: any) => {
    // 事件计数和「最近一次广播时刻」必须按**收到**的时间算：整表轮询靠它判断事件流还活着。
    scanDeviceEventCount += 1;
    lastScanDeviceEventAt = Date.now();
    if (!state.isScanning.value) return;

    const devices = Array.isArray(result?.devices) ? result.devices : [];
    // 原始广播记录（只有绑定设备的诊断扫描才开）必须按**包**记，不能等合并：
    // 缓冲按 deviceId 去重，只留最后一份，同一台设备在一个窗口内变过的 advertisData
    // 会被吃掉 —— 而抓广播原文正是这类扫描存在的理由。`rawScanDiagnostic` 没开时
    // 这个调用在第一行就返回，业务扫描不受影响。
    appendRawScanDiagnosticLogs(devices, 'onBluetoothDeviceFound');
    devices.forEach((device: any) => {
      // `deviceId` 是原生侧的稳定标识；拿不到时退回名字做粗粒度去重。
      const key = device?.deviceId ? `id:${device.deviceId}` : `nm:${device?.name || device?.localName || ''}`;
      pendingScanDevices.set(key, device);
    });
    if (pendingScanDevices.size > 0) schedulePendingScanFlush();
  };

  const stopScan = () => {
    // 停扫描要让在途的那一轮 startScan 变成 stale：否则它迟到的 success
    // 会在停机之后重新拉起整表轮询，留下一个没人回收的定时器。
    scanInvocationGeneration += 1;
    return new Promise<unknown>((resolve) => {
      if (scanTimeout) {
        clearTimeout(scanTimeout);
        scanTimeout = null;
      }
      if (scanPollTimer) {
        clearInterval(scanPollTimer);
        scanPollTimer = null;
      }
      if (scanCallbackWatchdog) {
        clearTimeout(scanCallbackWatchdog);
        scanCallbackWatchdog = null;
      }

      offBluetoothDeviceFound(handleDeviceFound);
      // 停扫描前先把攒下的广播合并掉：Android 上事件流是活的、整表轮询被门控跳过，
      // 直接丢掉这个窗口就等于丢掉最后 250ms 里新出现的设备。
      flushPendingScanDevices();

      if (!state.isScanning.value) {
        finishRawScanDiagnostic('already-stopped');
        resolve(undefined);
        return;
      }

      appendRingDiagnosticLog('L19 BLE', 'legacy-scan-stop', {
        listed: state.devices.value.length,
        // 'none' = startBluetoothDevicesDiscovery 的 success/fail 一个都没回，
        // 即 Android 的静默失败：native 扫描可能已在跑，但 JS 侧一无所知。
        startCallback: scanStartCallbackState
      });
      // 自己的扫描标志不能押在平台回调上：stopBluetoothDevicesDiscovery 在部分机型
      // 或异常态下两个回调都不触发，那样 isScanning 会永远停在 true，之后每一次
      // startScan 都被开头的短路静默吃掉（症状就是「扫描毫无反应、日志一片空白」）。
      // rw adapter 的 stopScan 早就是先置位再调用，这里与之对齐。
      state.isScanning.value = false;
      // 同上：两个回调都可能不触发。扫描标志已经先置位了，但 Promise 本身还有调用方
      // 在 await（连接流程 / 切后台清理），不能让它一直挂着——超时按「已停止」收尾。
      let settled = false;
      let stopTimeout: ReturnType<typeof setTimeout> | null = null;
      const settleScanStop = (result: unknown, reason: string) => {
        if (settled) return;
        settled = true;
        if (stopTimeout) clearTimeout(stopTimeout);
        finishRawScanDiagnostic(reason);
        resolve(result);
      };
      stopTimeout = setTimeout(() => {
        appendRingDiagnosticLog('L19 BLE', 'legacy-scan-stop-timeout', { timeoutMs: LEGACY_SCAN_STOP_TIMEOUT_MS });
        settleScanStop(undefined, 'stop-timeout');
      }, LEGACY_SCAN_STOP_TIMEOUT_MS);
      uni.stopBluetoothDevicesDiscovery({
        success: (result) => settleScanStop(result, 'stop-success'),
        fail: (error) => settleScanStop(error, 'stop-fail')
      });
    });
  };

  const startScan = (options: LegacyScanOptions = {}) => {
    if (state.isScanning.value) {
      // 以前这里是一行纯静默 return：上一次扫描没被正确收尾时，后续每次扫描都被它
      // 悄悄吃掉，外面只能看到「点了扫描毫无反应」，日志里一条都不剩。
      appendRingDiagnosticLog('L19 BLE', 'legacy-scan-skip-already-scanning', {
        includeUnknown: Boolean(options.includeUnknown),
        timeoutMs: options.timeoutMs ?? 20000
      });
      return Promise.resolve(undefined);
    }

    scanPrefixes = options.prefixes?.length ? options.prefixes : DEFAULT_SCAN_PREFIXES;
    includeUnknownScanDevices = Boolean(options.includeUnknown);
    rawScanDiagnostic =
      options.diagnosticLogAllDevices || options.diagnosticBoundMac
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
    lastScanBatchSignature = '';
    lastScanDeviceEventAt = 0;
    scanDeviceEventCount = 0;
    // 上一轮扫描残留的缓冲不能带进新的一轮。
    if (scanMergeTimer) {
      clearTimeout(scanMergeTimer);
      scanMergeTimer = null;
    }
    pendingScanDevices = new Map();
    // 无绑定扫描在日志里原本完全没有起点标记（`scan-device-raw-start` 只对 bound 扫描开），
    // 有了这条才能把「页面已经请求扫描」和「适配器真的开始扫描」区分开。
    appendRingDiagnosticLog('L19 BLE', 'legacy-scan-start', {
      prefixes: scanPrefixes,
      includeUnknown: includeUnknownScanDevices,
      allowDuplicatesKey: options.allowDuplicatesKey ?? true,
      preserveDevices: Boolean(options.preserveDevices),
      timeoutMs: options.timeoutMs ?? 20000
    });
    // 这一段必须兜住：它在 Promise 之外，任何同步异常都会直接掐死整次扫描，
    // 而症状是「无报错、无 toast、列表为空、日志只剩 legacy-scan-start」——
    // 这个项目 App 端最难查的一类故障就是这么来的。兜住后至少留下 errMsg。
    try {
      offBluetoothDeviceFound(handleDeviceFound);
      if (scanPollTimer) {
        clearInterval(scanPollTimer);
        scanPollTimer = null;
      }

      scanTimeout = setTimeout(() => {
        void stopScan();
      }, options.timeoutMs ?? 20000);
    } catch (error) {
      // 扫描没能起步，标志位必须复位，否则后续每次点击都会被开头那句
      // `if (state.isScanning.value) return` 静默吃掉。
      state.isScanning.value = false;
      appendRingDiagnosticLog('L19 BLE', 'legacy-scan-preflight-failed', {
        ...describeScanError(error)
      });
      return Promise.reject(error);
    }

    const invocationGeneration = ++scanInvocationGeneration;
    const isStaleInvocation = () => invocationGeneration !== scanInvocationGeneration;

    const startScanPolling = () => {
      if (scanPollTimer) return;
      scanPollDueAt = Date.now() + SCAN_POLL_INTERVAL_MS;
      scanPollTimer = setInterval(() => {
        const now = Date.now();
        // 上一次轮询到这一次之间多等了多少毫秒。定时器不会早触发，所以负数只可能是
        // 计时器精度抖动；>= 阈值就说明这段窗口里逻辑层被占住了。
        const lateMs = now - scanPollDueAt;
        scanPollDueAt = now + SCAN_POLL_INTERVAL_MS;
        if (lateMs >= SCAN_POLL_LATE_LOG_MS) {
          appendRingDiagnosticLog('L19 BLE', 'legacy-scan-poll-late', {
            lateMs,
            events: scanDeviceEventCount,
            sinceLastEventMs: lastScanDeviceEventAt ? now - lastScanDeviceEventAt : -1,
            listed: state.devices.value.length
          });
        }
        scanDeviceEventCount = 0;
        // 事件上报是活的：整表重合并纯属重复劳动，跳过（见 SCAN_POLL_EVENT_FLOW_WINDOW_MS）。
        if (lastScanDeviceEventAt && now - lastScanDeviceEventAt < SCAN_POLL_EVENT_FLOW_WINDOW_MS) return;
        uni.getBluetoothDevices({
          success: (devicesResult) => mergeScannedDevices(devicesResult.devices, 'getBluetoothDevices'),
          fail: () => undefined
        });
      }, SCAN_POLL_INTERVAL_MS);
    };

    return new Promise<unknown>((resolve, reject) => {
      // 这条紧挨着平台调用：有它才能区分「调用真的发出去了」和「调用之前就抛了」——
      // 这两种故障在日志里原本都只剩一片空白。
      appendRingDiagnosticLog('L19 BLE', 'legacy-scan-armed', {
        allowDuplicatesKey: options.allowDuplicatesKey ?? true
      });
      scanStartCallbackState = 'none';
      if (scanCallbackWatchdog) clearTimeout(scanCallbackWatchdog);
      scanCallbackWatchdog = setTimeout(() => {
        scanCallbackWatchdog = null;
        appendRingDiagnosticLog('L19 BLE', 'legacy-scan-discovery-no-callback', {
          waitedMs: SCAN_CALLBACK_WATCHDOG_MS
        });
        if (isStaleInvocation()) return;
        // 平台静默失败时调用方不能永远挂着：按「已在扫描」结算，
        // 广播监听早已注册，同时把整表轮询这条兜底通道开起来。
        startScanPolling();
        resolve(undefined);
      }, SCAN_CALLBACK_WATCHDOG_MS);
      // 必须先注册再调用（rw/adapter 就是这么做的）。Android 上 startBluetoothDevicesDiscovery
      // 存在「不报错、success/fail 一个都不回」的静默失败，此时 native 扫描其实已经在跑；
      // 原来把注册放在 success 里，这种情形下 JS 永远收不到设备广播 ——
      // 表现就是「列表为空、日志空白、也没有任何报错」。
      uni.onBluetoothDeviceFound(handleDeviceFound);
      uni.startBluetoothDevicesDiscovery({
        allowDuplicatesKey: options.allowDuplicatesKey ?? true,
        success: (result) => {
          if (isStaleInvocation()) {
            // 迟到的成功属于上一轮：不能动当前扫描的状态和定时器，只结算旧 Promise。
            resolve(result);
            return;
          }
          scanStartCallbackState = 'success';
          if (scanCallbackWatchdog) {
            clearTimeout(scanCallbackWatchdog);
            scanCallbackWatchdog = null;
          }
          appendRingDiagnosticLog('L19 BLE', 'legacy-scan-discovery-success', {
            allowDuplicatesKey: options.allowDuplicatesKey ?? true
          });
          startScanPolling();
          resolve(result);
        },
        fail: (error) => {
          scanStartCallbackState = 'fail';
          if (scanCallbackWatchdog) {
            clearTimeout(scanCallbackWatchdog);
            scanCallbackWatchdog = null;
          }
          // 这条以前也只 reject、不记日志，于是「扫描起不来」在日志里完全不可见。
          appendRingDiagnosticLog('L19 BLE', 'legacy-scan-discovery-fail', describeScanError(error));
          if (isStaleInvocation()) {
            reject(error);
            return;
          }
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
          if (scanMergeTimer) {
            clearTimeout(scanMergeTimer);
            scanMergeTimer = null;
          }
          pendingScanDevices = new Map();
          reject(error);
        }
      });
    });
  };

  const readBleMtu = (deviceId: string) =>
    withTimeout(
      new Promise<{
        supported: boolean;
        ok: boolean;
        mtu: number | null;
        result?: unknown;
        error?: unknown;
      }>((resolve) => {
        const getBLEMTU = (uni as any).getBLEMTU;
        if (typeof getBLEMTU !== 'function') {
          resolve({ supported: false, ok: false, mtu: null });
          return;
        }
        getBLEMTU({
          deviceId,
          writeType: 'writeNoResponse',
          success: (result: Record<string, unknown>) => {
            const actualMtu = Number(result?.mtu);
            resolve({
              supported: true,
              ok: Number.isFinite(actualMtu) && actualMtu > 0,
              mtu: Number.isFinite(actualMtu) && actualMtu > 0 ? actualMtu : null,
              result
            });
          },
          fail: (error: unknown) => resolve({ supported: true, ok: false, mtu: null, error })
        });
      }),
      LEGACY_QUIET_BLE_CALL_TIMEOUT_MS,
      'Get BLE MTU timeout.'
    ).catch(() => ({ supported: true, ok: false, mtu: null, error: new Error('getBLEMTU timed out') }));

  const requestBleMtu = (deviceId: string, mtu: number) =>
    withTimeout(
      new Promise<{ ok: boolean; result?: unknown; error?: unknown }>((resolve) => {
        const setBLEMTU = (uni as any).setBLEMTU;
        if (typeof setBLEMTU !== 'function') {
          resolve({ ok: false, error: new Error('setBLEMTU API unavailable') });
          return;
        }
        setBLEMTU({
          deviceId,
          mtu,
          success: (result: unknown) => resolve({ ok: true, result }),
          fail: (error: unknown) => resolve({ ok: false, error })
        });
      }),
      LEGACY_QUIET_BLE_CALL_TIMEOUT_MS,
      'Set BLE MTU timeout.'
    ).catch(() => ({ ok: false, error: new Error('setBLEMTU timed out') }));

  const setMTU = async (deviceId: string, mtu = LEGACY_TARGET_MTU) => {
    const systemInfo = uni.getSystemInfoSync();
    const platform = `${systemInfo.platform || ''}`.trim().toLowerCase();
    const system = `${systemInfo.system || ''}`.trim().toLowerCase();
    // HarmonyOS/OpenHarmony reports `ohos`, not `android`, even though its
    // WeChat BLE bridge supports setBLEMTU. Restricting this to exactly
    // `android` left Huawei phones at the default MTU 23.
    const shouldNegotiate = platform === 'android' || platform === 'ohos' || system.includes('android') || system.includes('harmony');
    if (!shouldNegotiate) {
      appendRingDiagnosticLog('L19 BLE', 'legacy-mtu-negotiation-skipped', {
        deviceId,
        platform,
        system,
        reason: 'platform-does-not-require-explicit-negotiation'
      });
      return { skipped: true, platform, system };
    }

    const startedAt = Date.now();
    const before = await readBleMtu(deviceId);
    const attempts: Array<{
      attempt: number;
      request: Awaited<ReturnType<typeof requestBleMtu>>;
      actual: Awaited<ReturnType<typeof readBleMtu>>;
    }> = [];

    for (let attempt = 1; attempt <= LEGACY_MTU_MAX_ATTEMPTS; attempt += 1) {
      const request = await requestBleMtu(deviceId, mtu);
      await sleep(150);
      const actual = await readBleMtu(deviceId);
      attempts.push({ attempt, request, actual });

      // A rejected platform call is not improved by immediately repeating the
      // same request. Preserve the historical behaviour of continuing GATT
      // setup after one failed MTU request. Retry only when the request was
      // accepted but getBLEMTU proves the negotiated value is still too low.
      if (!request.ok) break;

      // Older WeChat bases may support setting MTU without exposing getBLEMTU.
      // In that case a successful set request is the strongest available proof.
      const verified = actual.supported ? actual.ok && Number(actual.mtu) >= LEGACY_HISTORY_MINIMUM_MTU : request.ok;
      if (verified) break;
      if (attempt < LEGACY_MTU_MAX_ATTEMPTS) await sleep(250);
    }

    const lastAttempt = attempts[attempts.length - 1];
    const actualMtu = lastAttempt?.actual.mtu ?? before.mtu;
    const verified = lastAttempt?.actual.supported ? lastAttempt.actual.ok && Number(actualMtu) >= LEGACY_HISTORY_MINIMUM_MTU : Boolean(lastAttempt?.request.ok);
    const result = {
      verified,
      deviceId,
      platform,
      system,
      requestedMtu: mtu,
      minimumHistoryMtu: LEGACY_HISTORY_MINIMUM_MTU,
      before,
      actualMtu,
      attempts,
      elapsedMs: Date.now() - startedAt
    };

    appendRingDiagnosticLog('L19 BLE', verified ? 'legacy-mtu-negotiation-verified' : 'legacy-mtu-negotiation-insufficient', result);
    return result;
  };

  const getConnectedLegacyDeviceIds = (): Promise<string[]> => {
    return withTimeout<string[]>(
      new Promise<string[]>((resolve) => {
        uni.getConnectedBluetoothDevices({
          services: [LEGACY_PRIMARY_SERVICE_UUID],
          success: (result) => {
            const deviceIds = (result.devices || []).map((device: { deviceId?: string }) => String(device?.deviceId || ''));
            resolve(deviceIds.filter((deviceId) => deviceId.length > 0));
          },
          fail: () => resolve([])
        });
      }),
      LEGACY_QUIET_BLE_CALL_TIMEOUT_MS,
      'Get connected BLE devices timeout.'
    ).catch((): string[] => []);
  };

  const closeBleConnectionQuietly = (deviceId: string) => {
    if (!deviceId) return Promise.resolve(undefined);
    return withTimeout(
      new Promise<unknown>((resolve) => {
        uni.closeBLEConnection({
          deviceId,
          success: resolve,
          fail: resolve
        });
      }),
      LEGACY_QUIET_BLE_CALL_TIMEOUT_MS,
      'Close BLE connection timeout.'
    ).catch(() => undefined);
  };

  const createBleConnectionOnce = (deviceId: string, deviceName = '') => {
    return withTimeout(
      new Promise<RingDeviceInfo>((resolve, reject) => {
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
      }),
      LEGACY_CONNECT_CALL_TIMEOUT_MS,
      'Create BLE connection timeout.'
    );
  };

  const connectDevice = async (deviceId: string, deviceName = '', sourceDevice?: RingDeviceInfo) => {
    const identitySource = sourceDevice as (RingDeviceInfo & { uniMacId?: string; mac?: string }) | undefined;
    const stableDeviceIdentity = normalizeBleIdentifier(identitySource?.uniMacId || identitySource?.mac);
    const hasMappedTransportIdentity = Boolean(stableDeviceIdentity && stableDeviceIdentity !== normalizeBleIdentifier(deviceId));
    const maxAttempts = LEGACY_CREATE_CONNECTION_RETRY_DELAYS_MS.length;
    const connectStartedAt = Date.now();
    let lastError: unknown;
    // 映射身份的超时重试是最慢的路径（每次要等满平台 10s 超时）。保留历史上
    // 的一次性重试语义，避免把等待时间叠到外层连接超时之后。
    let mappedTimeoutRetryUsed = false;

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      const attempt = attemptIndex + 1;
      try {
        return { ...sourceDevice, ...(await createBleConnectionOnce(deviceId, deviceName)) };
      } catch (error) {
        lastError = error;
        const hasAttemptLeft = attemptIndex < maxAttempts - 1;

        // OS 报"已连接"不代表链路可用：先确认目标确实在已连接列表里，
        // 否则按普通失败清理后重试，避免带着残留句柄继续发现服务。
        if (isAlreadyConnectedError(error)) {
          const connectedDeviceIds = await getConnectedLegacyDeviceIds();
          if (connectedDeviceIds.includes(deviceId)) {
            return { ...sourceDevice, deviceId, name: deviceName, protocol: 'legacy' as const };
          }
          appendRingDiagnosticLog('L19 BLE', 'already-connected-target-retry-without-closing-others', {
            deviceId,
            connectedDeviceIds,
            attempt,
            maxAttempts,
            cooldownMs: LEGACY_ALREADY_CONNECTED_RETRY_DELAY_MS,
            error: formatLegacyBleError(error)
          });
          if (!hasAttemptLeft) throw error;
          await closeBleConnectionQuietly(deviceId);
          await sleep(LEGACY_ALREADY_CONNECTED_RETRY_DELAY_MS);
          continue;
        }

        const mappedTimeoutRetry = !mappedTimeoutRetryUsed && hasMappedTransportIdentity && isBleConnectOperateTimeout(error);
        const transientRetry = isTransientLegacyConnectFailure(error);
        const retriable = mappedTimeoutRetry || transientRetry;
        appendRingDiagnosticLog('L19 BLE', retriable && hasAttemptLeft ? 'legacy-connect-retry' : 'legacy-connect-giveup', {
          deviceId,
          stableDeviceIdentity,
          attempt,
          maxAttempts,
          mappedTimeoutRetry,
          transientRetry,
          elapsedTotalMs: Date.now() - connectStartedAt,
          error: formatLegacyBleError(error)
        });
        if (!retriable || !hasAttemptLeft) throw error;

        if (mappedTimeoutRetry) mappedTimeoutRetryUsed = true;
        await closeBleConnectionQuietly(deviceId);
        await sleep(mappedTimeoutRetry ? LEGACY_MAPPED_IDENTITY_TIMEOUT_RETRY_DELAY_MS : LEGACY_CREATE_CONNECTION_RETRY_DELAYS_MS[attemptIndex + 1] || 0);
      }
    }

    throw lastError;
  };

  const connectAndDiscover = async (deviceId: string, deviceName = '', sourceDevice?: RingDeviceInfo) => {
    await connectDevice(deviceId, deviceName, sourceDevice);
    await setMTU(deviceId);
    const cachedDevice = await restoreCachedGattProfile(deviceId, deviceName, sourceDevice);
    if (cachedDevice) return cachedDevice;
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

  const getLegacyGattCacheKey = (deviceId: string, sourceDevice?: RingDeviceInfo) => {
    const source = (sourceDevice || {}) as RingDeviceInfo & {
      uniMacId?: string;
      mac?: string;
      deviceMac?: string;
      normalMac?: string;
      advertis?: { macInfo?: string };
    };
    return normalizeBleIdentifier(source.uniMacId || source.mac || source.deviceMac || source.normalMac || source.advertis?.macInfo || deviceId);
  };

  const readGattCache = (): Record<string, string | LegacyGattCacheEntry> => {
    try {
      const cache = uni.getStorageSync(SERVICE_CACHE_KEY);
      return cache && typeof cache === 'object' ? cache : {};
    } catch {
      return {};
    }
  };

  const cacheServiceId = (mac: string, serviceId: string) => {
    const cacheKey = normalizeBleIdentifier(mac);
    if (!cacheKey || !serviceId) return;
    const cache = readGattCache();
    const previous = cache[cacheKey];
    cache[cacheKey] = {
      ...(previous && typeof previous === 'object' ? previous : {}),
      serviceId,
      updatedAt: Date.now()
    };
    uni.setStorageSync(SERVICE_CACHE_KEY, cache);
  };

  const getCachedServiceId = (mac: string) => {
    const cacheKey = normalizeBleIdentifier(mac);
    const cached = readGattCache()[cacheKey];
    return typeof cached === 'string' ? cached : cached?.serviceId || '';
  };

  const cacheGattProfile = (deviceId: string, sourceDevice: RingDeviceInfo | undefined, profile: LegacyGattCacheEntry) => {
    const cacheKey = getLegacyGattCacheKey(deviceId, sourceDevice);
    if (!cacheKey || !profile.serviceId || !profile.cmdCharId || !profile.dataCharId) return;
    const cache = readGattCache();
    cache[cacheKey] = { ...profile, updatedAt: Date.now() };
    uni.setStorageSync(SERVICE_CACHE_KEY, cache);
  };

  const invalidateGattProfile = (deviceId: string, sourceDevice?: RingDeviceInfo) => {
    const cacheKey = getLegacyGattCacheKey(deviceId, sourceDevice);
    if (!cacheKey) return;
    const cache = readGattCache();
    if (!(cacheKey in cache)) return;
    delete cache[cacheKey];
    uni.setStorageSync(SERVICE_CACHE_KEY, cache);
  };

  const restoreCachedGattProfile = async (deviceId: string, deviceName = '', sourceDevice?: RingDeviceInfo) => {
    const cacheKey = getLegacyGattCacheKey(deviceId, sourceDevice);
    const cached = readGattCache()[cacheKey];
    if (!cached || typeof cached !== 'object') return null;
    if (!cached.serviceId || !cached.cmdCharId || !cached.dataCharId) return null;
    if (cached.updatedAt && Date.now() - cached.updatedAt > LEGACY_GATT_CACHE_TTL_MS) {
      invalidateGattProfile(deviceId, sourceDevice);
      return null;
    }

    const deviceInfo: RingDeviceInfo = {
      ...(sourceDevice || {}),
      deviceId,
      name: deviceName,
      serviceId: cached.serviceId,
      cmdCharId: cached.cmdCharId,
      dataCharId: cached.dataCharId,
      protocol: 'legacy'
    };
    legacyCommandWriteType = cached.writeType === 'write' ? 'write' : 'writeNoResponse';
    setupDataListener(deviceInfo);
    try {
      await withTimeout(enableNotify(deviceId, cached.serviceId, cached.dataCharId), 3000, 'Enable cached BLE notify timeout.');
      appendRingDiagnosticLog('L19 BLE', 'legacy-gatt-cache-hit', {
        deviceId,
        cacheKey,
        serviceId: cached.serviceId,
        cmdCharId: cached.cmdCharId,
        dataCharId: cached.dataCharId,
        writeType: legacyCommandWriteType
      });
      return { ...deviceInfo, notifyEnabled: true };
    } catch (error) {
      invalidateGattProfile(deviceId, sourceDevice);
      appendRingDiagnosticLog('L19 BLE', 'legacy-gatt-cache-invalidated', {
        deviceId,
        cacheKey,
        reason: 'notify-enable-failed',
        error: formatLegacyBleError(error)
      });
      return null;
    }
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
    const characteristicResult: any = await withTimeout(
      new Promise((resolve, reject) => {
        uni.getBLEDeviceCharacteristics({
          deviceId,
          serviceId,
          success: resolve,
          fail: reject
        });
      }),
      LEGACY_GATT_CELL_TIMEOUT_MS,
      'Get BLE characteristics timeout.'
    );

    if (!Array.isArray(characteristicResult.characteristics)) {
      throw new Error('BLE characteristics are unavailable.');
    }

    let cmdCharId = '';
    let dataCharId = '';
    let discoveredCommandWriteType: 'write' | 'writeNoResponse' = 'writeNoResponse';
    let discoveredCommandProperties: Record<string, unknown> = {};

    for (const characteristic of characteristicResult.characteristics) {
      // WeChat exposes this capability as `writeNoResponse`. A few platform
      // typings/bridges call the same bit `writeWithoutResponse`, so accept both
      // names. Using only the latter made Harmony select ordinary `write` even
      // though the ring advertises write-without-response, which then fails
      // locally with errCode 10007 (`property not support`).
      const supportsWriteNoResponse = Boolean(characteristic.properties?.writeNoResponse || characteristic.properties?.writeWithoutResponse);
      if (!cmdCharId && (characteristic.properties?.write || supportsWriteNoResponse)) {
        cmdCharId = characteristic.uuid;
        // The pre-SDK implementation did not force a write type, and WeChat
        // selected write-without-response for this L19 command channel. Some
        // phones expose both flags but reject an explicit ordinary `write`
        // with errCode 10007, so prefer the mode proven to work on-device.
        discoveredCommandWriteType = supportsWriteNoResponse ? 'writeNoResponse' : 'write';
        discoveredCommandProperties = { ...(characteristic.properties || {}) };
      }

      if (!dataCharId && characteristic.properties?.notify) {
        dataCharId = characteristic.uuid;
      }

      if (cmdCharId && dataCharId) break;
    }

    if (!cmdCharId) throw new Error('Writable command characteristic was not found.');
    if (!dataCharId) throw new Error('Notify data characteristic was not found.');

    const deviceInfo = {
      ...(sourceDevice || {}),
      deviceId,
      name: deviceName,
      serviceId,
      cmdCharId,
      dataCharId,
      protocol: 'legacy' as const
    };

    legacyCommandWriteType = discoveredCommandWriteType;
    appendRingDiagnosticLog('L19 BLE', 'legacy-command-characteristic-selected', {
      deviceId,
      serviceId,
      cmdCharId,
      writeType: legacyCommandWriteType,
      writeTypeStrategy: 'direct-notify-prefer-write-no-response',
      properties: discoveredCommandProperties
    });
    setupDataListener(deviceInfo);
    await withTimeout(enableNotify(deviceId, serviceId, dataCharId), 5000, 'Enable BLE notify timeout.');
    cacheGattProfile(deviceId, sourceDevice, {
      serviceId,
      cmdCharId,
      dataCharId,
      writeType: legacyCommandWriteType
    });
    appendRingDiagnosticLog('L19 BLE', 'legacy-direct-notify-ready', {
      deviceId,
      serviceId,
      cmdCharId,
      dataCharId,
      writeType: legacyCommandWriteType,
      appConnect: 'skipped-pre-sdk-flow'
    });

    return { ...deviceInfo, notifyEnabled: true };
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
        listenerIdentityKey: dataListenerIdentityKey,
        closeConnection: true
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

    // closeBLEConnection 在部分机型上不回调；断开不能因此永远挂住。
    return withTimeout(
      new Promise<unknown>((resolve) => {
        uni.closeBLEConnection({
          deviceId,
          success: resolve,
          fail: resolve
        });
      }),
      3000,
      'Legacy close BLE connection timeout.'
    ).catch(() => undefined);
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
      // 会话结束后再注销监听器，避免 cleanup 被历史同步挡住后它们一直注册着。
      cancelCleanupIdleWait?.();
      cancelCleanupIdleWait = onLegacyBleCommandSessionIdle(() => {
        cancelCleanupIdleWait?.();
        cancelCleanupIdleWait = null;
        clearConnectionStateListener();
        clearBluetoothAdapterStateListener();
      }, runtime?.getDeviceInfo?.());
      return;
    }
    cancelCleanupIdleWait?.();
    cancelCleanupIdleWait = null;
    clearConnectionStateListener();
    clearBluetoothAdapterStateListener();
  };

  const sendBytes = (bytes: Uint8Array, label = '') => {
    const queueSeq = ++legacyCommandWriteQueueSeq;
    const queueGeneration = legacyCommandWriteQueueGeneration;
    const queuedAt = Date.now();
    const frame = summarizeLegacyBleFrame(bytes, label);
    const useL19PlatformDefaultHistoryWrite = Boolean(isL19HistoryDevice() && bytes.length >= 3 && bytes[2] === 0x36);
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

        const { deviceId, serviceId, cmdCharId } = ensureWriteDevice(runtime, pendingCommandDevice);
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

        const writeValue = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
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
            ...(useL19PlatformDefaultHistoryWrite ? {} : { writeType: legacyCommandWriteType }),
            success: (result) => {
              appendRingDiagnosticLog('L19 BLE', settled ? 'legacy-command-write-late-result' : 'legacy-command-write-result', {
                queueSeq,
                elapsedMs: Date.now() - startedAt,
                deviceId,
                serviceId,
                characteristicId: cmdCharId,
                writeType: useL19PlatformDefaultHistoryWrite ? 'platform-default' : legacyCommandWriteType,
                historyCompatibility: useL19PlatformDefaultHistoryWrite ? 'l19' : undefined,
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
                writeType: useL19PlatformDefaultHistoryWrite ? 'platform-default' : legacyCommandWriteType,
                historyCompatibility: useL19PlatformDefaultHistoryWrite ? 'l19' : undefined,
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
    const payload = concatBytes(numberToUint64LE(timestampMs), new Uint8Array([timezone, getLegacyPlatformType()]));
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
      payloadHex: Array.from(payload)
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase(),
      timeoutMs
    });
    const ackPromise = waitForRawFrame((value) => value.length >= 4 && value[1] === frameId && value[2] === 0xa0 && value[3] === 0x01, timeoutMs);
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
      useConservativeAppConnectSettle = false;
      appendRingDiagnosticLog('L19 BLE', 'legacy-app-connect-result', {
        deviceId: runtime?.getDeviceInfo().deviceId,
        frameId,
        elapsedMs: Date.now() - startedAt,
        ackHex: Array.from(ack)
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()
      });
      return { writeResult, ack, frameId };
    } catch (error) {
      useConservativeAppConnectSettle = true;
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
    appendRingDiagnosticLog('L19 BLE', 'legacy-app-connect-skipped', {
      reason: 'pre-sdk-direct-notify-flow',
      deviceId: runtime?.getDeviceInfo().deviceId,
      writeType: legacyCommandWriteType,
      connectionGeneration: currentGeneration
    });
    return { skipped: true, reason: 'pre-sdk-direct-notify-flow' };
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
    const physicalIdentity = `${identityDevice.uniMacId || identityDevice.mac || identityDevice.advertis?.macInfo || deviceId}`.toLowerCase();
    const identityKey = `${physicalIdentity}|${serviceId}|${dataCharId}`.toLowerCase();
    if (dataListenerHandler && dataListenerIdentityKey === identityKey) {
      dataListenerDeviceId = deviceId;
      dataListenerStableDeviceId = physicalIdentity;
      dataListenerServiceId = serviceId;
      dataListenerDataCharId = dataCharId;
      dataListenerDeviceName = identityDevice.name || '';
      dataListenerNormalizedIdentityLogged = false;
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
      const replacingPhysicalDevice = Boolean(dataListenerStableDeviceId && dataListenerStableDeviceId !== physicalIdentity);
      // A device switch can update runtime.getDeviceInfo() before the previous
      // history waiter has settled. Looking up the session with the new device
      // identity then misses the old lease, allowing the old waiter to consume
      // packets from the new ring. On a genuine physical-device switch only,
      // terminate that stale lease/listener before registering the new one.
      const session = replacingPhysicalDevice
        ? getLegacyBleHistoryExclusiveSnapshot(dataListenerStableDeviceId)
        : getLegacyBleHistoryExclusiveSnapshot(runtime?.getDeviceInfo?.() || deviceId);
      if (replacingPhysicalDevice) {
        appendRingDiagnosticLog('L19 BLE', 'legacy-data-listener-device-switch-preempt', {
          deviceId,
          serviceId,
          dataCharId,
          previousIdentityKey: dataListenerIdentityKey,
          nextIdentityKey: identityKey,
          staleSessionId: session.sessionId,
          staleDeviceKey: session.deviceKey,
          staleSessionActive: session.active,
          remainingMs: session.remainingMs
        });
        releaseLegacyBleCommandSessions(dataListenerStableDeviceId, 'physical-device-switch');
        resetLegacyCommandWriteQueue('physical-device-switch', deviceId);
        clearDataListener({
          reason: 'physical-device-switch',
          caller: 'setup-data-listener',
          sessionId: session.sessionId,
          deviceId: dataListenerDeviceId,
          force: true
        });
      } else if (session.active) {
        appendRingDiagnosticLog('L19 BLE', 'legacy-data-listener-replace-skipped-history-active', {
          deviceId,
          serviceId,
          dataCharId,
          currentIdentityKey: dataListenerIdentityKey,
          sessionId: session.sessionId
        });
        return;
      }
      if (dataListenerHandler) {
        offBleCharacteristicValueChange(dataListenerHandler);
        dataListenerHandler = null;
        dataListenerIdentityKey = '';
      }
    }

    dataListenerDeviceId = deviceId;
    dataListenerStableDeviceId = physicalIdentity;
    dataListenerServiceId = serviceId;
    dataListenerDataCharId = dataCharId;
    dataListenerDeviceName = identityDevice.name || '';
    dataListenerNormalizedIdentityLogged = false;
    dataListenerHandler = (result) => {
      const resultDeviceId = normalizeBleIdentifier(result.deviceId);
      const transportDeviceId = normalizeBleIdentifier(dataListenerDeviceId);
      const stableDeviceId = normalizeBleIdentifier(dataListenerStableDeviceId);
      const deviceMatches = resultDeviceId === transportDeviceId || resultDeviceId === stableDeviceId;
      const serviceMatches = normalizeBleIdentifier(result.serviceId) === normalizeBleIdentifier(dataListenerServiceId);
      const characteristicMatches = normalizeBleIdentifier(result.characteristicId) === normalizeBleIdentifier(dataListenerDataCharId);
      if (!deviceMatches || !serviceMatches || !characteristicMatches) return;
      if (
        !dataListenerNormalizedIdentityLogged &&
        (result.deviceId !== dataListenerDeviceId || result.serviceId !== dataListenerServiceId || result.characteristicId !== dataListenerDataCharId)
      ) {
        dataListenerNormalizedIdentityLogged = true;
        appendRingDiagnosticLog('L19 BLE', 'legacy-notify-identity-normalized', {
          callbackDeviceId: result.deviceId,
          transportDeviceId: dataListenerDeviceId,
          stableDeviceId: dataListenerStableDeviceId,
          callbackServiceId: result.serviceId,
          expectedServiceId: dataListenerServiceId,
          callbackCharacteristicId: result.characteristicId,
          expectedCharacteristicId: dataListenerDataCharId
        });
      }

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
      if (isHistoryWireNotify) {
        renewLegacyBleCommandSessionActivity(
          {
            ...runtime.getDeviceInfo(),
            deviceId: dataListenerDeviceId,
            mac: dataListenerStableDeviceId,
            uniMacId: dataListenerStableDeviceId
          },
          {
            source: 'notify',
            byteLength: notifyBytes.byteLength
          }
        );
      }
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
        const parsedItem = parsed as Record<string, any>;
        appendHistoryWireNotifyLog('legacy-history-wire-notify-parsed', result, notifyFrame, parsed);
        if (!isHistoryWireNotify) {
          appendRingDiagnosticLog('L19 BLE', 'legacy-notify-parsed', {
            deviceId: result.deviceId,
            serviceId: result.serviceId,
            characteristicId: result.characteristicId,
            ...notifyFrame,
            parsedType: parsed.type,
            status: parsedItem.status,
            recordCount: Array.isArray(parsedItem.records) ? parsedItem.records.length : undefined,
            batteryLevel: parsed.type === 'battery' ? (parsedItem.batteryLevel ?? parsedItem.battery) : undefined,
            batteryDisplay: parsed.type === 'battery' ? parsedItem.value : undefined,
            batteryStatus: parsed.type === 'battery' ? parsedItem.status : undefined,
            batteryRawValue: parsed.type === 'battery' ? parsedItem.batteryRawValue : undefined
          });
        }
        const parsedWithDevice = {
          ...parsed,
          protocol: 'legacy' as const,
          deviceId: dataListenerDeviceId,
          deviceName: dataListenerDeviceName
        };

        for (const waiter of [...parsedWaiters]) {
          const hasMatchingActivity = waiter.resetTimeoutOnData && (waiter.activityPredicate?.(parsedWithDevice) ?? true);
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
    dataListenerStableDeviceId = '';
    dataListenerServiceId = '';
    dataListenerDataCharId = '';
    dataListenerDeviceName = '';
    dataListenerNormalizedIdentityLogged = false;
    pendingDataListenerClear = null;
    appendRingDiagnosticLog('L19 BLE', 'legacy-data-listener-clear-completed', metadata);
  };

  onLegacyBleCommandSessionIdle(
    () => {
      if (!pendingDataListenerClear) return;
      const pending = pendingDataListenerClear;
      pendingDataListenerClear = null;
      if (pending.listenerGeneration !== dataListenerGeneration || pending.listenerIdentityKey !== dataListenerIdentityKey) {
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
      if (!pending.closeConnection) return;
      // 历史会话已结束，把当初被延后的 disconnect 补上。
      const closeDeviceId = pending.deviceId || runtime?.getDeviceInfo?.().deviceId;
      if (!closeDeviceId) return;
      appendRingDiagnosticLog('L19 BLE', 'legacy-deferred-disconnect-closing', {
        deviceId: closeDeviceId,
        sessionId: pending.sessionId,
        reason: pending.reason
      });
      uni.closeBLEConnection({
        deviceId: closeDeviceId,
        success: () => undefined,
        fail: (error) => {
          appendRingDiagnosticLog('L19 BLE', 'legacy-deferred-disconnect-close-failed', {
            deviceId: closeDeviceId,
            error: formatLegacyBleError(error)
          });
        }
      });
    },
    () => runtime?.getDeviceInfo?.() || dataListenerDeviceId
  );

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
    isL19HistoryDevice,
    sendCommand,
    sendNamedCommand,
    waitForParsedData,
    setupDataListener,
    clearDataListener,
    sendBatteryCommand: () => sendNamedCommand(LegacyRingCommand.Battery),
    sendActiveMeasureCommand: () => sendNamedCommand(LegacyRingCommand.ActiveMeasure, buildLegacyHeartRateMeasurementPayload()),
    sendOxyGenCommand: () => sendNamedCommand(LegacyRingCommand.BloodOxygen, buildLegacyBloodOxygenMeasurementPayload()),
    sendBodyTemperatureCommand: () => sendNamedCommand(LegacyRingCommand.BodyTemperature, 0x00),
    sendFirmwareVersion: () => sendNamedCommand(LegacyRingCommand.HardwareVersion),
    sendSoftwareVersion: () => sendNamedCommand(LegacyRingCommand.SoftwareVersion),
    sendReadLocalDataCommand,
    finishHistoryReadTrace: finalizeHistoryWireTrace,
    readLocalData,
    readDeviceTime,
    updateDeviceTime,
    sendAppConnectCommand,
    establishAppConnectSession,
    sendCollectPeriodSettingCommand: (seconds = 1800) => sendNamedCommand(LegacyRingCommand.SetCollectPeriod, numberToUint32LE(seconds)),
    readCollectPeriodCommand: () => sendNamedCommand(LegacyRingCommand.ReadCollectPeriod),
    sendResetCommand: () => sendNamedCommand(LegacyRingCommand.FactoryReset),
    sendFactoryResetWithTimeCommand,
    sendDeleteAllLocalDataCommand: () => sendNamedCommand(LegacyRingCommand.DeleteAllLocalData)
  };
};
