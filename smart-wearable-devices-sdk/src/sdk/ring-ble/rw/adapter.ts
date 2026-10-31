import type { LegacyRingAdapter, LegacyConnectionStateOptions, LegacyReadLocalDataOptions, LegacyScanOptions, RingWriteOptions } from '../legacy/adapter';
import { LegacyRingCommand } from '../legacy/commands';
import { getTodayZeroTimestamp, type LegacyCommandPayload } from '../legacy/protocol';
import { RING_PARSED_EMITTED, type RingBleRuntime, type RingBleState, type RingDeviceInfo, type RingParsedData } from '../types';
import type { RwHealthDataName, RwHistoryDataName, RwMonitoringName } from '../legacy/adapter';
import { isRwProtocolDeviceName, parseQkeerV2AdvertisInfo, parseRwAdvertisInfo, resolveRingProtocol } from '../protocolRegistry';
import {
  RW_NOTIFY_CHAR_UUID,
  RW_SCAN_NAME_PREFIXES,
  RW_SERVICE_UUIDS,
  RW_WRITE_CHAR_UUID,
  RwCommand,
  RwFileSystemSubcommand,
  RwHealthDataControlKey,
  RwTimeSubcommand,
  buildRwAppDataControlAckCommand,
  buildRwFormatFileSystemCommand as buildRwFormatFileSystemFrame,
  buildRwFrame,
  buildRwControlHealthDataCommand,
  buildRwBatteryCommandVariants,
  buildRwFirmwareVersionCommandVariants,
  buildRwLoginBindCommand,
  buildRwReadFileListCommand,
  buildRwReadDateTimeKeyCommand,
  buildRwDeleteHealthDataCommand,
  buildRwReadFunctionV2Command,
  buildRwReadHealthDataCommand,
  buildRwReadContinueKeyCommand,
  buildRwReadContinueKeyCommandWithoutChecksum,
  buildRwReadKeyCommand,
  buildRwReadKeyCommandWithoutChecksum,
  buildRwReadLedLevelCommand,
  buildRwReadRingWearHandCommand,
  buildRwReadVideoHidCommand,
  buildRwReadHealthMonitoringCommand,
  buildRwReadTimeCommand,
  buildRwSetDateTimeKeyCommand,
  buildRwSetBodyTemperatureDetectingCommand,
  buildRwSetHealthMonitoringCommand,
  buildRwSetTimeFormatKeyCommand,
  buildRwSetTimeZoneKeyCommand,
  buildRwSetUserProfileCommand,
  buildRwSyncTimeCommand,
  bytesToHex,
  parseRwFrame,
  readUint32LE,
  type RwHealthMonitoringConfig,
  type RwUserProfile,
  RwKey,
  RwKeyFlag
} from './protocol';
import { parseRwRingData } from './parser';
import { getRwHistoryDataType } from './history';
import { ensureAndroidBleRuntimePermissions } from '../androidBlePermissions';
import { enqueueRwDiagnosticUpload } from '@/utils/rwDiagnosticUpload';
import { ensureWechatBluetoothPrivacyAuthorization, isBluetoothPrivacyError, normalizeBluetoothPrivacyError } from '@/utils/wechatBluetoothPrivacy';

type BluetoothDeviceFoundCallback = Parameters<typeof uni.onBluetoothDeviceFound>[0];
type BleConnectionStateCallback = Parameters<typeof uni.onBLEConnectionStateChange>[0];
type BleCharacteristicValueCallback = Parameters<typeof uni.onBLECharacteristicValueChange>[0];
type BluetoothAdapterStateCallback = Parameters<NonNullable<typeof uni.onBluetoothAdapterStateChange>>[0];
type ParsedWaiter = {
  predicate: (parsed: RingParsedData) => boolean;
  resolve: (parsed: RingParsedData) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type RecentParsedEntry = {
  parsed: RingParsedData;
  cachedAt: number;
};
type RwCommandWrite = Uint8Array | { label?: string; bytes: Uint8Array };
type RwWriteCandidate = { serviceId: string; characteristicId: string };
type RwNotifyCandidate = { serviceId: string; characteristicId: string };

type RwLocalDataReadIntent = {
  readAll: boolean;
  sinceTimestamp: number;
  dataType?: string;
  dataTypes?: string[];
  expiresAt: number;
};

type RwAppHistoryReadCommand = {
  label: string;
  key: RwKey;
};

type L19MetricAliasType = 'active_measure' | 'active_OxyGenMeasure' | 'active_Temperature';
type RwPendingMetricAlias = {
  type: L19MetricAliasType;
  expiresAt: number;
};
type RwPendingHealthControl = {
  name: RwHealthDataName;
  controlKey: RwHealthDataControlKey;
  enabled: boolean;
  expiresAt: number;
};
type L19VersionAliasType = 'hardwareVersion' | 'softwareVersion';
type RwPendingFirmwareAlias = {
  type: L19VersionAliasType;
  expiresAt: number;
};
type RwPendingAlias = {
  expiresAt: number;
};
type RwActiveMeasureAliasName = 'heart_rate' | 'hrv' | 'stress';
type RwActiveMeasureAliasState = {
  expiresAt: number;
  received: Partial<Record<RwActiveMeasureAliasName, true>>;
  heartRate: number | null;
  heartRateVariability: number | null;
  stressIndex: number | null;
};

const SERVICE_CACHE_KEY = 'deviceServiceCache';
const ACTIVE_MEASURE_ALIAS_TTL_MS = 15000;
const RW_REALTIME_ALIAS_TTL_MS = 35000;
const RW_RECENT_PARSED_CACHE_TTL_MS = 5000;
const RW_RECENT_PARSED_CACHE_MAX_COUNT = 40;
const RW_ACTIVE_MEASURE_REALTIME_KEY_MAP: Record<RwActiveMeasureAliasName, RwKey[]> = {
  heart_rate: [RwKey.HeartRate, RwKey.AppRealTimeHeartRate],
  hrv: [RwKey.Hrv, RwKey.AppRealTimeHrv],
  stress: [RwKey.Stress, RwKey.AppRealTimeStress]
};
const RW_ACTIVE_MEASURE_CONTROL_KEY_MAP: Record<RwActiveMeasureAliasName, RwHealthDataControlKey> = {
  heart_rate: RwHealthDataControlKey.HeartRate,
  hrv: RwHealthDataControlKey.Hrv,
  stress: RwHealthDataControlKey.Stress
};
const RW_L19_METRIC_ALIAS_REALTIME_KEY_MAP: Partial<Record<L19MetricAliasType, RwKey[]>> = {
  active_OxyGenMeasure: [RwKey.BloodOxygen, RwKey.AppRealTimeBloodOxygen],
  active_Temperature: [RwKey.Temperature, RwKey.AppRealTimeTemperature]
};
const RW_L19_METRIC_ALIAS_CONTROL_KEY_MAP: Partial<Record<L19MetricAliasType, RwHealthDataControlKey>> = {
  active_OxyGenMeasure: RwHealthDataControlKey.BloodOxygen,
  active_Temperature: RwHealthDataControlKey.Temperature
};
const RW_ALT_WRITE_PROBE_TIMEOUT_MS = 650;
const RW_FALLBACK_RESPONSE_GRACE_MS = 650;
const RW_FALLBACK_RESPONSE_TIMEOUT_CAP_MS = 6000;
const RW_PRIMARY_RESPONSE_TIMEOUT_MS = 2500;
// 单次 writeBLECharacteristicValue 的兜底超时：App 端偶发不回 success/fail，
// 没有它整条串行写队列会被永久堵死，后续所有命令都排不进来。
const RW_COMMAND_WRITE_TIMEOUT_MS = 3000;
// 开启通知的兜底超时：部分 App/机型上 notifyBLECharacteristicValueChange
// 的 success/fail 都不回，没有它整条连接/重连会永久挂在 notify 这一步。
const RW_NOTIFY_ENABLE_TIMEOUT_MS = 4000;
// MTU 协商和启动扫描同样可能静默丢回调：前者要抛错让握手走降级，
// 后者按"已在扫描"处理（设备监听在调用前就注册了）。
const RW_MTU_CALL_TIMEOUT_MS = 5000;
const RW_SCAN_START_CALLBACK_TIMEOUT_MS = 3000;
// 安静类调用（停扫描/关连接/查状态）的超时：超时按已完成处理。
const RW_QUIET_BLE_CALL_TIMEOUT_MS = 2000;
// 服务/特征发现单次调用的超时：超时要抛错交给 withRetry 重试。
const RW_GATT_DISCOVERY_CALL_TIMEOUT_MS = 5000;
const RW_ALTERNATE_NOTIFY_MAX_BACKGROUND_CANDIDATES = 2;
const RW_CREATE_CONNECTION_TIMEOUT_MS = 20000;
const RW_CREATE_CONNECTION_RETRY_DELAYS_MS = [0, 900, 1800];
const RW_CREATE_CONNECTION_ADAPTER_RESET_DELAY_MS = 1200;
const BLUETOOTH_ADAPTER_STATE_CHECK_TIMEOUT_MS = 800;
const BLUETOOTH_ADAPTER_OPEN_FOREGROUND_TIMEOUT_MS = 3000;
const BLUETOOTH_ADAPTER_OPEN_CALLBACK_EXPIRY_MS = 12000;
const RW_APP_READY_PREFLIGHT_TTL_MS = 2 * 60 * 1000;
const RW_APP_READY_MONITORING_INTERVAL_MINUTES = 60;
const RW_APP_HISTORY_SYNC_RESPONSE_WAIT_MS = 2200;
const RW_APP_HISTORY_SYNC_DELETE_WAIT_MS = 1800;
const RW_APP_HISTORY_SYNC_LOOP_MAX_READS = 32;
const RW_BLE_DEBUG_STORAGE_KEY = 'qkeer:ring-ble-debug';
const RW_DIAGNOSTIC_LOG_STORAGE_KEY = 'qkeer:ring-diagnostic-logs';
const RW_DIAGNOSTIC_LOG_MAX_COUNT = 500;
const RW_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH = 4000;

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
const RW_DIAGNOSTIC_NOISY_EVENT_THROTTLE_MS = 5000;
const RW_DIAGNOSTIC_NOISY_EVENTS = new Set([
  'tx',
  'tx-ok',
  'rx-parsed',
  'rx-alt-channel',
  'rx-ignored-channel',
  'rx-unparsed',
  'scan-found',
  'adapter-state',
  'standard-battery-read',
  'standard-heart-rate-read',
  'standard-pulse-oximeter-read',
  'standard-device-info-read'
]);
const BLE_BATTERY_SERVICE_UUID = '0000180F-0000-1000-8000-00805F9B34FB';
const BLE_BATTERY_LEVEL_CHAR_UUID = '00002A19-0000-1000-8000-00805F9B34FB';
const BLE_HEART_RATE_SERVICE_UUID = '0000180D-0000-1000-8000-00805F9B34FB';
const BLE_HEART_RATE_MEASUREMENT_CHAR_UUID = '00002A37-0000-1000-8000-00805F9B34FB';
const BLE_PULSE_OXIMETER_SERVICE_UUID = '00001822-0000-1000-8000-00805F9B34FB';
const BLE_PLX_SPOT_CHECK_CHAR_UUID = '00002A5E-0000-1000-8000-00805F9B34FB';
const BLE_PLX_CONTINUOUS_CHAR_UUID = '00002A5F-0000-1000-8000-00805F9B34FB';
const BLE_DEVICE_INFORMATION_SERVICE_UUID = '0000180A-0000-1000-8000-00805F9B34FB';
const BLE_FIRMWARE_REVISION_CHAR_UUID = '00002A26-0000-1000-8000-00805F9B34FB';
const BLE_HARDWARE_REVISION_CHAR_UUID = '00002A27-0000-1000-8000-00805F9B34FB';
const BLE_SOFTWARE_REVISION_CHAR_UUID = '00002A28-0000-1000-8000-00805F9B34FB';

const isNodeRuntime = () => Boolean((globalThis as any).process?.versions?.node);
const rwDiagnosticThrottle = new Map<string, { lastAt: number; suppressed: number }>();

const getRwQuickResponseTimeoutMs = () => (isNodeRuntime() ? 220 : RW_PRIMARY_RESPONSE_TIMEOUT_MS);

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
  return text.length > RW_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH ? `${text.slice(0, RW_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH)}...<truncated>` : text;
};

const appendRingDiagnosticLog = (source: string, event: string, details?: unknown) => {
  if (isNodeRuntime()) return;
  try {
    const raw = uni.getStorageSync?.(RW_DIAGNOSTIC_LOG_STORAGE_KEY);
    const logs = Array.isArray(raw) ? raw : [];
    const entry = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      time: formatDiagnosticTime(),
      source,
      event,
      details: normalizeDiagnosticDetails(details)
    };
    logs.push(entry);
    uni.setStorageSync?.(RW_DIAGNOSTIC_LOG_STORAGE_KEY, logs.slice(-RW_DIAGNOSTIC_LOG_MAX_COUNT));
    enqueueRwDiagnosticUpload(entry);
  } catch {
    // Diagnostic logging must never affect BLE behavior.
  }
};

const isRwBleDebugEnabled = () => {
  if (isNodeRuntime()) return false;
  try {
    const value = uni.getStorageSync?.(RW_BLE_DEBUG_STORAGE_KEY);
    return value === true || value === 'true' || value === 1 || value === '1';
  } catch {
    return false;
  }
};

const isRwCompatibilityFallbackEnabled = () => true;

const getDiagnosticThrottleKey = (event: string, details: Record<string, unknown>) => {
  const parsed = Array.isArray(details.parsed) ? details.parsed[0] : details.parsed;
  const parsedItem = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  return [
    event,
    details.label,
    details.probe,
    details.hex,
    details.rawHex,
    details.serviceId,
    details.characteristicId,
    parsedItem.type,
    parsedItem.name,
    parsedItem.key,
    parsedItem.statusCode,
    details.available,
    details.discovering
  ]
    .filter((item) => item !== undefined && item !== null && item !== '')
    .map(String)
    .join('|');
};

const resolveRwDiagnosticLogDetails = (event: string, details: Record<string, unknown>) => {
  if (isRwBleDebugEnabled() || !RW_DIAGNOSTIC_NOISY_EVENTS.has(event)) return details;

  const now = Date.now();
  const key = getDiagnosticThrottleKey(event, details);
  const previous = rwDiagnosticThrottle.get(key);
  if (previous && now - previous.lastAt < RW_DIAGNOSTIC_NOISY_EVENT_THROTTLE_MS) {
    previous.suppressed += 1;
    return null;
  }

  const suppressedSinceLastLog = previous?.suppressed || 0;
  rwDiagnosticThrottle.set(key, { lastAt: now, suppressed: 0 });
  return suppressedSinceLastLog > 0 ? { ...details, suppressedSinceLastLog } : details;
};

const rwBleLog = (event: string, details: Record<string, unknown>) => {
  const diagnosticDetails = resolveRwDiagnosticLogDetails(event, details);
  if (diagnosticDetails) appendRingDiagnosticLog('RW BLE', event, diagnosticDetails);
  if (!isRwBleDebugEnabled()) return;
  const logger = globalThis.console?.['log'];
  if (typeof logger === 'function') {
    logger.call(globalThis.console, `[RW BLE] ${event}`, details);
  }
};

/**
 * Android 运行时权限的申请已抽到 `../androidBlePermissions`：**legacy adapter 也必须申请**，
 * 而「未绑定设备时的首次扫描」走的正是 legacy（见 useRingBleSdk.startScan），
 * 只在 rw 这边申请等于永远不申请。
 * 这里保留一道保险，因为 RW adapter 也可能不经 ensureLegacyBluetoothReady 被直接使用。
 */

const formatRwFrameByte = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return `0x${value.toString(16).padStart(2, '0')}`;
};

const summarizeRwBleFrameForLog = (bytes: Uint8Array, label?: string, probeLabel?: string) => {
  const frame = parseRwFrame(bytes);
  const rawHex = bytesToHex(bytes);
  return {
    ...(label ? { label } : {}),
    ...(probeLabel ? { probe: probeLabel } : {}),
    hex: rawHex,
    rawHex,
    length: bytes.length,
    frameType: formatRwFrameByte(frame?.frameType),
    frameTypeValue: frame?.frameType,
    frameId: formatRwFrameByte(frame?.frameId),
    frameIdValue: frame?.frameId,
    cmd: formatRwFrameByte(frame?.cmd),
    cmdValue: frame?.cmd,
    subcmd: formatRwFrameByte(frame?.subcmd),
    subcmdValue: frame?.subcmd,
    payloadHex: frame ? bytesToHex(frame.data) : ''
  };
};

const summarizeParsedForRwBleLog = (parsed: RingParsedData) => {
  const item = parsed as Record<string, any>;
  return {
    type: parsed.type,
    name: item.name,
    key: item.key,
    status: item.status,
    statusCode: item.statusCode,
    value: item.value,
    battery: item.battery,
    batteryLevel: item.batteryLevel ?? item.battery,
    batteryDisplay: parsed.type === 'battery' ? (item.value ?? item.batteryLevel ?? item.battery) : undefined,
    batteryStatus: parsed.type === 'battery' ? item.status : undefined,
    batteryRawValue: parsed.type === 'battery' ? (item.batteryRawValue ?? item.batteryInfo) : undefined,
    heartRate: item.heartRate,
    bloodOxygen: item.bloodOxygen,
    firmwareVersion: item.firmwareVersion,
    softwareVersion: item.softwareVersion,
    rawType: item.packetShape
  };
};

const summarizeScanDeviceForRwBleLog = (device: RingDeviceInfo) => ({
  deviceId: device.deviceId,
  name: device.name || device.deviceName || device.localName || device.displayName,
  protocol: device.protocol,
  uniMacId: device.uniMacId,
  mac: device.mac || device.advertis?.macInfo,
  RSSI: device.RSSI ?? (device as Record<string, any>).rssi,
  advertis: device.advertis,
  lastSeenAt: device.lastSeenAt
});

// App 端不一定实现全部 off* API。裸调用一旦抛 TypeError，调用点（部分在
// Promise 之外）会让扫描/清理流程当场中断且几乎没有日志，因此统一改成可选调用。
const offBluetoothDeviceFound = (callback: BluetoothDeviceFoundCallback) => {
  (uni.offBluetoothDeviceFound as unknown as ((callback?: BluetoothDeviceFoundCallback) => void) | undefined)?.(callback);
};

const notSupported = (method: string) => async () => {
  throw new Error(`RW ring protocol does not support ${method} yet.`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 部分 App/机型上 uni 的 BLE 查询类 API 偶发既不回调 success 也不回调 fail。
// 这些调用只是"尽力而为"，超时按 fallback 结算，避免整条连接流程卡死。
const settleBleCallWithin = <T>(task: Promise<T>, timeoutMs: number, fallback: T, label: string): Promise<T> => {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rwBleLog('ble-call-timeout', { label, timeoutMs });
      resolve(fallback);
    }, timeoutMs);
    (timer as any).unref?.();
    const settle = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    task.then(settle, () => settle(fallback));
  });
};

// GATT 发现需要区分"超时"和"成功"，超时要抛错让上层重试。
const rejectBleCallAfter = <T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rwBleLog('ble-call-timeout', { label, timeoutMs });
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    (timer as any).unref?.();
    task.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
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

// 写超时要能和普通 fail 区分：前者不能确定帧有没有发出去，破坏性命令
// 不能再拿同一帧重发一次。
const RW_WRITE_TIMEOUT_FLAG = '__rwWriteTimedOut';
const markRwWriteTimeoutError = (error: Error) => {
  Object.defineProperty(error, RW_WRITE_TIMEOUT_FLAG, { value: true, enumerable: false });
  return error;
};
const isRwWriteTimeoutError = (error: unknown) =>
  Boolean(error && typeof error === 'object' && (error as Record<string, unknown>)[RW_WRITE_TIMEOUT_FLAG]);
// 删除 / 格式化 / 恢复出厂：超时后绝不能拿同一帧重发。
const RW_DESTRUCTIVE_WRITE_OPTIONS: RingWriteOptions = { allowTimeoutFallback: false };

const normalizeCommandWrite = (command: RwCommandWrite) => {
  if (command instanceof Uint8Array) return { bytes: command, label: undefined };
  return command;
};

const withRetry = async <T>(task: () => Promise<T>, retries = 3, delayMs = 500): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) await sleep(delayMs);
    }
  }

  throw lastError;
};

const markParsedAsEmitted = <T extends RingParsedData>(parsed: T): T => {
  Object.defineProperty(parsed, RING_PARSED_EMITTED, {
    value: true,
    enumerable: false,
    configurable: true
  });
  return parsed;
};

export const createRwRingAdapter = (state: RingBleState, runtime?: RingBleRuntime): LegacyRingAdapter => {
  let currentDevice: RingDeviceInfo = {};
  let connectionGeneration = 0;
  // 握手期间 currentDevice.deviceId 已经指向目标设备，但代际还没前进。
  // 这条真值让连接态回调区分"旧链路的迟到掉线"和"新链路真的掉了"：
  // 握手期一律忽略掉线事件，真失败由建链/发现/notify 自身的失败路径收尾。
  let connectHandshakeInFlight = false;
  // switchAdapter 会丢弃旧实例。App 端可能没有 off*BLE*，注销不掉的原
  // 回调必须靠这个标记失效，否则旧适配器还能把新会话拆掉。
  let adapterDisposed = false;
  let activeL19HistorySession: { deviceId: string; generation: number } | null = null;
  let scanCallback: BluetoothDeviceFoundCallback | null = null;
  let scanTimeout: ReturnType<typeof setTimeout> | null = null;
  let scanPollTimer: ReturnType<typeof setInterval> | null = null;
  const parsedWaiters: ParsedWaiter[] = [];
  const recentParsedData: RecentParsedEntry[] = [];
  let dataListenerCallback: BleCharacteristicValueCallback | null = null;
  let connectionStateCallback: BleConnectionStateCallback | null = null;
  let adapterStateCallback: BluetoothAdapterStateCallback | null = null;
  let bluetoothAdapterOpenOperation: BluetoothAdapterOpenOperation | null = null;
  let lastLocalDataReadIntent: RwLocalDataReadIntent | null = null;
  let pendingDeleteAllLocalDataAlias: RwPendingAlias | null = null;
  const pendingFirmwareAliases: RwPendingFirmwareAlias[] = [];
  const pendingMetricAliases: RwPendingMetricAlias[] = [];
  const pendingHealthControls: RwPendingHealthControl[] = [];
  let pendingActiveMeasureAlias: RwActiveMeasureAliasState | null = null;
  let pendingCollectPeriodReadAlias: RwPendingAlias | null = null;
  let pendingCollectPeriodSetAlias: RwPendingAlias | null = null;
  let writeQueue: Promise<unknown> = Promise.resolve();
  // 断连时递增，让排队的旧写入在真正执行前作废，避免把命令写到下一次连接上。
  let writeQueueGeneration = 0;
  let rwAppReadyPreflightRunning: Promise<void> | null = null;
  let lastRwAppReadyPreflightAt = 0;

  const getRuntimeDevice = () => {
    const runtimeDevice = (runtime?.getDeviceInfo?.() || {}) as RingDeviceInfo;
    const mergedDevice: RingDeviceInfo = { ...currentDevice };
    Object.entries(runtimeDevice).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        mergedDevice[key] = value;
      }
    });
    return mergedDevice;
  };

  const isL19HistoryDevice = () => {
    const device = getRuntimeDevice();
    const candidates = [device.name, device.deviceName, device.model, device.modelKey, device.productName];
    return candidates.some((value) => {
      const normalized = String(value || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      return normalized.includes('QKEERINGL19') || normalized.includes('QKL19');
    });
  };

  const beginL19HistorySession = () => {
    if (!isL19HistoryDevice() || !currentDevice.deviceId) return null;
    activeL19HistorySession = {
      deviceId: currentDevice.deviceId,
      generation: connectionGeneration
    };
    rwBleLog('l19-history-session-start', activeL19HistorySession);
    return connectionGeneration;
  };

  const endL19HistorySession = (generation?: number | null) => {
    if (!activeL19HistorySession) return;
    if (generation != null && activeL19HistorySession.generation !== generation) return;
    rwBleLog('l19-history-session-end', activeL19HistorySession);
    activeL19HistorySession = null;
  };

  const clearPendingAliases = () => {
    lastLocalDataReadIntent = null;
    pendingDeleteAllLocalDataAlias = null;
    pendingFirmwareAliases.length = 0;
    pendingMetricAliases.length = 0;
    pendingHealthControls.length = 0;
    pendingActiveMeasureAlias = null;
    pendingCollectPeriodReadAlias = null;
    pendingCollectPeriodSetAlias = null;
    rwAppReadyPreflightRunning = null;
    lastRwAppReadyPreflightAt = 0;
  };

  const pruneRecentParsedData = (now = Date.now()) => {
    const minCachedAt = now - RW_RECENT_PARSED_CACHE_TTL_MS;
    for (let index = recentParsedData.length - 1; index >= 0; index -= 1) {
      if (recentParsedData[index].cachedAt >= minCachedAt) continue;
      recentParsedData.splice(index, 1);
    }
    if (recentParsedData.length > RW_RECENT_PARSED_CACHE_MAX_COUNT) {
      recentParsedData.splice(0, recentParsedData.length - RW_RECENT_PARSED_CACHE_MAX_COUNT);
    }
  };

  const rememberParsedData = (items: RingParsedData | RingParsedData[]) => {
    const parsedItems = Array.isArray(items) ? items : [items];
    const cachedAt = Date.now();
    parsedItems.forEach((parsed) => {
      recentParsedData.push({ parsed, cachedAt });
    });
    pruneRecentParsedData(cachedAt);
  };

  const takeRecentParsedData = (predicate: (parsed: RingParsedData) => boolean) => {
    pruneRecentParsedData();
    for (let index = recentParsedData.length - 1; index >= 0; index -= 1) {
      const parsed = recentParsedData[index].parsed;
      if (predicate(parsed)) return parsed;
    }
    return null;
  };

  const resolveParsedWaiters = (items: RingParsedData | RingParsedData[]) => {
    const parsedItems = Array.isArray(items) ? items : [items];
    rememberParsedData(parsedItems);
    for (let index = parsedWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = parsedWaiters[index];
      const matched = parsedItems.find((item) => waiter.predicate(item));
      if (!matched) continue;

      clearTimeout(waiter.timer);
      parsedWaiters.splice(index, 1);
      waiter.resolve(matched);
    }
  };

  const cacheServiceId = (mac: string, serviceId: string) => {
    if (!mac || !serviceId) return;

    const cache = uni.getStorageSync?.(SERVICE_CACHE_KEY) || {};
    cache[mac] = serviceId;
    uni.setStorageSync?.(SERVICE_CACHE_KEY, cache);
  };

  const getCachedServiceId = (mac: string) => {
    if (!mac) return '';
    const cache = uni.getStorageSync?.(SERVICE_CACHE_KEY) || {};
    return cache[mac] || '';
  };

  const getBluetoothAdapterStateSnapshot = (reason: string) => {
    const startedAt = Date.now();
    rwBleLog('bluetooth-adapter-state-check-start', { reason });
    return new Promise<BluetoothAdapterStateSnapshot>((resolve) => {
      let settled = false;
      const finish = (snapshot: BluetoothAdapterStateSnapshot, event: string) => {
        if (settled) {
          rwBleLog('bluetooth-adapter-state-check-late-result', {
            reason,
            available: snapshot.available,
            discovering: snapshot.discovering,
            source: snapshot.source,
            elapsedMs: Date.now() - startedAt,
            error: formatError(snapshot.error)
          });
          if (snapshot.available) runtime?.onBluetoothReadyChange?.(true);
          return;
        }
        settled = true;
        clearTimeout(timer);
        rwBleLog(event, {
          reason,
          available: snapshot.available,
          discovering: snapshot.discovering,
          source: snapshot.source,
          elapsedMs: Date.now() - startedAt,
          error: formatError(snapshot.error)
        });
        resolve(snapshot);
      };
      const timer = setTimeout(() => {
        finish({ available: false, discovering: false, source: 'timeout' }, 'bluetooth-adapter-state-check-timeout');
      }, BLUETOOTH_ADAPTER_STATE_CHECK_TIMEOUT_MS);

      if (typeof uni.getBluetoothAdapterState !== 'function') {
        finish({ available: false, discovering: false, source: 'unsupported' }, 'bluetooth-adapter-state-check-unsupported');
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
            'bluetooth-adapter-state-check-result'
          ),
        fail: (error) => finish({ available: false, discovering: false, source: 'failed', error }, 'bluetooth-adapter-state-check-failed')
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

    rwBleLog('bluetooth-adapter-open-start', {
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
              rwBleLog('bluetooth-adapter-open-callback-expired', {
                elapsedMs: Date.now() - startedAt,
                foregroundTimedOut: operation.foregroundTimedOut
              });
              reject(new Error('Open Bluetooth adapter callback expired.'));
            }, BLUETOOTH_ADAPTER_OPEN_CALLBACK_EXPIRY_MS);

            uni.openBluetoothAdapter({
              success: (result) => {
                if (callbackSettled) {
                  rwBleLog('bluetooth-adapter-open-expired-success', {
                    elapsedMs: Date.now() - startedAt
                  });
                  runtime?.onBluetoothReadyChange?.(true);
                  return;
                }
                callbackSettled = true;
                clearTimeout(expiryTimer);
                rwBleLog(operation.foregroundTimedOut ? 'bluetooth-adapter-open-late-success' : 'bluetooth-adapter-open-success', {
                  elapsedMs: Date.now() - startedAt,
                  foregroundTimedOut: operation.foregroundTimedOut
                });
                runtime?.onBluetoothReadyChange?.(true);
                resolve(result);
              },
              fail: (error) => {
                const normalizedError = normalizeBluetoothPrivacyError(error);
                if (callbackSettled) {
                  rwBleLog('bluetooth-adapter-open-expired-failed', {
                    elapsedMs: Date.now() - startedAt,
                    error: formatError(normalizedError)
                  });
                  return;
                }
                callbackSettled = true;
                clearTimeout(expiryTimer);
                rwBleLog(operation.foregroundTimedOut ? 'bluetooth-adapter-open-late-failed' : 'bluetooth-adapter-open-failed', {
                  elapsedMs: Date.now() - startedAt,
                  foregroundTimedOut: operation.foregroundTimedOut,
                  error: formatError(normalizedError),
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
          rwBleLog('bluetooth-privacy-authorization-required', {
            elapsedMs: Date.now() - startedAt,
            retryable: false,
            error: formatError(normalizedError)
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

  const openBluetoothAdapter = async () => {
    await ensureAndroidBleRuntimePermissions();
    const existingOperation = bluetoothAdapterOpenOperation;
    const operation = existingOperation || startBluetoothAdapterOpenOperation();
    if (existingOperation) {
      rwBleLog('bluetooth-adapter-open-reuse', {
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
        rwBleLog('bluetooth-adapter-open-foreground-timeout', {
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

  const initBluetooth = async () => {
    registerConnectionStateListener();
    const openResult = await openBluetoothAdapter();
    const stateSnapshot = await getBluetoothAdapterStateSnapshot('init-bluetooth-after-open');
    if (stateSnapshot.available) {
      runtime?.onBluetoothReadyChange?.(true);
      rwBleLog('bluetooth-adapter-state-after-open', {
        reason: 'open-succeeded-state-confirmed',
        discovering: stateSnapshot.discovering
      });
      return stateSnapshot;
    }
    rwBleLog('bluetooth-adapter-state-after-open-unconfirmed', {
      source: stateSnapshot.source,
      error: stateSnapshot.error
    });
    return openResult;
  };

  const closeBluetoothAdapterQuietly = () => {
    return settleBleCallWithin(
      new Promise<void>((resolve) => {
        uni.closeBluetoothAdapter({
          success: () => resolve(),
          fail: () => resolve()
        });
      }),
      RW_QUIET_BLE_CALL_TIMEOUT_MS,
      undefined,
      'closeBluetoothAdapter'
    );
  };

  const resetBluetoothAdapterForReconnect = async (deviceId: string, deviceName = '', lastError?: unknown) => {
    rwBleLog('connect-adapter-reset-start', {
      deviceId,
      deviceName,
      delayMs: RW_CREATE_CONNECTION_ADAPTER_RESET_DELAY_MS,
      previousMessage: formatError(lastError)
    });
    await stopScan();
    invalidateWriteQueue();
    clearDataListener();
    await closeBleConnectionQuietly(deviceId);
    await closeBluetoothAdapterQuietly();
    await sleep(RW_CREATE_CONNECTION_ADAPTER_RESET_DELAY_MS);
    await initBluetooth();
    rwBleLog('connect-adapter-reset-done', { deviceId, deviceName });
  };

  const checkBluetoothState = async () => {
    const stateSnapshot = await getBluetoothAdapterStateSnapshot('check-bluetooth-state');
    return stateSnapshot.available;
  };

  const isBenignMtuError = (error: unknown) => {
    const message = typeof error === 'string' ? error : `${(error as { errMsg?: string })?.errMsg || ''}`;
    return message.toLowerCase().includes('setblemtu:fail:internal');
  };

  const setMTU = (deviceId: string, mtu = 247) => {
    if (uni.getSystemInfoSync().platform !== 'android') return Promise.resolve(undefined);

    return rejectBleCallAfter(
      new Promise<unknown>((resolve, reject) => {
        uni.setBLEMTU({
          deviceId,
          mtu,
          success: resolve,
          fail: (error) => {
            if (isBenignMtuError(error)) {
              resolve(error);
              return;
            }
            reject(error);
          }
        });
      }),
      RW_MTU_CALL_TIMEOUT_MS,
      'setBLEMTU'
    );
  };

  const checkByRSSI = (deviceId: string) =>
    settleBleCallWithin(
      new Promise<boolean>((resolve) => {
        uni.getBLEDeviceRSSI({
          deviceId,
          success: () => resolve(true),
          fail: () => resolve(false)
        });
      }),
      RW_QUIET_BLE_CALL_TIMEOUT_MS,
      false,
      'getBLEDeviceRSSI'
    );

  const isDeviceConnected = (deviceId: string, serviceId?: string) => {
    if (!serviceId) return checkByRSSI(deviceId);

    return settleBleCallWithin(
      new Promise<boolean>((resolve) => {
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
      }),
      RW_QUIET_BLE_CALL_TIMEOUT_MS,
      false,
      'getConnectedBluetoothDevices'
    );
  };

  const startScan = async (options: LegacyScanOptions = {}) => {
    await initBluetooth();
    if (scanCallback) offBluetoothDeviceFound(scanCallback);
    if (scanTimeout) {
      clearTimeout(scanTimeout);
      scanTimeout = null;
    }
    if (scanPollTimer) {
      clearInterval(scanPollTimer);
      scanPollTimer = null;
    }

    const prefixes = options.prefixes?.length ? options.prefixes : RW_SCAN_NAME_PREFIXES;
    rwBleLog('scan-start', {
      prefixes,
      includeUnknown: options.includeUnknown,
      preserveDevices: options.preserveDevices,
      timeoutMs: options.timeoutMs ?? 20000
    });
    if (!options.preserveDevices) state.devices.value = [];
    state.isScanning.value = true;
    scanTimeout = setTimeout(() => {
      void stopScan();
    }, options.timeoutMs ?? 20000);

    const mergeFoundDevices = (devices: any[] = []) => {
      if (!state.isScanning.value || !Array.isArray(devices)) return;

      const normalized = devices.map((device) => normalizeScanDevice(device));
      const found = normalized.filter((device) => isRwScanDevice(device, prefixes) || isAllowedBusinessScanDevice(device, options));

      if (found.length === 0) {
        // 有名有姓地记下「收到了广播但全被过滤掉」，否则这种情况与「扫描本身没结果」
        // 在日志里完全无法区分——而这正是排查「搜索不到设备」最关键的一条信息。
        if (normalized.length > 0) {
          rwBleLog('scan-filtered-out', {
            received: normalized.length,
            prefixes,
            includeUnknown: options.includeUnknown,
            samples: normalized.slice(0, 6).map(summarizeScanDeviceForRwBleLog)
          });
        }
        return;
      }
      rwBleLog('scan-found', {
        count: found.length,
        devices: found.slice(0, 6).map(summarizeScanDeviceForRwBleLog)
      });

      const merged = [...state.devices.value];
      for (const device of found) {
        const matchedKeys = getRwScannedDeviceMergeKeys(device);
        const existingIndex = merged.findIndex((item) => {
          const itemKeys = getRwScannedDeviceMergeKeys(item);
          return itemKeys.some((key) => matchedKeys.includes(key));
        });

        if (existingIndex >= 0) {
          const previous = merged[existingIndex];
          const protocol = device.protocol || previous.protocol;
          const stableIdentity = protocol === 'rw' ? getRwStableMetadataIdentity(device) || getRwStableMetadataIdentity(previous) : '';
          merged.splice(existingIndex, 1, {
            ...previous,
            ...device,
            name: device.name || previous.name,
            displayName: device.displayName || previous.displayName,
            localName: device.localName || previous.localName,
            protocol,
            uniMacId: protocol === 'rw' ? stableIdentity || '' : device.uniMacId || previous.uniMacId,
            mac: protocol === 'rw' ? stableIdentity : device.mac || previous.mac
          });
          continue;
        }

        if (matchedKeys.length === 0) continue;
        merged.push(device);
      }
      state.devices.value = merged;
    };

    scanCallback = (res) => mergeFoundDevices(res.devices || []);
    // 记录本次扫描的监听器身份：start 的 fail 回调可能迟到，不能拿它拆掉后来者。
    const invocationCallback = scanCallback;

    uni.onBluetoothDeviceFound(scanCallback);

    // 轮询作为广播回调之外的第二条发现通道，不依赖 start 的 success 回调，
    // 避免部分机型 start 静默丢回调后整个扫描只靠广播被动等。
    scanPollTimer = setInterval(() => {
      uni.getBluetoothDevices?.({
        success: (devicesResult) => mergeFoundDevices(devicesResult.devices || []),
        fail: () => undefined
      });
    }, 1500);

    return settleBleCallWithin(
      new Promise<unknown>((resolve, reject) => {
        uni.startBluetoothDevicesDiscovery({
          allowDuplicatesKey: options.allowDuplicatesKey ?? true,
          success: resolve,
          fail: (error) => {
            if (scanCallback === invocationCallback) {
              state.isScanning.value = false;
              offBluetoothDeviceFound(invocationCallback);
              scanCallback = null;
              if (scanTimeout) {
                clearTimeout(scanTimeout);
                scanTimeout = null;
              }
              if (scanPollTimer) {
                clearInterval(scanPollTimer);
                scanPollTimer = null;
              }
            }
            reject(error);
          }
        });
      }),
      RW_SCAN_START_CALLBACK_TIMEOUT_MS,
      undefined,
      'startBluetoothDevicesDiscovery'
    );
  };

  const stopScan = () => {
    if (scanTimeout) {
      clearTimeout(scanTimeout);
      scanTimeout = null;
    }
    if (scanCallback) {
      offBluetoothDeviceFound(scanCallback);
      scanCallback = null;
    }
    if (scanPollTimer) {
      clearInterval(scanPollTimer);
      scanPollTimer = null;
    }
    state.isScanning.value = false;
    return settleBleCallWithin(
      new Promise<void>((resolve) => {
        uni.stopBluetoothDevicesDiscovery({
          success: () => resolve(),
          fail: () => resolve()
        });
      }),
      RW_QUIET_BLE_CALL_TIMEOUT_MS,
      undefined,
      'stopBluetoothDevicesDiscovery'
    );
  };

  const closeBleConnectionQuietly = (deviceId: string) => {
    if (!deviceId) return Promise.resolve();
    return settleBleCallWithin(
      new Promise<void>((resolve) => {
        uni.closeBLEConnection({
          deviceId,
          success: () => resolve(),
          fail: () => resolve()
        });
      }),
      RW_QUIET_BLE_CALL_TIMEOUT_MS,
      undefined,
      'closeBLEConnection'
    );
  };

  const isTransientCreateConnectionFailure = (error: unknown) => {
    const record = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
    const text = formatError(error).toLowerCase();
    return (
      record.errCode === 10003 ||
      record.errno === 1509001 ||
      text.includes('createbleconnection:fail:connection fail') ||
      text.includes('status:133') ||
      text.includes('status 133')
    );
  };

  const createBleConnectionWithRetry = async (deviceId: string, deviceName = '') => {
    let lastError: unknown;
    const maxAttempts = RW_CREATE_CONNECTION_RETRY_DELAYS_MS.length + 1;
    const connectStartedAt = Date.now();
    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      const isAdapterResetAttempt = attemptIndex === RW_CREATE_CONNECTION_RETRY_DELAYS_MS.length;
      const delayMs = RW_CREATE_CONNECTION_RETRY_DELAYS_MS[attemptIndex] || 0;
      const attempt = attemptIndex + 1;
      if (isAdapterResetAttempt) {
        await resetBluetoothAdapterForReconnect(deviceId, deviceName, lastError);
      } else if (delayMs > 0) {
        rwBleLog('connect-retry-cleanup', {
          deviceId,
          deviceName,
          attempt,
          delayMs,
          previousMessage: formatError(lastError)
        });
        await closeBleConnectionQuietly(deviceId);
        await sleep(delayMs);
      }

      try {
        const attemptStartedAt = Date.now();
        rwBleLog('connect-attempt-start', {
          deviceId,
          deviceName,
          attempt,
          maxAttempts,
          adapterResetAttempt: isAdapterResetAttempt,
          timeoutMs: RW_CREATE_CONNECTION_TIMEOUT_MS,
          elapsedTotalMs: attemptStartedAt - connectStartedAt,
          previousMessage: formatError(lastError)
        });
        await new Promise((resolve, reject) => {
          uni.createBLEConnection({
            deviceId,
            timeout: RW_CREATE_CONNECTION_TIMEOUT_MS,
            success: (result) => {
              rwBleLog('connect-created', {
                deviceId,
                deviceName,
                attempt,
                maxAttempts,
                elapsedAttemptMs: Date.now() - attemptStartedAt,
                elapsedTotalMs: Date.now() - connectStartedAt
              });
              resolve(result);
            },
            fail: (error) => {
              const message = `${(error as any)?.errMsg || ''}`.toLowerCase();
              if (message.includes('already connect') || message.includes('already connected')) {
                // OS 报 "已连接" 不代表链路可用（可能是残留句柄）。探一次 RSSI，
                // 探不到就按普通失败重试，避免带着假连接继续发现服务。
                void checkByRSSI(deviceId).then((alive) => {
                  rwBleLog('connect-created', {
                    deviceId,
                    deviceName,
                    alreadyConnected: true,
                    probeAlive: alive,
                    attempt,
                    maxAttempts,
                    elapsedAttemptMs: Date.now() - attemptStartedAt,
                    elapsedTotalMs: Date.now() - connectStartedAt
                  });
                  if (alive) {
                    resolve(error);
                    return;
                  }
                  reject(error);
                });
                return;
              }
              const retriable = isTransientCreateConnectionFailure(error);
              rwBleLog('connect-fail', {
                deviceId,
                deviceName,
                attempt,
                maxAttempts,
                retriable,
                elapsedAttemptMs: Date.now() - attemptStartedAt,
                elapsedTotalMs: Date.now() - connectStartedAt,
                errCode: (error as any)?.errCode,
                errno: (error as any)?.errno,
                message: formatError(error)
              });
              reject(error);
            }
          });
        });
        rwBleLog('connect-attempt-success', {
          deviceId,
          deviceName,
          attempt,
          maxAttempts,
          elapsedTotalMs: Date.now() - connectStartedAt
        });
        return;
      } catch (error) {
        lastError = error;
        if (!isTransientCreateConnectionFailure(error) || attemptIndex >= maxAttempts - 1) {
          rwBleLog('connect-attempt-giveup', {
            deviceId,
            deviceName,
            attempt,
            maxAttempts,
            elapsedTotalMs: Date.now() - connectStartedAt,
            message: formatError(error)
          });
          throw error;
        }
      }
    }
  };

  const connectDevice = async (deviceId: string, deviceName = '', sourceDevice?: RingDeviceInfo) => {
    await stopScan();
    rwBleLog('connect-start', {
      deviceId,
      deviceName,
      timeoutMs: RW_CREATE_CONNECTION_TIMEOUT_MS,
      maxAttempts: RW_CREATE_CONNECTION_RETRY_DELAYS_MS.length + 1,
      sourceDevice: summarizeScanDeviceForRwBleLog(sourceDevice || ({ deviceId, name: deviceName, protocol: 'rw' } as RingDeviceInfo))
    });
    await createBleConnectionWithRetry(deviceId, deviceName);

    currentDevice = mergeRwSourceDeviceMetadata({ deviceId, name: deviceName, protocol: 'rw' }, sourceDevice);
    const delay = /ios/i.test(uni.getSystemInfoSync().system || '') ? 900 : 650;
    await sleep(delay);
    return currentDevice;
  };

  const discoverServicesAndChars = async (deviceId: string, deviceName = '', sourceDevice?: RingDeviceInfo) => {
    const services = await withRetry(() => getServices(deviceId), 5, 600);
    const serviceCandidates = [
      ...RW_SERVICE_UUIDS.flatMap((candidate) => services.filter((service) => sameUuid(candidate, service.uuid))),
      ...services.filter((service) => !RW_SERVICE_UUIDS.some((candidate) => sameUuid(candidate, service.uuid)))
    ];

    const serviceErrors: string[] = [];
    const characteristicGroups: Array<{
      serviceId: string;
      chars: UniApp.GetBLEDeviceCharacteristicsSuccess['characteristics'];
    }> = [];

    for (const service of serviceCandidates) {
      const serviceId = service.uuid;
      let chars: UniApp.GetBLEDeviceCharacteristicsSuccess['characteristics'];
      try {
        chars = await withRetry(() => getCharacteristics(deviceId, serviceId), 5, 600);
      } catch (error) {
        const message = error instanceof Error ? error.message : `${(error as any)?.errMsg || error}`;
        serviceErrors.push(`${serviceId}: ${message}`);
        continue;
      }

      characteristicGroups.push({ serviceId, chars });
      if (!chars.some(isWritableCharacteristic)) {
        serviceErrors.push(`${serviceId}: ${chars.map(formatCharacteristic).join(',') || 'no characteristics'}`);
      }
    }

    const writeCandidates = findWritableCharacteristics(characteristicGroups);
    const writeCandidate = writeCandidates[0];
    if (!writeCandidate) {
      throw new Error(`RW ring characteristics not found. services=${services.map((service) => service.uuid).join(',')} details=${serviceErrors.join(' | ')}`);
    }

    const notifyCandidates = findNotifyCharacteristics(characteristicGroups, writeCandidate.serviceId);
    const notifyChar = notifyCandidates[0];
    const standardBatteryChar = findStandardBatteryLevelCharacteristic(characteristicGroups);
    const standardHeartRateChar = findStandardHeartRateMeasurementCharacteristic(characteristicGroups);
    const standardPulseOximeterChar = findStandardPulseOximeterCharacteristic(characteristicGroups);
    const standardDeviceInformationChars = findStandardDeviceInformationCharacteristics(characteristicGroups);
    currentDevice = mergeRwSourceDeviceMetadata(
      {
        ...currentDevice,
        deviceId,
        name: deviceName || currentDevice.name,
        serviceId: writeCandidate.serviceId,
        cmdCharId: writeCandidate.characteristic.uuid,
        cmdCharProperties: formatCharacteristic(writeCandidate.characteristic),
        writeCandidates: writeCandidates.map((candidate) => ({
          serviceId: candidate.serviceId,
          characteristicId: candidate.characteristic.uuid
        })),
        dataServiceId: notifyChar?.serviceId || '',
        dataCharId: notifyChar?.characteristicId || '',
        standardBatteryServiceId: standardBatteryChar?.serviceId || '',
        standardBatteryCharId: standardBatteryChar?.characteristicId || '',
        standardHeartRateServiceId: standardHeartRateChar?.serviceId || '',
        standardHeartRateCharId: standardHeartRateChar?.characteristicId || '',
        standardHeartRateCanRead: Boolean(standardHeartRateChar?.canRead),
        standardPulseOximeterServiceId: standardPulseOximeterChar?.serviceId || '',
        standardPulseOximeterCharId: standardPulseOximeterChar?.characteristicId || '',
        standardPulseOximeterCanRead: Boolean(standardPulseOximeterChar?.canRead),
        standardFirmwareServiceId: standardDeviceInformationChars.firmware?.serviceId || '',
        standardFirmwareCharId: standardDeviceInformationChars.firmware?.characteristicId || '',
        standardHardwareServiceId: standardDeviceInformationChars.hardware?.serviceId || '',
        standardHardwareCharId: standardDeviceInformationChars.hardware?.characteristicId || '',
        standardSoftwareServiceId: standardDeviceInformationChars.software?.serviceId || '',
        standardSoftwareCharId: standardDeviceInformationChars.software?.characteristicId || '',
        notifyCandidates,
        protocol: 'rw',
        notifyEnabled: false,
        notifyError: notifyChar ? '正在开启通知' : '未发现 notify/indicate 特征'
      },
      sourceDevice
    );
    rwBleLog('discovery-ready', {
      deviceId,
      serviceIds: services.map((service) => service.uuid),
      selectedServiceId: currentDevice.serviceId,
      selectedWriteCharId: currentDevice.cmdCharId,
      selectedWriteProperties: currentDevice.cmdCharProperties,
      selectedNotifyServiceId: currentDevice.dataServiceId,
      selectedNotifyCharId: currentDevice.dataCharId,
      writeCandidates: currentDevice.writeCandidates,
      notifyCandidates: currentDevice.notifyCandidates,
      standardBatteryServiceId: currentDevice.standardBatteryServiceId,
      standardBatteryCharId: currentDevice.standardBatteryCharId,
      standardHeartRateServiceId: currentDevice.standardHeartRateServiceId,
      standardHeartRateCharId: currentDevice.standardHeartRateCharId,
      standardPulseOximeterServiceId: currentDevice.standardPulseOximeterServiceId,
      standardPulseOximeterCharId: currentDevice.standardPulseOximeterCharId,
      standardFirmwareCharId: currentDevice.standardFirmwareCharId,
      standardHardwareCharId: currentDevice.standardHardwareCharId,
      standardSoftwareCharId: currentDevice.standardSoftwareCharId,
      serviceErrors
    });
    return currentDevice;
  };

  const connectAndDiscover = async (deviceId: string, deviceName = '', sourceDevice?: RingDeviceInfo) => {
    const handshakeStartedAt = Date.now();
    // 握手期间忽略掉线回调：旧链路/旧连接的迟到事件会在这里被误判成新链路断开，
    // 把正在建立的连接清掉。真失败由各步骤自己的超时和失败路径收尾。
    connectHandshakeInFlight = true;
    try {
      rwBleLog('handshake-start', {
        deviceId,
        deviceName,
        sourceDevice: summarizeScanDeviceForRwBleLog(sourceDevice || ({ deviceId, name: deviceName, protocol: 'rw' } as RingDeviceInfo))
      });
      await connectDevice(deviceId, deviceName, sourceDevice);
      rwBleLog('handshake-link-created', {
        deviceId,
        deviceName,
        elapsedMs: Date.now() - handshakeStartedAt
      });
      try {
        await setMTU(deviceId);
        rwBleLog('handshake-mtu-ok', {
          deviceId,
          elapsedMs: Date.now() - handshakeStartedAt
        });
      } catch (error) {
        // Some Android stacks report setBLEMTU:fail:internal even after the BLE link is usable.
        rwBleLog('handshake-mtu-skip', {
          deviceId,
          elapsedMs: Date.now() - handshakeStartedAt,
          message: formatError(error)
        });
      }
      const device = await discoverServicesAndChars(deviceId, deviceName, sourceDevice);
      rwBleLog('handshake-discovery-ok', {
        deviceId,
        serviceId: device.serviceId,
        cmdCharId: device.cmdCharId,
        dataServiceId: device.dataServiceId,
        dataCharId: device.dataCharId,
        elapsedMs: Date.now() - handshakeStartedAt
      });
      const notifyCandidates = uniqueNotifyCandidates([
        ...(device.dataServiceId && device.dataCharId ? [{ serviceId: device.dataServiceId || device.serviceId || '', characteristicId: device.dataCharId }] : []),
        ...(((device as RingDeviceInfo).notifyCandidates || []) as RwNotifyCandidate[])
      ]).filter((candidate) => candidate.serviceId && candidate.characteristicId);

      if (notifyCandidates.length === 0) {
        throw new Error('RW ring notify characteristic was not found.');
      }

      const enabledNotify = await enablePrimaryNotifyChannel(deviceId, notifyCandidates);
      rwBleLog('handshake-notify-ok', {
        deviceId,
        serviceId: enabledNotify.serviceId,
        characteristicId: enabledNotify.characteristicId,
        elapsedMs: Date.now() - handshakeStartedAt
      });
      rwBleLog('notify-primary-enabled', {
        deviceId,
        serviceId: enabledNotify.serviceId,
        characteristicId: enabledNotify.characteristicId
      });
      currentDevice = {
        ...device,
        dataServiceId: enabledNotify.serviceId,
        dataCharId: enabledNotify.characteristicId,
        notifyEnabled: true,
        notifyError: ''
      };
      connectionGeneration += 1;
      activeL19HistorySession = null;
      cacheServiceId(deviceId, currentDevice.serviceId || '');
      cacheServiceId(currentDevice.mac || currentDevice.advertis?.macInfo || currentDevice.uniMacId || '', currentDevice.serviceId || '');
      runtime?.onDeviceReady?.(currentDevice);
      void runRwAppReadyPreflight('connect-ready', { force: true }).catch((error) => {
        rwBleLog('rw-app-preflight-fail', {
          reason: 'connect-ready',
          deviceId,
          error: formatError(error)
        });
      });
      void enableAlternateNotifyChannels(deviceId, notifyCandidates, enabledNotify);
      void readStandardBatteryLevel('connect-ready');
      void readStandardDeviceInformationVersions('connect-ready');
      void readStandardHeartRateMeasurement('connect-ready');
      void readStandardPulseOximeterMeasurement('connect-ready');
      rwBleLog('handshake-ready', {
        deviceId,
        deviceName,
        elapsedMs: Date.now() - handshakeStartedAt,
        serviceId: currentDevice.serviceId,
        cmdCharId: currentDevice.cmdCharId,
        dataServiceId: currentDevice.dataServiceId,
        dataCharId: currentDevice.dataCharId
      });
      return currentDevice;
    } catch (error) {
      currentDevice = {};
      runtime?.onDeviceReady?.({} as RingDeviceInfo);
      rwBleLog('connect-discover-fail', {
        deviceId,
        deviceName,
        elapsedMs: Date.now() - handshakeStartedAt,
        message: formatError(error)
      });
      await disconnect(deviceId);
      throw error;
    } finally {
      connectHandshakeInFlight = false;
    }
  };

  const enablePrimaryNotifyChannel = async (deviceId: string, candidates: RwNotifyCandidate[]) => {
    const errors: string[] = [];

    for (const candidate of candidates) {
      try {
        await enableNotify(deviceId, candidate.serviceId, candidate.characteristicId);
        if (errors.length > 0) {
          rwBleLog('notify-primary-fallback-enabled', {
            deviceId,
            serviceId: candidate.serviceId,
            characteristicId: candidate.characteristicId,
            previousErrors: errors
          });
        }
        return candidate;
      } catch (error) {
        const message = `${candidate.serviceId}/${candidate.characteristicId}: ${formatError(error)}`;
        errors.push(message);
        rwBleLog('notify-primary-candidate-fail', {
          deviceId,
          serviceId: candidate.serviceId,
          characteristicId: candidate.characteristicId,
          error: formatError(error)
        });
      }
    }

    throw new Error(`RW notify failed candidates=${errors.join(' | ') || 'none'}`);
  };

  const enableNotify = async (deviceId: string, serviceId: string, characteristicId: string) => {
    setupDataListener();
    const chars = await getCharacteristics(deviceId, serviceId).catch(() => []);
    const targetChar = chars.find((char) => sameUuid(char.uuid, characteristicId));
    const charSummary = targetChar ? formatCharacteristic(targetChar) : `${characteristicId}(not found in characteristic list)`;

    const changeNotify = (state: boolean, timeoutMs: number) =>
      rejectBleCallAfter(
        new Promise<unknown>((resolve, reject) => {
          uni.notifyBLECharacteristicValueChange({
            state,
            deviceId,
            serviceId,
            characteristicId,
            success: resolve,
            fail: reject
          });
        }),
        timeoutMs,
        `notifyBLECharacteristicValueChange(${state ? 'on' : 'off'})`
      );

    const errors: string[] = [];

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await sleep(attempt === 1 ? 500 : 800);
      // 关闭通知只是为了清状态，静默丢回调就按已关闭处理，不值得等满超时。
      await changeNotify(false, RW_QUIET_BLE_CALL_TIMEOUT_MS).catch(() => undefined);
      await sleep(300);

      try {
        await changeNotify(true, RW_NOTIFY_ENABLE_TIMEOUT_MS);
        return undefined;
      } catch (error) {
        errors.push(`attempt${attempt}=${formatError(error)}`);
      }
    }

    throw new Error(`RW notify failed char=${charSummary} errors=${errors.join(' | ')}`);
  };

  const enableNotifyOnce = async (deviceId: string, serviceId: string, characteristicId: string) => {
    setupDataListener();
    await sleep(250);
    return rejectBleCallAfter(
      new Promise<unknown>((resolve, reject) => {
        uni.notifyBLECharacteristicValueChange({
          state: true,
          deviceId,
          serviceId,
          characteristicId,
          success: resolve,
          fail: reject
        });
      }),
      RW_NOTIFY_ENABLE_TIMEOUT_MS,
      'notifyBLECharacteristicValueChange(alternate-on)'
    );
  };

  const enableAlternateNotifyChannels = async (deviceId: string, candidates: RwNotifyCandidate[], primary: RwNotifyCandidate) => {
    const errors: string[] = [];
    const alternateCandidates = candidates
      .filter((candidate) => !sameUuid(candidate.serviceId, primary.serviceId) || !sameUuid(candidate.characteristicId, primary.characteristicId))
      .slice(0, RW_ALTERNATE_NOTIFY_MAX_BACKGROUND_CANDIDATES);
    for (const candidate of alternateCandidates) {
      if (sameUuid(candidate.serviceId, primary.serviceId) && sameUuid(candidate.characteristicId, primary.characteristicId)) {
        continue;
      }

      try {
        await enableNotifyOnce(deviceId, candidate.serviceId, candidate.characteristicId);
        rwBleLog('notify-alt-enabled', {
          deviceId,
          serviceId: candidate.serviceId,
          characteristicId: candidate.characteristicId
        });
      } catch (error) {
        const message = `${candidate.serviceId}/${candidate.characteristicId}: ${formatError(error)}`;
        errors.push(message);
        rwBleLog('notify-alt-fail', {
          deviceId,
          serviceId: candidate.serviceId,
          characteristicId: candidate.characteristicId,
          error: formatError(error)
        });
      }
    }
    return errors;
  };

  const invalidateWriteQueue = () => {
    // 只作废还没开始执行的写入；链本身保留，避免和旧链路里的在途写入并发。
    writeQueueGeneration += 1;
  };

  const enqueueWrite = <T>(task: () => Promise<T>) => {
    const generation = writeQueueGeneration;
    const queued = writeQueue
      .catch(() => undefined)
      .then(() => {
        if (generation !== writeQueueGeneration) {
          throw new Error('RW write queue was reset before the command ran.');
        }
        return task();
      });
    writeQueue = queued
      .catch(() => undefined)
      .then(async () => {
        if (!isNodeRuntime()) await sleep(20);
      });
    return queued;
  };

  const sendBytesToWriteCandidate = (bytes: Uint8Array, candidate: RwWriteCandidate, label?: string, probeLabel?: string, options?: RingWriteOptions) => {
    const device = getRuntimeDevice();
    if (!device.deviceId || !candidate.serviceId || !candidate.characteristicId) {
      throw new Error('RW ring device is not ready for command writes.');
    }

    const frameLog = summarizeRwBleFrameForLog(bytes, label, probeLabel);
    const writeBuffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
    rwBleLog('tx', {
      ...frameLog,
      deviceId: device.deviceId,
      serviceId: candidate.serviceId,
      characteristicId: candidate.characteristicId
    });

    const writeValue = (writeType: 'write' | 'writeNoResponse') =>
      new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          rwBleLog('tx-timeout', {
            ...frameLog,
            writeType,
            timeoutMs: RW_COMMAND_WRITE_TIMEOUT_MS,
            serviceId: candidate.serviceId,
            characteristicId: candidate.characteristicId
          });
          reject(markRwWriteTimeoutError(new Error(`RW write timed out after ${RW_COMMAND_WRITE_TIMEOUT_MS}ms (${writeType}).`)));
        }, RW_COMMAND_WRITE_TIMEOUT_MS);
        (timer as any).unref?.();
        const finish = () => {
          settled = true;
          clearTimeout(timer);
        };
        uni.writeBLECharacteristicValue({
          deviceId: device.deviceId!,
          serviceId: candidate.serviceId,
          characteristicId: candidate.characteristicId,
          value: writeBuffer as unknown as any[],
          writeType,
          success: (result) => {
            if (settled) return;
            finish();
            rwBleLog('tx-ok', {
              ...frameLog,
              writeType,
              serviceId: candidate.serviceId,
              characteristicId: candidate.characteristicId
            });
            resolve(result);
          },
          fail: (error) => {
            if (settled) return;
            finish();
            rwBleLog('tx-fail', {
              ...frameLog,
              writeType,
              serviceId: candidate.serviceId,
              characteristicId: candidate.characteristicId,
              error: formatError(error)
            });
            reject(error);
          }
        });
      });

    return enqueueWrite(() =>
      writeValue('write').catch((error) => {
        // 写超时无法确认帧到底发没发出去。破坏性命令重发可能直接执行第二遍，
        // 所以只允许对超时做失败处理，不再走 writeNoResponse 的降级重发。
        if (options?.allowTimeoutFallback === false && isRwWriteTimeoutError(error)) {
          if (!probeLabel) runtime?.onDisconnected?.(error);
          throw error;
        }
        return writeValue('writeNoResponse').catch((fallbackError) => {
          if (!probeLabel) runtime?.onDisconnected?.(fallbackError);
          throw fallbackError;
        });
      })
    );
  };

  const sendBytes = (bytes: Uint8Array, label?: string, options?: RingWriteOptions) => {
    const device = getRuntimeDevice();
    if (!device.deviceId || !device.serviceId || !device.cmdCharId) {
      throw new Error('RW ring device is not ready for command writes.');
    }

    return sendBytesToWriteCandidate(
      bytes,
      {
        serviceId: device.serviceId,
        characteristicId: device.cmdCharId
      },
      label,
      undefined,
      options
    );
  };

  const sendL19HistoryBytes = (bytes: Uint8Array, label?: string) => {
    if (!isL19HistoryDevice()) return sendBytes(bytes, label);

    const deviceId = currentDevice.deviceId;
    const serviceId = currentDevice.serviceId;
    const characteristicId = currentDevice.cmdCharId;
    if (!deviceId || !serviceId || !characteristicId) {
      throw new Error('RW L19 history device is not ready for command writes.');
    }

    const frameLog = summarizeRwBleFrameForLog(bytes, label);
    const writeBuffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
    rwBleLog('tx', {
      ...frameLog,
      deviceId,
      serviceId,
      characteristicId,
      writeType: 'platform-default',
      historyCompatibility: 'l19'
    });

    return enqueueWrite(
      () =>
        new Promise((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            rwBleLog('tx-timeout', {
              ...frameLog,
              deviceId,
              serviceId,
              characteristicId,
              writeType: 'platform-default',
              timeoutMs: RW_COMMAND_WRITE_TIMEOUT_MS,
              historyCompatibility: 'l19'
            });
            reject(new Error(`RW write timed out after ${RW_COMMAND_WRITE_TIMEOUT_MS}ms (l19 history).`));
          }, RW_COMMAND_WRITE_TIMEOUT_MS);
          (timer as any).unref?.();
          const finish = () => {
            settled = true;
            clearTimeout(timer);
          };
          uni.writeBLECharacteristicValue({
            deviceId,
            serviceId,
            characteristicId,
            value: writeBuffer as unknown as any[],
            success: (result) => {
              if (settled) return;
              finish();
              rwBleLog('tx-ok', {
                ...frameLog,
                deviceId,
                serviceId,
                characteristicId,
                writeType: 'platform-default',
                historyCompatibility: 'l19'
              });
              resolve(result);
            },
            fail: (error) => {
              if (settled) return;
              finish();
              rwBleLog('tx-fail', {
                ...frameLog,
                deviceId,
                serviceId,
                characteristicId,
                writeType: 'platform-default',
                historyCompatibility: 'l19',
                error: formatError(error)
              });
              reject(error);
            }
          });
        })
    );
  };

  const getAlternateWriteCandidates = () => {
    const device = getRuntimeDevice() as RingDeviceInfo;
    const writeCandidates = (device.writeCandidates || []) as RwWriteCandidate[];
    return writeCandidates.filter(
      (candidate) =>
        candidate.serviceId &&
        candidate.characteristicId &&
        RW_SERVICE_UUIDS.some((serviceId) => sameUuid(serviceId, candidate.serviceId)) &&
        !(sameUuid(candidate.serviceId, device.serviceId || '') && sameUuid(candidate.characteristicId, device.cmdCharId || ''))
    );
  };

  const probeAlternateWriteCandidates = async (bytes: Uint8Array, label: string, reason: string) => {
    const candidates = getAlternateWriteCandidates();
    if (candidates.length === 0) return;

    rwBleLog('tx-alt-probe', {
      label,
      reason,
      candidates
    });

    for (const candidate of candidates) {
      try {
        await sendBytesToWriteCandidate(bytes, candidate, label, reason);
        await sleep(80);
      } catch (error) {
        rwBleLog('tx-alt-probe-fail', {
          label,
          reason,
          candidate,
          error: formatError(error)
        });
      }
    }
  };

  const sendCommandsToAlternateWriteCandidates = async (commands: RwCommandWrite[], delayMs: number, reason: string) => {
    const candidates = getAlternateWriteCandidates();
    if (candidates.length === 0) return;
    const normalizedCommands = commands.map(normalizeCommandWrite);

    rwBleLog('tx-alt-probe', {
      reason,
      labels: normalizedCommands.map((command) => command.label).filter(Boolean),
      candidates
    });

    for (const candidate of candidates) {
      for (const command of normalizedCommands) {
        try {
          await sendBytesToWriteCandidate(command.bytes, candidate, command.label, reason);
          if (delayMs > 0) await sleep(delayMs);
        } catch (error) {
          rwBleLog('tx-alt-probe-fail', {
            label: command.label,
            reason,
            candidate,
            error: formatError(error)
          });
        }
      }
    }
  };

  const getSequentialProbeTimeoutMs = (commandCount: number, delayMs: number, candidateCount = 1) => {
    if (isNodeRuntime()) return getRwQuickResponseTimeoutMs();

    const safeCommandCount = Math.max(1, commandCount) * Math.max(1, candidateCount);
    const perCommandDelayMs = Math.max(80, delayMs);
    return Math.min(RW_FALLBACK_RESPONSE_TIMEOUT_CAP_MS, Math.max(RW_ALT_WRITE_PROBE_TIMEOUT_MS, safeCommandCount * perCommandDelayMs + RW_FALLBACK_RESPONSE_GRACE_MS));
  };

  const sendSequentialWithAlternateProbe = async (commands: RwCommandWrite[], delayMs: number, reason: string, predicate: (parsed: RingParsedData) => boolean) => {
    const mainFallbackWait = waitForParsedData(predicate, getSequentialProbeTimeoutMs(commands.length, delayMs));
    mainFallbackWait.catch(() => undefined);
    await sendSequential(commands, delayMs);
    try {
      await mainFallbackWait;
      return true;
    } catch {
      // Probe alternate write characteristics with the same fallback sequence.
    }

    const alternateCandidateCount = getAlternateWriteCandidates().length;
    if (alternateCandidateCount === 0) return false;

    const altFallbackWait = waitForParsedData(predicate, getSequentialProbeTimeoutMs(commands.length, delayMs, alternateCandidateCount));
    altFallbackWait.catch(() => undefined);
    await sendCommandsToAlternateWriteCandidates(commands, delayMs, reason);
    try {
      await altFallbackWait;
      return true;
    } catch {
      return false;
    }
  };

  const readStandardBatteryLevel = async (reason: string) => {
    const device = getRuntimeDevice() as RingDeviceInfo;
    const serviceId = device.standardBatteryServiceId;
    const characteristicId = device.standardBatteryCharId;
    if (!device.deviceId || !serviceId || !characteristicId) return;

    try {
      rwBleLog('standard-battery-read', {
        reason,
        deviceId: device.deviceId,
        serviceId,
        characteristicId
      });
      await readBleCharacteristicValue(device.deviceId, serviceId, characteristicId);
    } catch (error) {
      rwBleLog('standard-battery-read-fail', {
        reason,
        deviceId: device.deviceId,
        serviceId,
        characteristicId,
        error: formatError(error)
      });
    }
  };

  const readStandardHeartRateMeasurement = async (reason: string) => {
    const device = getRuntimeDevice() as RingDeviceInfo;
    const serviceId = device.standardHeartRateServiceId;
    const characteristicId = device.standardHeartRateCharId;
    if (!device.deviceId || !serviceId || !characteristicId || !device.standardHeartRateCanRead) return;

    try {
      rwBleLog('standard-heart-rate-read', {
        reason,
        deviceId: device.deviceId,
        serviceId,
        characteristicId
      });
      await readBleCharacteristicValue(device.deviceId, serviceId, characteristicId);
    } catch (error) {
      rwBleLog('standard-heart-rate-read-fail', {
        reason,
        deviceId: device.deviceId,
        serviceId,
        characteristicId,
        error: formatError(error)
      });
    }
  };

  const readStandardPulseOximeterMeasurement = async (reason: string) => {
    const device = getRuntimeDevice() as RingDeviceInfo;
    const serviceId = device.standardPulseOximeterServiceId;
    const characteristicId = device.standardPulseOximeterCharId;
    if (!device.deviceId || !serviceId || !characteristicId || !device.standardPulseOximeterCanRead) return;

    try {
      rwBleLog('standard-pulse-oximeter-read', {
        reason,
        deviceId: device.deviceId,
        serviceId,
        characteristicId
      });
      await readBleCharacteristicValue(device.deviceId, serviceId, characteristicId);
    } catch (error) {
      rwBleLog('standard-pulse-oximeter-read-fail', {
        reason,
        deviceId: device.deviceId,
        serviceId,
        characteristicId,
        error: formatError(error)
      });
    }
  };

  const readStandardDeviceInformationVersions = async (reason: string, alias?: L19VersionAliasType) => {
    const device = getRuntimeDevice() as RingDeviceInfo;
    if (!device.deviceId) return;

    const reads = [
      ...(alias === 'softwareVersion' ? [{ label: 'software', serviceId: device.standardSoftwareServiceId, characteristicId: device.standardSoftwareCharId }] : []),
      ...(alias === 'hardwareVersion' ? [{ label: 'hardware', serviceId: device.standardHardwareServiceId, characteristicId: device.standardHardwareCharId }] : []),
      ...(alias
        ? []
        : [
            { label: 'firmware', serviceId: device.standardFirmwareServiceId, characteristicId: device.standardFirmwareCharId },
            { label: 'hardware', serviceId: device.standardHardwareServiceId, characteristicId: device.standardHardwareCharId },
            { label: 'software', serviceId: device.standardSoftwareServiceId, characteristicId: device.standardSoftwareCharId }
          ]),
      { label: 'firmware', serviceId: device.standardFirmwareServiceId, characteristicId: device.standardFirmwareCharId }
    ];
    const seen = new Set<string>();

    for (const item of reads) {
      if (!item.serviceId || !item.characteristicId) continue;
      const key = `${item.serviceId.toLowerCase()}|${item.characteristicId.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        rwBleLog('standard-device-info-read', {
          reason,
          alias,
          field: item.label,
          deviceId: device.deviceId,
          serviceId: item.serviceId,
          characteristicId: item.characteristicId
        });
        await readBleCharacteristicValue(device.deviceId, item.serviceId, item.characteristicId);
      } catch (error) {
        rwBleLog('standard-device-info-read-fail', {
          reason,
          alias,
          field: item.label,
          deviceId: device.deviceId,
          serviceId: item.serviceId,
          characteristicId: item.characteristicId,
          error: formatError(error)
        });
      }
    }
  };

  const sendCommand = (cmd: number, subcmd: number, payload?: LegacyCommandPayload): Promise<unknown> => {
    const bytes =
      payload instanceof Uint8Array
        ? payload
        : Array.isArray(payload)
          ? new Uint8Array(payload)
          : typeof payload === 'number'
            ? new Uint8Array([payload & 0xff])
            : new Uint8Array();

    if (cmd === 0x11 && subcmd === 0x01) return sendRwFirmwareVersionCommand('hardwareVersion');
    if (cmd === 0x11 && subcmd === 0x00) return sendRwFirmwareVersionCommand('softwareVersion');
    if (cmd === 0x12 && subcmd === 0x00) return sendRwBatteryCommand();
    if (cmd === 0x31 && subcmd === 0x00) return sendRwActiveMeasureCommand();
    if (cmd === 0x32 && subcmd === 0x00) return sendRwOxygenCommand();
    if (cmd === 0x34 && subcmd === 0x00) return sendRwBodyTemperatureCommand();
    if (cmd === 0x36 && (subcmd === 0x00 || subcmd === 0x01)) {
      return sendReadLocalDataCommand(...parseReadLocalDataPayload(payload));
    }
    if (cmd === 0x36 && subcmd === 0x03) return sendDeleteAllLocalDataCommand();
    if (cmd === 0x10 && subcmd === 0x01) return readDeviceTime();
    if (cmd === 0x10 && subcmd === 0x00) return updateDeviceTimeFromPayload(payload);
    if (cmd === 0x37 && subcmd === 0x00) return sendRwCollectPeriodSettingCommand(parseCollectPeriodPayload(payload));
    if (cmd === 0x37 && subcmd === 0x01) return readRwCollectPeriodCommand();
    if (cmd === 0x37 && subcmd === 0x02) return sendRwFactoryResetCommand();
    if (cmd === 0xa0 && subcmd === 0x00) {
      const { timestampMs, timezone } = parseUpdateTimePayload(payload);
      return sendFactoryResetWithTimeCommand(timestampMs, timezone);
    }

    return sendBytes(buildRwFrame(cmd, subcmd, bytes));
  };

  const sendSequential = async (commands: RwCommandWrite[], delayMs = 250) => {
    for (const command of commands) {
      const { bytes, label } = normalizeCommandWrite(command);
      await sendBytes(bytes, label);
      if (delayMs > 0) await sleep(delayMs);
    }
  };

  const sendBestEffortSequential = async (commands: RwCommandWrite[], delayMs = 120, source = 'rw-app') => {
    for (const command of commands) {
      const { bytes, label } = normalizeCommandWrite(command);
      try {
        await sendBytes(bytes, label);
      } catch (error) {
        rwBleLog(`${source}-command-fail`, {
          label,
          error: formatError(error)
        });
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  };

  const buildRwAppReadyPreflightCommands = (timestampMs = Date.now(), timezone = 8): RwCommandWrite[] => [
    { label: 'rw-app/login-bind', bytes: buildRwLoginBindCommand() },
    { label: 'rw-app/read-firmware', bytes: buildRwReadKeyCommand(RwKey.FirmwareVersion) },
    { label: 'rw-app/sync-time-zone', bytes: buildRwSetTimeZoneKeyCommand(timezone) },
    { label: 'rw-app/sync-time', bytes: buildRwSetDateTimeKeyCommand(timestampMs) },
    { label: 'rw-app/sync-time-format', bytes: buildRwSetTimeFormatKeyCommand(true) },
    { label: 'rw-app/read-function-v2', bytes: buildRwReadFunctionV2Command() },
    { label: 'rw-app/read-led-level', bytes: buildRwReadLedLevelCommand() },
    { label: 'rw-app/read-video-hid', bytes: buildRwReadVideoHidCommand() },
    { label: 'rw-app/read-wear-hand', bytes: buildRwReadRingWearHandCommand() },
    ...RW_APP_READY_MONITORING_KEYS.map((key) => ({
      label: `rw-app/default-monitoring-${key.toString(16)}`,
      bytes: buildRwSetHealthMonitoringCommand(key, {
        enabled: true,
        startHour: 0,
        startMinute: 0,
        endHour: 23,
        endMinute: 59,
        interval: RW_APP_READY_MONITORING_INTERVAL_MINUTES
      })
    }))
  ];

  const runRwAppReadyPreflight = async (reason = 'manual', options: { force?: boolean; timezone?: number } = {}) => {
    const device = getRuntimeDevice();
    if (!device.deviceId || !device.serviceId || !device.cmdCharId) {
      rwBleLog('rw-app-preflight-skip', {
        reason,
        skipReason: 'device-not-ready',
        deviceId: device.deviceId,
        serviceId: device.serviceId,
        cmdCharId: device.cmdCharId
      });
      return;
    }

    const now = Date.now();
    if (!options.force && lastRwAppReadyPreflightAt > 0 && now - lastRwAppReadyPreflightAt < RW_APP_READY_PREFLIGHT_TTL_MS) {
      rwBleLog('rw-app-preflight-skip', {
        reason,
        skipReason: 'recently-ran',
        elapsedMs: now - lastRwAppReadyPreflightAt
      });
      return;
    }
    if (rwAppReadyPreflightRunning) {
      rwBleLog('rw-app-preflight-join', { reason });
      return rwAppReadyPreflightRunning;
    }

    lastRwAppReadyPreflightAt = now;
    const timestampMs = Date.now();
    const timezone = options.timezone ?? 8;
    const commands = buildRwAppReadyPreflightCommands(timestampMs, timezone);
    const task = (async () => {
      rwBleLog('rw-app-preflight-start', {
        reason,
        commandCount: commands.length,
        timestampMs,
        timezone,
        deviceId: device.deviceId
      });
      await sendBestEffortSequential(commands, 140, 'rw-app-preflight');
      rwBleLog('rw-app-preflight-done', {
        reason,
        elapsedMs: Date.now() - timestampMs,
        commandCount: commands.length
      });
    })();
    rwAppReadyPreflightRunning = task.finally(() => {
      rwAppReadyPreflightRunning = null;
    });
    return rwAppReadyPreflightRunning;
  };

  const buildRwAppHistoryReadCommands = (intent: RwLocalDataReadIntent): RwAppHistoryReadCommand[] => {
    const requestedDataTypes = intent.dataTypes || (intent.dataType ? [normalizeRwHistoryDataType(intent.dataType)] : []);
    const requested = new Set(requestedDataTypes.filter(Boolean));
    const shouldRead = (type: string) => requested.size === 0 || requested.has(type);
    const commands: RwAppHistoryReadCommand[] = [];

    if (shouldRead('step')) {
      commands.push({ label: 'history/rw-app-current-day-step', key: RwKey.ActivityCurrentDay }, { label: 'history/rw-app-step-history', key: RwKey.Activity });
    }
    if (shouldRead('sleep')) {
      commands.push({ label: 'history/rw-app-sleep', key: RwKey.Sleep });
    }
    if (shouldRead('heart_rate')) {
      commands.push({ label: 'history/rw-app-heart-rate', key: RwKey.HeartRate });
    }
    if (shouldRead('blood_pressure')) {
      commands.push({ label: 'history/rw-app-blood-pressure', key: RwKey.BloodPressure });
    }
    if (shouldRead('blood_oxygen')) {
      commands.push({ label: 'history/rw-app-blood-oxygen', key: RwKey.BloodOxygen });
    }
    if (shouldRead('hrv')) {
      commands.push({ label: 'history/rw-app-hrv', key: RwKey.Hrv });
    }
    if (shouldRead('stress')) {
      commands.push({ label: 'history/rw-app-stress', key: RwKey.Stress });
    }
    return commands;
  };

  const isRwAppHistoryResponseFor = (parsed: RingParsedData, key: RwKey, flag: RwKeyFlag) =>
    parsed.protocol === 'rw' && ['rw_health_data', 'rw_health_data_ack'].includes(parsed.type) && Number(parsed.key) === key && (Number(parsed.flag) & 0xff) === flag;

  const hasRwAppHistoryPayload = (parsed: RingParsedData) => {
    if (Array.isArray(parsed.records) && parsed.records.length > 0) return true;
    if (parsed.value != null && parsed.value !== '') return true;
    const data = Array.isArray((parsed as { data?: unknown }).data) ? (parsed as { data?: unknown[] }).data || [] : [];
    return data.length > 1;
  };

  const sendRwAppHistoryReadDeleteLoop = async (command: RwAppHistoryReadCommand, source: string) => {
    let readCount = 0;
    for (; readCount < RW_APP_HISTORY_SYNC_LOOP_MAX_READS; readCount += 1) {
      const pendingRead = waitForParsedData((parsed) => isRwAppHistoryResponseFor(parsed, command.key, RwKeyFlag.Read), RW_APP_HISTORY_SYNC_RESPONSE_WAIT_MS);
      pendingRead.catch(() => undefined);

      await sendBytes(buildRwReadHealthDataCommand(command.key), `${command.label}/read`);

      let parsed: RingParsedData;
      try {
        parsed = await pendingRead;
      } catch (error) {
        rwBleLog('history-rw-app-loop-read-timeout', {
          source,
          label: command.label,
          key: command.key,
          readIndex: readCount + 1,
          error: formatError(error)
        });
        break;
      }

      const hasPayload = hasRwAppHistoryPayload(parsed);
      rwBleLog('history-rw-app-loop-read-response', {
        source,
        label: command.label,
        key: command.key,
        readIndex: readCount + 1,
        hasPayload,
        recordCount: Array.isArray(parsed.records) ? parsed.records.length : 0,
        value: parsed.value,
        dataLength: Array.isArray((parsed as { data?: unknown }).data) ? ((parsed as { data?: unknown[] }).data || []).length : 0
      });

      if (!hasPayload) break;

      const pendingDelete = waitForParsedData((deleteParsed) => isRwAppHistoryResponseFor(deleteParsed, command.key, RwKeyFlag.Delete), RW_APP_HISTORY_SYNC_DELETE_WAIT_MS);
      pendingDelete.catch(() => undefined);

      await sendBytes(buildRwDeleteHealthDataCommand(command.key), `${command.label}/delete-current-block`, RW_DESTRUCTIVE_WRITE_OPTIONS);

      try {
        const deleteParsed = await pendingDelete;
        rwBleLog('history-rw-app-loop-delete-response', {
          source,
          label: command.label,
          key: command.key,
          readIndex: readCount + 1,
          status: deleteParsed.status,
          statusCode: deleteParsed.statusCode
        });
      } catch (error) {
        rwBleLog('history-rw-app-loop-delete-timeout', {
          source,
          label: command.label,
          key: command.key,
          readIndex: readCount + 1,
          error: formatError(error)
        });
        break;
      }

      await sleep(140);
    }

    if (readCount >= RW_APP_HISTORY_SYNC_LOOP_MAX_READS) {
      rwBleLog('history-rw-app-loop-max-read-stop', {
        source,
        label: command.label,
        key: command.key,
        maxReads: RW_APP_HISTORY_SYNC_LOOP_MAX_READS
      });
    }
  };

  const sendRwAppHistorySyncProbe = async (intent: RwLocalDataReadIntent, source: string) => {
    const commands = buildRwAppHistoryReadCommands(intent);
    rwBleLog('history-rw-app-sync-start', {
      source,
      readAll: intent.readAll,
      sinceTimestamp: intent.sinceTimestamp,
      dataType: intent.dataType,
      dataTypes: intent.dataTypes,
      commandCount: commands.length
    });
    await runRwAppReadyPreflight('history-sync').catch((error) => {
      rwBleLog('history-rw-app-preflight-fail', {
        source,
        error: formatError(error)
      });
    });
    for (const command of commands) {
      await sendRwAppHistoryReadDeleteLoop(command, source);
      await sleep(140);
    }
    rwBleLog('history-rw-app-sync-sent', {
      source,
      commandCount: commands.length
    });
  };

  const isRwDeviceAppDataControlRequestFrame = (rawBytes: Uint8Array) =>
    rawBytes.length >= 12 &&
    rawBytes[0] === 0xab &&
    rawBytes[1] === 0x01 &&
    rawBytes[6] === RwKey.AppDataControl >> 8 &&
    rawBytes[7] === (RwKey.AppDataControl & 0xff) &&
    rawBytes[8] === 0x00 &&
    rawBytes[10] === 0x05;

  const acknowledgeRwDeviceAppDataControlRequest = (
    rawBytes: Uint8Array,
    meta: {
      deviceId?: string;
      serviceId?: string;
      characteristicId?: string;
      rawHex?: string;
    }
  ) => {
    if (!isRwDeviceAppDataControlRequestFrame(rawBytes)) return;
    const controlKey = rawBytes[9];
    const controlAction = rawBytes[11];
    rwBleLog('rw-app-control-device-request', {
      rawHex: meta.rawHex,
      deviceId: meta.deviceId,
      serviceId: meta.serviceId,
      characteristicId: meta.characteristicId,
      controlKey,
      controlAction
    });
    void sendBytes(buildRwAppDataControlAckCommand(), `rw-app-control-device-ack-${controlKey.toString(16)}`)
      .then(() => {
        rwBleLog('rw-app-control-device-ack-ok', {
          controlKey,
          controlAction
        });
      })
      .catch((error) => {
        rwBleLog('rw-app-control-device-ack-fail', {
          controlKey,
          controlAction,
          error: formatError(error)
        });
      });
  };

  const readAllMonitoringConfigs = () => {
    return sendSequential(RW_MONITORING_KEYS.map((key) => buildRwReadHealthMonitoringCommand(key)));
  };

  const readRwMonitoringConfig = (name: RwMonitoringName) => {
    return sendBytes(buildRwReadHealthMonitoringCommand(resolveRwMonitoringKey(name)));
  };

  const buildRwSetMonitoringConfigCommand = (key: RwKey, config: RwHealthMonitoringConfig) => {
    if (key === RwKey.TemperatureDetecting) {
      return buildRwSetBodyTemperatureDetectingCommand({
        enabled: config.enabled,
        startHour: config.startHour,
        startMinute: config.startMinute,
        endHour: config.endHour,
        endMinute: config.endMinute,
        duration: config.interval
      });
    }
    return buildRwSetHealthMonitoringCommand(key, config);
  };

  const setRwMonitoringConfig = (name: RwMonitoringName, config: RwHealthMonitoringConfig) => {
    return sendBytes(buildRwSetMonitoringConfigCommand(resolveRwMonitoringWriteKey(name), config));
  };

  const buildRwHealthDataReadCommandVariants = (name: RwHealthDataName): RwCommandWrite[] => {
    const normalizedName = normalizeRwHealthDataName(name);
    return buildRwRealtimeHealthDataReadCommands(normalizedName);
  };

  const readRwHealthData = (name: RwHealthDataName) => {
    const normalizedName = normalizeRwHealthDataName(name);
    return sendSequential(buildRwHealthDataReadCommandVariants(normalizedName), 80);
  };

  const deleteRwHealthData = (name: RwHealthDataName) => {
    const normalizedName = normalizeRwHealthDataName(name);
    const readableKey = resolveRwReadableHealthDataKey(normalizedName);
    rwBleLog('history-delete-current-block', {
      name: normalizedName,
      key: readableKey
    });
    return sendBytes(buildRwDeleteHealthDataCommand(readableKey), `${normalizedName}/health-delete-current-block`, RW_DESTRUCTIVE_WRITE_OPTIONS);
  };

  const controlRwHealthData = (name: RwHealthDataName, enabled = true) => {
    const normalizedName = normalizeRwHealthDataName(name);
    const controlKey = resolveRwHealthDataControlKey(normalizedName);
    const controlCommand = {
      label: `${normalizedName}/control-${enabled ? 'enable' : 'disable'}`,
      bytes: buildRwControlHealthDataCommand(controlKey, enabled)
    };
    const pendingControl: RwPendingHealthControl = {
      name: normalizedName,
      controlKey,
      enabled,
      expiresAt: Date.now() + RW_REALTIME_ALIAS_TTL_MS
    };
    pendingHealthControls.push(pendingControl);
    const task = sendBytes(controlCommand.bytes, controlCommand.label);
    task.catch(() => {
      const index = pendingHealthControls.indexOf(pendingControl);
      if (index >= 0) pendingHealthControls.splice(index, 1);
    });
    return task;
  };

  const buildRwControlAndReadHealthDataCommands = (name: RwHealthDataName): RwCommandWrite[] => {
    const normalizedName = normalizeRwHealthDataName(name);
    return [
      {
        label: `${normalizedName}/control-enable`,
        bytes: buildRwControlHealthDataCommand(resolveRwHealthDataControlKey(normalizedName), true)
      },
      ...buildRwHealthDataReadCommandVariants(normalizedName)
    ];
  };

  const sendRwRealtimeMetricCommand = async (name: RwHealthDataName, alias?: L19MetricAliasType) => {
    const normalizedName = normalizeRwHealthDataName(name);
    if (alias) addPendingMetricAlias(alias);
    try {
      await controlRwHealthData(normalizedName, true);
      await sleep(120);
      await readRwHealthData(normalizedName);
    } catch (error) {
      if (alias) clearPendingMetricAlias(alias);
      throw error;
    } finally {
      await controlRwHealthData(normalizedName, false).catch(() => undefined);
    }
  };

  const addPendingMetricAlias = (alias: L19MetricAliasType) => {
    if (alias === 'active_measure') {
      pendingActiveMeasureAlias = createActiveMeasureAliasState();
      return;
    }

    pendingMetricAliases.push({
      type: alias,
      expiresAt: Date.now() + RW_REALTIME_ALIAS_TTL_MS
    });
  };

  const clearPendingMetricAlias = (alias: L19MetricAliasType) => {
    if (alias === 'active_measure') {
      pendingActiveMeasureAlias = null;
      return;
    }

    const index = pendingMetricAliases.map((item) => item.type).lastIndexOf(alias);
    if (index >= 0) pendingMetricAliases.splice(index, 1);
  };

  const sendRwActiveMeasureCommand = () => sendRwRealtimeMetricCommand('heart_rate', 'active_measure');

  const sendRwBatteryCommand = async () => {
    const [primary, ...fallbacks] = buildRwBatteryCommandVariants();
    const primaryLabel = `battery/${primary.label}`;
    const quickBatteryWait = waitForParsedData((parsed) => parsed.type === 'battery', getRwQuickResponseTimeoutMs());
    quickBatteryWait.catch(() => undefined);

    await sendBytes(primary.bytes, primaryLabel);
    void readStandardBatteryLevel('primary');

    try {
      await quickBatteryWait;
      return;
    } catch {
      rwBleLog('battery-primary-timeout', {
        label: primaryLabel,
        timeoutMs: getRwQuickResponseTimeoutMs()
      });
      if (!isRwCompatibilityFallbackEnabled()) return;
    }

    const altBatteryWait = waitForParsedData((parsed) => parsed.type === 'battery', getRwQuickResponseTimeoutMs());
    altBatteryWait.catch(() => undefined);
    await probeAlternateWriteCandidates(primary.bytes, primaryLabel, 'battery-no-primary-rx');
    try {
      await altBatteryWait;
      return;
    } catch {
      // Continue with known RW battery command variants used by older SY03 firmware.
    }

    if (fallbacks.length > 0) {
      const fallbackCommands = fallbacks.map((item) => ({ bytes: item.bytes, label: `battery/${item.label}` }));
      await sendSequentialWithAlternateProbe(fallbackCommands, 80, 'battery-fallback-no-rx', (parsed) => parsed.type === 'battery');
      void readStandardBatteryLevel('fallback');
    }
  };

  const sendRwOxygenCommand = () => sendRwRealtimeMetricCommand('blood_oxygen', 'active_OxyGenMeasure');

  const sendRwBodyTemperatureCommand = () => sendRwRealtimeMetricCommand('temperature', 'active_Temperature');

  const setRwUserProfile = (profile: RwUserProfile) => {
    return sendBytes(buildRwSetUserProfileCommand(profile));
  };

  const syncAllHealthData = () => {
    return readLocalData({ readAll: true });
  };

  const syncHealthDataByType = (_name?: RwHistoryDataName) => {
    return readLocalData({ readAll: true, dataType: _name });
  };

  const writeAllMonitoringIntervals = (seconds = 1800) => {
    const interval = secondsToRwIntervalMinutes(seconds);
    return sendSequential(
      RW_MONITORING_WRITE_KEYS.map((key) =>
        buildRwSetMonitoringConfigCommand(key, {
          enabled: true,
          startHour: 0,
          startMinute: 0,
          endHour: 23,
          endMinute: 59,
          interval
        })
      )
    );
  };

  const readRwCollectPeriodCommand = async () => {
    const quickCollectReadWait = waitForParsedData((parsed) => parsed.type === 'collect_period_read', 220);
    quickCollectReadWait.catch(() => undefined);

    await sendBytes(buildRwFrame(0x37, 0x01));

    try {
      await quickCollectReadWait;
      return;
    } catch {
      // Continue with RW App SDK monitoring reads for newer SY03 firmware.
    }

    pendingCollectPeriodReadAlias = {
      expiresAt: Date.now() + ACTIVE_MEASURE_ALIAS_TTL_MS
    };
    try {
      return await readAllMonitoringConfigs();
    } catch (error) {
      pendingCollectPeriodReadAlias = null;
      throw error;
    }
  };

  const sendRwCollectPeriodSettingCommand = async (seconds = 1800) => {
    const quickCollectSetWait = waitForParsedData((parsed) => parsed.type === 'collect_period_set', 220);
    quickCollectSetWait.catch(() => undefined);

    await sendBytes(buildRwFrame(0x37, 0x00, numberToUint32LE(seconds)));

    try {
      await quickCollectSetWait;
      return;
    } catch {
      // Continue with RW App SDK monitoring writes for newer SY03 firmware.
    }

    pendingCollectPeriodSetAlias = {
      expiresAt: Date.now() + ACTIVE_MEASURE_ALIAS_TTL_MS
    };
    try {
      return await writeAllMonitoringIntervals(seconds);
    } catch (error) {
      pendingCollectPeriodSetAlias = null;
      throw error;
    }
  };

  const sendFactoryResetWithTimeCommand = async (timestampMs = Date.now(), timezone = 8): Promise<unknown> => {
    await sendBytes(buildRwSetTimeZoneKeyCommand(timezone), 'factory-reset-sync-time-zone-key');
    await sleep(120);
    await sendBytes(buildRwSetDateTimeKeyCommand(timestampMs), 'factory-reset-sync-time-key');
    await sleep(250);
    await sendBytes(buildRwSetTimeFormatKeyCommand(true), 'factory-reset-sync-time-format-key');
    await sleep(120);
    await sendBytes(buildRwSyncTimeCommand(timestampMs, timezone), 'factory-reset-sync-time-frame');
    await sleep(250);
    return sendRwFactoryResetCommand();
  };

  const sendRwFactoryResetCommand = () => {
    return sendBytes(buildRwFrame(0x37, 0x02), 'factory-reset', RW_DESTRUCTIVE_WRITE_OPTIONS);
  };

  const sendRwFirmwareVersionCommand = async (alias?: L19VersionAliasType) => {
    if (alias) {
      pendingFirmwareAliases.push({
        type: alias,
        expiresAt: Date.now() + ACTIVE_MEASURE_ALIAS_TTL_MS
      });
    }
    const clearPendingFirmwareAlias = () => {
      if (!alias) return;
      const index = pendingFirmwareAliases.map((item) => item.type).lastIndexOf(alias);
      if (index >= 0) pendingFirmwareAliases.splice(index, 1);
    };
    const [primary, ...fallbacks] = buildRwFirmwareVersionCommandVariants(alias);
    const quickVersionWait = waitForParsedData((parsed) => isVersionAliasParsed(parsed, alias), getRwQuickResponseTimeoutMs());
    quickVersionWait.catch(() => undefined);

    try {
      const targetLabel = alias || 'firmware';
      const primaryLabel = `${targetLabel}/${primary.label}`;
      await sendBytes(primary.bytes, primaryLabel);
      void readStandardDeviceInformationVersions('primary', alias);
      try {
        await quickVersionWait;
        clearPendingFirmwareAlias();
        return;
      } catch {
        rwBleLog('firmware-primary-timeout', {
          targetLabel,
          alias,
          label: primaryLabel,
          timeoutMs: getRwQuickResponseTimeoutMs()
        });
        if (!isRwCompatibilityFallbackEnabled()) {
          clearPendingFirmwareAlias();
          return;
        }
      }

      const altVersionWait = waitForParsedData((parsed) => isVersionAliasParsed(parsed, alias), getRwQuickResponseTimeoutMs());
      altVersionWait.catch(() => undefined);
      await probeAlternateWriteCandidates(primary.bytes, primaryLabel, `${targetLabel}-no-primary-rx`);
      try {
        await altVersionWait;
        clearPendingFirmwareAlias();
        return;
      } catch {
        // Continue with RW App SDK read-key for firmware/version on newer SY03 firmware.
      }

      if (fallbacks.length > 0) {
        const fallbackCommands = fallbacks.map((item) => ({ bytes: item.bytes, label: `${targetLabel}/${item.label}` }));
        await sendSequentialWithAlternateProbe(fallbackCommands, 80, `${targetLabel}-fallback-no-rx`, (parsed) => isVersionAliasParsed(parsed, alias));
      }
    } catch (error) {
      clearPendingFirmwareAlias();
      throw error;
    }
  };

  const readDeviceTime = async () => {
    await sendBytes(buildRwReadDateTimeKeyCommand(), 'read-device-time-key');
    await sleep(250);
    return sendBytes(buildRwReadTimeCommand(), 'read-device-time-frame');
  };

  const updateDeviceTime = async (timestampMs = Date.now(), timezone = 8) => {
    await sendBytes(buildRwSetTimeZoneKeyCommand(timezone), 'sync-device-time-zone-key');
    await sleep(120);
    await sendBytes(buildRwSetDateTimeKeyCommand(timestampMs), 'sync-device-time-key');
    await sleep(250);
    await sendBytes(buildRwSetTimeFormatKeyCommand(true), 'sync-device-time-format-key');
    await sleep(120);
    await sendBytes(buildRwSyncTimeCommand(timestampMs, timezone), 'sync-device-time-frame');
    await sleep(500);
    return readDeviceTime();
  };

  const updateDeviceTimeFromPayload = (payload?: LegacyCommandPayload) => {
    const { timestampMs, timezone } = parseUpdateTimePayload(payload);
    return updateDeviceTime(timestampMs, timezone);
  };

  const sendReadLocalDataCommand = async (sinceTimestamp = 0, readAll = true) => {
    const intent = resolveRwLocalDataReadIntent({ sinceTimestamp, readAll });
    lastLocalDataReadIntent = intent;
    rwBleLog('history-read-file-list-request', {
      source: 'sendReadLocalDataCommand',
      readAll: intent.readAll,
      sinceTimestamp: intent.sinceTimestamp,
      dataType: intent.dataType,
      dataTypes: intent.dataTypes
    });
    await sendRwAppHistorySyncProbe(intent, 'sendReadLocalDataCommand').catch((error) => {
      rwBleLog('history-rw-app-sync-fail', {
        source: 'sendReadLocalDataCommand',
        error: formatError(error)
      });
    });
    return sendBytes(buildRwReadFileListCommand(), 'history/read-file-list');
  };

  const readLocalData = async (options: LegacyReadLocalDataOptions = {}) => {
    const intent = resolveRwLocalDataReadIntent(options);
    lastLocalDataReadIntent = intent;
    rwBleLog('history-read-file-list-request', {
      source: 'readLocalData',
      readAll: intent.readAll,
      sinceTimestamp: intent.sinceTimestamp,
      dataType: intent.dataType,
      dataTypes: intent.dataTypes
    });
    await sendRwAppHistorySyncProbe(intent, 'readLocalData').catch((error) => {
      rwBleLog('history-rw-app-sync-fail', {
        source: 'readLocalData',
        error: formatError(error)
      });
    });
    return sendBytes(buildRwReadFileListCommand(), 'history/read-file-list');
  };

  const sendRwFormatFileSystemCommand = async () => {
    pendingDeleteAllLocalDataAlias = {
      expiresAt: Date.now() + ACTIVE_MEASURE_ALIAS_TTL_MS
    };
    try {
      return await sendBytes(buildRwFormatFileSystemFrame(), 'format-file-system', RW_DESTRUCTIVE_WRITE_OPTIONS);
    } catch (error) {
      pendingDeleteAllLocalDataAlias = null;
      throw error;
    }
  };

  const sendDeleteAllLocalDataCommand = async () => {
    const quickDeleteWait = waitForParsedData((parsed) => parsed.type === 'delete_all_local_data', 220);
    quickDeleteWait.catch(() => undefined);

    await sendBytes(buildRwFrame(0x36, 0x03), 'delete-all-local-data', RW_DESTRUCTIVE_WRITE_OPTIONS);

    try {
      await quickDeleteWait;
      return;
    } catch {
      // Continue with RW App SDK file-system format for newer SY03 firmware.
    }

    return sendRwFormatFileSystemCommand();
  };

  const sendNamedCommand = (command: LegacyRingCommand, payload?: LegacyCommandPayload) => {
    switch (command) {
      case LegacyRingCommand.HardwareVersion:
        return sendRwFirmwareVersionCommand('hardwareVersion');
      case LegacyRingCommand.SoftwareVersion:
        return sendRwFirmwareVersionCommand('softwareVersion');
      case LegacyRingCommand.Battery:
        return sendRwBatteryCommand();
      case LegacyRingCommand.ActiveMeasure:
        return sendRwActiveMeasureCommand();
      case LegacyRingCommand.BloodOxygen:
        return sendRwOxygenCommand();
      case LegacyRingCommand.BodyTemperature:
        return sendRwBodyTemperatureCommand();
      case LegacyRingCommand.ReadLocalData:
        return sendReadLocalDataCommand(...parseReadLocalDataPayload(payload));
      case LegacyRingCommand.ReadDeviceTime:
        return readDeviceTime();
      case LegacyRingCommand.UpdateDeviceTime:
        return updateDeviceTimeFromPayload(payload);
      case LegacyRingCommand.DeleteAllLocalData:
        return sendDeleteAllLocalDataCommand();
      case LegacyRingCommand.FactoryReset:
        return sendRwFactoryResetCommand();
      case LegacyRingCommand.SetCollectPeriod:
        return sendRwCollectPeriodSettingCommand(parseCollectPeriodPayload(payload));
      case LegacyRingCommand.ReadCollectPeriod:
        return readRwCollectPeriodCommand();
      default:
        return notSupported(`sendNamedCommand ${command}`)();
    }
  };

  const waitForParsedData = (predicate: (parsed: RingParsedData) => boolean, timeoutMs = 15000, options?: { replayRecent?: boolean }) => {
    const cachedParsed = options?.replayRecent ? takeRecentParsedData(predicate) : null;
    if (cachedParsed) {
      rwBleLog('wait-cache-hit', {
        timeoutMs,
        parsed: summarizeParsedForRwBleLog(cachedParsed)
      });
      return Promise.resolve(cachedParsed);
    }

    const promise = new Promise<RingParsedData>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = parsedWaiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) parsedWaiters.splice(index, 1);
        rwBleLog('wait-timeout', {
          timeoutMs,
          pendingWaiters: parsedWaiters.length
        });
        reject(new Error(`RW parsed data wait timeout after ${timeoutMs}ms.`));
      }, timeoutMs);

      parsedWaiters.push({ predicate, resolve, reject, timer });
    });
    promise.catch(() => undefined);
    return promise;
  };

  const enrichRwFileListWithReadIntent = (parsed: RingParsedData) => {
    if (parsed.type !== 'rw_file_list' || !lastLocalDataReadIntent) return parsed;
    if (isPendingAliasExpired(lastLocalDataReadIntent)) {
      lastLocalDataReadIntent = null;
      return parsed;
    }

    const files = Array.isArray(parsed.files) ? parsed.files : [];
    const selectedFiles = filterRwFilesByReadIntent(files, lastLocalDataReadIntent);
    return {
      ...parsed,
      files,
      allFiles: files,
      selectedFiles,
      totalFileCount: files.length,
      selectedFileCount: selectedFiles.length,
      filteredFileCount: Math.max(0, files.length - selectedFiles.length),
      readAll: lastLocalDataReadIntent.readAll,
      sinceTimestamp: lastLocalDataReadIntent.sinceTimestamp,
      dataType: lastLocalDataReadIntent.dataType,
      dataTypes: lastLocalDataReadIntent.dataTypes
    };
  };

  const takeMetricAliasForParsed = (parsed: RingParsedData): RingParsedData | null => {
    if (!isRwMetricAliasSource(parsed)) return null;

    const activeMeasureAlias = takeActiveMeasureAliasForParsed(parsed);
    if (activeMeasureAlias) return activeMeasureAlias;

    pruneExpiredAliases(pendingMetricAliases);

    const aliasIndex = pendingMetricAliases.findIndex((alias) => isMetricAliasMatch(alias.type, parsed));
    if (aliasIndex < 0) return null;

    const pendingAlias = pendingMetricAliases[aliasIndex];
    const alias = pendingAlias.type;
    const value = getRwMetricAliasValue(parsed);
    const legacyStatus = getLegacyMeasureStatusCode(parsed, value != null);
    const timestamp = parsed.timestamp || Date.now();
    const hasFailureStatus = isRwMetricFailureStatus(parsed);

    if (alias === 'active_OxyGenMeasure') {
      if (value == null && !hasFailureStatus) return null;
      pendingMetricAliases.splice(aliasIndex, 1);
      return {
        ...parsed,
        type: 'active_OxyGenMeasure',
        protocol: 'rw',
        ...(parsed.heartRate != null ? { heartRate: parsed.heartRate } : {}),
        ...(value != null ? { bloodOxygen: value } : {}),
        bloodOxygenStatus: legacyStatus,
        status: parsed.status || 'normal',
        timestamp
      };
    }

    if (value == null && !hasFailureStatus) return null;
    pendingMetricAliases.splice(aliasIndex, 1);
    return {
      ...parsed,
      type: 'active_Temperature',
      protocol: 'rw',
      temperature: formatLegacyTemperatureValue(value),
      temperatureValue: value,
      temperatureStatus: legacyStatus,
      status: parsed.status || 'normal',
      timestamp
    };
  };

  const takeActiveMeasureAliasForParsed = (parsed: RingParsedData): RingParsedData | null => {
    if (!pendingActiveMeasureAlias) return null;
    if (Date.now() > pendingActiveMeasureAlias.expiresAt) {
      pendingActiveMeasureAlias = null;
      return null;
    }

    const name = getActiveMeasureAliasName(parsed);
    if (!name) return null;

    const state = pendingActiveMeasureAlias;
    const value = getRwMetricAliasValue(parsed);
    const legacyStatus = getLegacyMeasureStatusCode(parsed, value != null);
    const hasFailureStatus = isRwMetricFailureStatus(parsed);
    if (value == null && !hasFailureStatus) return null;

    if (name === 'heart_rate') state.heartRate = value ?? state.heartRate;
    if (name === 'hrv') state.heartRateVariability = value ?? state.heartRateVariability;
    if (name === 'stress') state.stressIndex = value ?? state.stressIndex;
    state.received[name] = true;

    if (state.heartRate == null && !hasFailureStatus) return null;

    const alias = {
      ...parsed,
      type: 'active_measure',
      protocol: 'rw',
      heartRate: state.heartRate,
      heartRateVariability: state.heartRateVariability,
      stressIndex: state.stressIndex,
      heartbeatStatus: legacyStatus,
      status: parsed.status || 'normal',
      timestamp: parsed.timestamp || Date.now()
    };

    if (state.received.heart_rate && state.received.hrv && state.received.stress) {
      pendingActiveMeasureAlias = null;
    }

    return alias;
  };

  const takeLocalDataAliasForParsed = (parsed: RingParsedData): RingParsedData | null => {
    if (parsed.type !== 'rw_file_list') return null;

    const selectedFiles = Array.isArray(parsed.selectedFiles) ? parsed.selectedFiles : Array.isArray(parsed.files) ? parsed.files : [];
    const totalFileCount = typeof parsed.totalFileCount === 'number' ? parsed.totalFileCount : Array.isArray(parsed.files) ? parsed.files.length : 0;
    const selectedFileCount = typeof parsed.selectedFileCount === 'number' ? parsed.selectedFileCount : selectedFiles.length;

    return {
      ...parsed,
      type: 'local_data',
      protocol: 'rw',
      status: selectedFileCount > 0 ? 'file_list' : totalFileCount > 0 ? 'filtered' : 'empty',
      records: [],
      files: selectedFiles,
      allFiles: parsed.allFiles || parsed.files || [],
      totalNum: 0,
      totalFileCount,
      selectedFileCount,
      filteredFileCount: typeof parsed.filteredFileCount === 'number' ? parsed.filteredFileCount : Math.max(0, totalFileCount - selectedFileCount),
      readAll: parsed.readAll,
      sinceTimestamp: parsed.sinceTimestamp,
      message:
        selectedFileCount > 0
          ? 'RW history file list is ready; use syncHistory to upload file payloads.'
          : totalFileCount > 0
            ? 'RW history files are outside the current read range or type filter.'
            : 'RW history file list is empty.'
    };
  };

  const takeCollectPeriodAliasForParsed = (parsed: RingParsedData): RingParsedData | null => {
    if (isPendingAliasExpired(pendingCollectPeriodReadAlias)) {
      pendingCollectPeriodReadAlias = null;
    }
    if (isPendingAliasExpired(pendingCollectPeriodSetAlias)) {
      pendingCollectPeriodSetAlias = null;
    }

    if (pendingCollectPeriodReadAlias && parsed.type === 'rw_health_monitoring') {
      pendingCollectPeriodReadAlias = null;
      const intervalMinutes = typeof parsed.interval === 'number' ? parsed.interval : Number(parsed.minutes || 0);
      const period = typeof parsed.period === 'number' ? parsed.period : intervalMinutes > 0 ? intervalMinutes * 60 : undefined;
      const minutes = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes.toFixed(1) : parsed.minutes;
      return {
        ...parsed,
        type: 'collect_period_read',
        protocol: 'rw',
        period,
        minutes,
        minutesValue: Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : undefined,
        timestamp: parsed.timestamp || Date.now()
      };
    }

    if (pendingCollectPeriodSetAlias && (parsed.type === 'rw_health_monitoring_ack' || parsed.type === 'rw_health_monitoring')) {
      pendingCollectPeriodSetAlias = null;
      return {
        ...parsed,
        type: 'collect_period_set',
        protocol: 'rw',
        status: parsed.status || (parsed.success === false ? 'failed' : 'success'),
        success: parsed.success ?? parsed.status !== 'failed',
        timestamp: parsed.timestamp || Date.now()
      };
    }

    return null;
  };

  const takeL19CompatAliases = (parsed: RingParsedData) => {
    if (parsed.type === 'firmware_version') {
      pruneExpiredAliases(pendingFirmwareAliases);
    }

    if (parsed.type === 'firmware_version' && pendingFirmwareAliases.length > 0) {
      return pendingFirmwareAliases.splice(0).map(({ type }) =>
        markParsedAsEmitted({
          ...parsed,
          type,
          protocol: 'rw',
          value:
            type === 'hardwareVersion'
              ? (parsed.hardwareVersion ?? parsed.firmwareVersion ?? parsed.softwareVersion ?? parsed.uiVersion)
              : (parsed.softwareVersion ?? parsed.uiVersion ?? parsed.firmwareVersion ?? parsed.hardwareVersion),
          status: parsed.status || 'normal',
          timestamp: parsed.timestamp || Date.now()
        })
      );
    }

    const metricAlias = takeMetricAliasForParsed(parsed);
    if (metricAlias) return [markParsedAsEmitted(metricAlias)];

    const localDataAlias = takeLocalDataAliasForParsed(parsed);
    if (localDataAlias) return [markParsedAsEmitted(localDataAlias)];

    const collectPeriodAlias = takeCollectPeriodAliasForParsed(parsed);
    if (collectPeriodAlias) return [markParsedAsEmitted(collectPeriodAlias)];

    if (parsed.type === 'rw_format_file_system' && isPendingAliasExpired(pendingDeleteAllLocalDataAlias)) {
      pendingDeleteAllLocalDataAlias = null;
    }

    if (parsed.type !== 'rw_format_file_system' || !pendingDeleteAllLocalDataAlias) return [];
    pendingDeleteAllLocalDataAlias = null;
    return [
      markParsedAsEmitted({
        ...parsed,
        type: 'delete_all_local_data',
        protocol: 'rw',
        success: parsed.status !== 'failed'
      })
    ];
  };

  const setupDataListener = () => {
    if (dataListenerCallback) return;
    dataListenerCallback = (res) => {
      const device = getRuntimeDevice();
      const notifyServiceId = (device as RingDeviceInfo).dataServiceId || device.serviceId;
      if (device.deviceId && res.deviceId !== device.deviceId) return;

      const rawBytes = coerceBytes(res.value);
      const rawHex = bytesToHex(rawBytes);
      const frameLog = summarizeRwBleFrameForLog(rawBytes);
      const receivedAt = Date.now();
      const stableIdentity = getRwStableMetadataIdentity(device as RingDeviceInfo);
      const standardParsedResult = [
        {
          event: 'standard-battery-rx',
          parsed: parseStandardBatteryLevelNotification(res, rawBytes, device as RingDeviceInfo, stableIdentity, receivedAt)
        },
        {
          event: 'standard-device-info-rx',
          parsed: parseStandardDeviceInformationNotification(res, rawBytes, device as RingDeviceInfo, stableIdentity, receivedAt)
        },
        {
          event: 'standard-heart-rate-rx',
          parsed: parseStandardHeartRateMeasurementNotification(res, rawBytes, device as RingDeviceInfo, stableIdentity, receivedAt)
        },
        {
          event: 'standard-pulse-oximeter-rx',
          parsed: parseStandardPulseOximeterNotification(res, rawBytes, device as RingDeviceInfo, stableIdentity, receivedAt)
        }
      ].find((item) => item.parsed);
      if (standardParsedResult?.parsed) {
        const parsedWithDevice = markParsedAsEmitted(standardParsedResult.parsed);
        const parsedVariants = [parsedWithDevice, ...takeL19CompatAliases(parsedWithDevice)];
        parsedVariants.forEach((item) => runtime?.onParsedData?.(item));
        rwBleLog(standardParsedResult.event, {
          ...frameLog,
          deviceId: res.deviceId,
          serviceId: res.serviceId,
          characteristicId: res.characteristicId,
          parsed: parsedVariants.map(summarizeParsedForRwBleLog)
        });
        resolveParsedWaiters(parsedVariants);
        return;
      }
      const parsed = parseRwRingData(rawBytes);
      const isExpectedNotifyChannel = (!notifyServiceId || sameUuid(res.serviceId, notifyServiceId)) && (!device.dataCharId || sameUuid(res.characteristicId, device.dataCharId));
      if (!isExpectedNotifyChannel && !parsed) {
        rwBleLog('rx-ignored-channel', {
          ...frameLog,
          deviceId: res.deviceId,
          serviceId: res.serviceId,
          characteristicId: res.characteristicId,
          expectedServiceId: notifyServiceId,
          expectedCharacteristicId: device.dataCharId
        });
        return;
      }
      if (!parsed) {
        rwBleLog('rx-unparsed', {
          ...frameLog,
          deviceId: res.deviceId,
          serviceId: res.serviceId,
          characteristicId: res.characteristicId
        });
        const rawParsed = markParsedAsEmitted({
          type: 'rw_raw_unparsed',
          protocol: 'rw',
          deviceId: res.deviceId,
          uniMacId: stableIdentity,
          mac: stableIdentity,
          advertis: (device as RingDeviceInfo).advertis,
          deviceName: (device as RingDeviceInfo).name,
          raw: Array.from(rawBytes),
          serviceId: res.serviceId,
          characteristicId: res.characteristicId,
          receivedAt,
          parsedAt: receivedAt
        });
        runtime?.onParsedData?.(rawParsed);
        resolveParsedWaiters(rawParsed);
        return;
      }
      if (!isExpectedNotifyChannel) {
        rwBleLog('rx-alt-channel', {
          ...frameLog,
          deviceId: res.deviceId,
          serviceId: res.serviceId,
          characteristicId: res.characteristicId,
          expectedServiceId: notifyServiceId,
          expectedCharacteristicId: device.dataCharId,
          parsed: summarizeParsedForRwBleLog(parsed)
        });
      }
      const parsedWithControlContext = takePendingHealthControlForAck(parsed, pendingHealthControls);
      const parsedWithDevice = markParsedAsEmitted(
        enrichRwFileListWithReadIntent({
          ...parsedWithControlContext,
          protocol: 'rw',
          deviceId: res.deviceId,
          uniMacId: stableIdentity,
          mac: stableIdentity,
          advertis: (device as RingDeviceInfo).advertis,
          deviceName: (device as RingDeviceInfo).name,
          serviceId: res.serviceId,
          characteristicId: res.characteristicId,
          receivedAt,
          parsedAt: receivedAt
        })
      );
      const parsedVariants = [parsedWithDevice, ...takeL19CompatAliases(parsedWithDevice)];
      acknowledgeRwDeviceAppDataControlRequest(rawBytes, {
        rawHex,
        deviceId: res.deviceId,
        serviceId: res.serviceId,
        characteristicId: res.characteristicId
      });
      parsedVariants.forEach((item) => runtime?.onParsedData?.(item));
      rwBleLog('rx-parsed', {
        ...frameLog,
        deviceId: res.deviceId,
        serviceId: res.serviceId,
        characteristicId: res.characteristicId,
        parsed: parsedVariants.map(summarizeParsedForRwBleLog)
      });

      resolveParsedWaiters(parsedVariants);
    };
    uni.onBLECharacteristicValueChange(dataListenerCallback);
  };

  const clearDataListener = () => {
    rwBleLog('listener-clear', {
      waiters: parsedWaiters.length,
      recentParsed: recentParsedData.length
    });
    clearPendingAliases();
    recentParsedData.splice(0);
    parsedWaiters.splice(0).forEach((waiter) => {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('RW adapter listener cleared.'));
    });
    if (dataListenerCallback) {
      offBleCharacteristicValueChange(dataListenerCallback);
      dataListenerCallback = null;
    }
  };

  const disconnect = (deviceId = getRuntimeDevice().deviceId) => {
    rwBleLog('disconnect-request', { deviceId });
    connectionGeneration += 1;
    activeL19HistorySession = null;
    invalidateWriteQueue();
    clearDataListener();
    currentDevice = {};
    if (!deviceId) return Promise.resolve();
    return settleBleCallWithin(
      new Promise<void>((resolve) => {
        uni.closeBLEConnection({
          deviceId,
          success: () => resolve(),
          fail: () => resolve()
        });
      }),
      RW_QUIET_BLE_CALL_TIMEOUT_MS,
      undefined,
      'closeBLEConnection-disconnect'
    );
  };

  const registerConnectionStateListener = (options?: LegacyConnectionStateOptions) => {
    adapterDisposed = false;
    if (connectionStateCallback) {
      offBleConnectionStateChange(connectionStateCallback);
      connectionStateCallback = null;
    }
    const finishDisconnectedState = (res: Parameters<BleConnectionStateCallback>[0], capturedGeneration: number) => {
      if (capturedGeneration !== connectionGeneration) {
        rwBleLog('connection-state-ignored', {
          deviceId: res.deviceId,
          connected: res.connected,
          capturedGeneration,
          connectionGeneration,
          reason: 'stale-connection-generation'
        });
        return;
      }
      connectionGeneration += 1;
      activeL19HistorySession = null;
      invalidateWriteQueue();
      clearDataListener();
      currentDevice = {};
      options?.onDisconnected?.(res.deviceId);
      runtime?.onDisconnected?.(res);
    };

    connectionStateCallback = (res) => {
      if (adapterDisposed) return;
      rwBleLog('connection-state', {
        deviceId: res.deviceId,
        connected: res.connected
      });
      if (res.connected) {
        options?.onConnected?.(res.deviceId);
        return;
      }
      if (connectHandshakeInFlight) {
        rwBleLog('connection-state-ignored', {
          deviceId: res.deviceId,
          connected: res.connected,
          reason: 'handshake-in-flight'
        });
        return;
      }

      const runtimeDevice = getRuntimeDevice();
      const activeDeviceId = runtimeDevice.deviceId;
      const trackedPlatformDeviceId = currentDevice.deviceId;
      if (trackedPlatformDeviceId && res.deviceId !== trackedPlatformDeviceId) {
        rwBleLog('connection-state-ignored', {
          deviceId: res.deviceId,
          connected: res.connected,
          trackedPlatformDeviceId,
          activeDeviceId,
          reason: 'different-platform-device'
        });
        return;
      }
      if (!trackedPlatformDeviceId && (!activeDeviceId || !runtimeDevice.serviceId || !runtimeDevice.cmdCharId || !runtimeDevice.dataCharId)) {
        rwBleLog('connection-state-ignored', {
          deviceId: res.deviceId,
          connected: res.connected,
          activeDeviceId,
          reason: 'no-tracked-connection'
        });
        return;
      }
      if (!trackedPlatformDeviceId && activeDeviceId && res.deviceId !== activeDeviceId) return;

      const capturedGeneration = connectionGeneration;
      const historySession = activeL19HistorySession;
      if (historySession && historySession.deviceId === res.deviceId && historySession.generation === capturedGeneration) {
        const serviceId = currentDevice.serviceId || runtimeDevice.serviceId || '';
        void isDeviceConnected(historySession.deviceId, serviceId).then((stillConnected) => {
          if (capturedGeneration !== connectionGeneration) {
            rwBleLog('connection-state-ignored', {
              deviceId: res.deviceId,
              connected: res.connected,
              capturedGeneration,
              connectionGeneration,
              reason: 'stale-history-disconnect-after-generation-change'
            });
            return;
          }
          if (stillConnected) {
            rwBleLog('connection-state-ignored', {
              deviceId: res.deviceId,
              connected: res.connected,
              capturedGeneration,
              connectionGeneration,
              reason: 'l19-history-physical-link-still-connected'
            });
            return;
          }
          finishDisconnectedState(res, capturedGeneration);
        });
        return;
      }

      finishDisconnectedState(res, capturedGeneration);
    };
    uni.onBLEConnectionStateChange(connectionStateCallback);

    if (adapterStateCallback) {
      offBluetoothAdapterStateChange(adapterStateCallback);
      adapterStateCallback = null;
    }
    adapterStateCallback = (result) => {
      if (adapterDisposed) return;
      rwBleLog('adapter-state', {
        available: result.available,
        discovering: result.discovering
      });
      runtime?.onBluetoothReadyChange?.(Boolean(result.available));
      if (result.available) return;

      void stopScan();
      invalidateWriteQueue();
      clearDataListener();
      runtime?.onDisconnected?.({
        reason: 'bluetooth_adapter_unavailable',
        available: false,
        discovering: result.discovering
      });
    };
    uni.onBluetoothAdapterStateChange?.(adapterStateCallback);
  };

  return {
    protocol: 'rw',
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
    cleanup: async () => {
      // App 端可能没有 off*BLE*：注销不掉的旧回调必须靠这个标记失效。
      adapterDisposed = true;
      await stopScan();
      clearDataListener();
      if (connectionStateCallback) {
        offBleConnectionStateChange(connectionStateCallback);
        connectionStateCallback = null;
      }
      if (adapterStateCallback) {
        offBluetoothAdapterStateChange(adapterStateCallback);
        adapterStateCallback = null;
      }
    },
    sendBytes,
    isL19HistoryDevice,
    beginL19HistorySession,
    endL19HistorySession,
    sendL19HistoryBytes,
    sendCommand,
    sendNamedCommand,
    waitForParsedData,
    setupDataListener,
    clearDataListener,
    sendBatteryCommand: sendRwBatteryCommand,
    sendActiveMeasureCommand: sendRwActiveMeasureCommand,
    sendOxyGenCommand: sendRwOxygenCommand,
    sendBodyTemperatureCommand: sendRwBodyTemperatureCommand,
    sendFirmwareVersion: () => sendRwFirmwareVersionCommand('hardwareVersion'),
    sendSoftwareVersion: () => sendRwFirmwareVersionCommand('softwareVersion'),
    sendReadLocalDataCommand,
    readLocalData,
    readDeviceTime,
    updateDeviceTime,
    sendCollectPeriodSettingCommand: sendRwCollectPeriodSettingCommand,
    readCollectPeriodCommand: readRwCollectPeriodCommand,
    sendResetCommand: sendRwFactoryResetCommand,
    sendFactoryResetWithTimeCommand,
    sendDeleteAllLocalDataCommand,
    readRwHealthData,
    deleteRwHealthData,
    controlRwHealthData,
    readRwMonitoringConfig,
    setRwMonitoringConfig,
    setRwUserProfile,
    formatRwFileSystem: sendRwFormatFileSystemCommand,
    getTimedHeartRateJL: () => readRwMonitoringConfig('heart_rate'),
    getTimedBloodOxygenJL: () => readRwMonitoringConfig('blood_oxygen'),
    getTimedHRVJL: () => readRwMonitoringConfig('hrv'),
    getTimedStressJL: () => readRwMonitoringConfig('stress'),
    getTimedBloodSugarJL: () => readRwMonitoringConfig('blood_sugar'),
    getTimedBloodPressureJL: () => readRwMonitoringConfig('blood_pressure'),
    getTimedTemperatureJL: () => readRwMonitoringConfig('temperature'),
    setTimedHeartRateJL: (config: RwHealthMonitoringConfig) => setRwMonitoringConfig('heart_rate', config),
    setTimedBloodOxygenJL: (config: RwHealthMonitoringConfig) => setRwMonitoringConfig('blood_oxygen', config),
    setTimedHRVJL: (config: RwHealthMonitoringConfig) => setRwMonitoringConfig('hrv', config),
    setTimedStressJL: (config: RwHealthMonitoringConfig) => setRwMonitoringConfig('stress', config),
    setTimedBloodSugarJL: (config: RwHealthMonitoringConfig) => setRwMonitoringConfig('blood_sugar', config),
    setTimedBloodPressureJL: (config: RwHealthMonitoringConfig) => setRwMonitoringConfig('blood_pressure', config),
    setTimedTemperatureJL: (config: RwHealthMonitoringConfig) => setRwMonitoringConfig('temperature', config),
    controlHealthDataJL: controlRwHealthData,
    syncAllHealthData,
    syncHealthDataByType
  };
};

const isMetricAliasMatch = (alias: L19MetricAliasType, parsed: RingParsedData) => {
  if (alias === 'active_measure') return Boolean(getActiveMeasureAliasName(parsed));
  const expectedKey = RW_L19_METRIC_ALIAS_REALTIME_KEY_MAP[alias];
  const expectedControlKey = RW_L19_METRIC_ALIAS_CONTROL_KEY_MAP[alias];
  if ((!expectedKey || !isRwRealtimeMetricKey(parsed, expectedKey)) && (!expectedControlKey || !isRwMetricControlFailure(parsed, expectedControlKey))) {
    return false;
  }
  if (alias === 'active_OxyGenMeasure') return parsed.name === 'blood_oxygen' || parsed.name === 'spo2';
  return parsed.name === 'temperature';
};

const isVersionAliasParsed = (parsed: RingParsedData, alias?: L19VersionAliasType) => {
  if (!alias) {
    return parsed.type === 'firmware_version' || parsed.type === 'hardwareVersion' || parsed.type === 'softwareVersion';
  }
  if (alias === 'hardwareVersion') return parsed.type === 'hardwareVersion' || parsed.type === 'firmware_version';
  return parsed.type === 'softwareVersion' || parsed.type === 'firmware_version';
};

const isRwMetricAliasSource = (parsed: RingParsedData) => {
  if (parsed.type === 'rw_health_data') return true;
  if (parsed.type === 'rw_health_data_control_ack') return parsed.status === 'failed' || parsed.success === false;
  if (parsed.type !== 'rw_health_data_ack') return false;
  if (parsed.status === 'nack' || parsed.success === false) return true;
  return Array.isArray(parsed.data) && parsed.data.includes(0x31);
};

const takePendingHealthControlForAck = (parsed: RingParsedData, pendingControls: RwPendingHealthControl[]): RingParsedData => {
  if (parsed.type !== 'rw_health_data_control_ack') return parsed;

  const now = Date.now();
  for (let index = pendingControls.length - 1; index >= 0; index -= 1) {
    if (pendingControls[index].expiresAt <= now) pendingControls.splice(index, 1);
  }
  if (pendingControls.length === 0) return parsed;

  const parsedName = String(normalizeRwHealthDataName(String(parsed.name || '')));
  const parsedControlKey = Number(parsed.controlKey);
  const parsedControlAction = Number(parsed.controlAction);
  let pendingIndex = pendingControls.findIndex(
    (item) =>
      ((parsedName !== 'unknown' && item.name === parsedName) || (Number.isFinite(parsedControlKey) && parsedControlKey > 0 && item.controlKey === parsedControlKey)) &&
      (!Number.isFinite(parsedControlAction) || item.enabled === (parsedControlAction !== 0))
  );
  if (pendingIndex < 0 && (parsedName === 'unknown' || !parsed.name)) pendingIndex = 0;
  if (pendingIndex < 0) return parsed;

  const pending = pendingControls.splice(pendingIndex, 1)[0];
  return {
    ...parsed,
    name: parsedName === 'unknown' ? pending.name : parsedName,
    controlKey: Number.isFinite(parsedControlKey) && parsedControlKey > 0 ? parsedControlKey : pending.controlKey,
    controlAction: parsed.controlAction ?? (pending.enabled ? 1 : 0),
    enabled: pending.enabled
  };
};

const createActiveMeasureAliasState = (): RwActiveMeasureAliasState => ({
  expiresAt: Date.now() + RW_REALTIME_ALIAS_TTL_MS,
  received: {},
  heartRate: null,
  heartRateVariability: null,
  stressIndex: null
});

const pruneExpiredAliases = <T extends { expiresAt: number }>(aliases: T[], now = Date.now()) => {
  for (let index = aliases.length - 1; index >= 0; index -= 1) {
    if (aliases[index].expiresAt <= now) aliases.splice(index, 1);
  }
};

const isPendingAliasExpired = (alias: RwPendingAlias | null, now = Date.now()) => {
  return Boolean(alias && alias.expiresAt <= now);
};

const getActiveMeasureAliasName = (parsed: RingParsedData): RwActiveMeasureAliasName | '' => {
  if (parsed.name === 'heart_rate' && isRwRealtimeMetricKey(parsed, RW_ACTIVE_MEASURE_REALTIME_KEY_MAP.heart_rate)) {
    return 'heart_rate';
  }
  if (parsed.name === 'heart_rate' && isRwMetricControlFailure(parsed, RW_ACTIVE_MEASURE_CONTROL_KEY_MAP.heart_rate)) {
    return 'heart_rate';
  }
  if (parsed.name === 'hrv' && isRwRealtimeMetricKey(parsed, RW_ACTIVE_MEASURE_REALTIME_KEY_MAP.hrv)) return 'hrv';
  if (parsed.name === 'hrv' && isRwMetricControlFailure(parsed, RW_ACTIVE_MEASURE_CONTROL_KEY_MAP.hrv)) return 'hrv';
  if (parsed.name === 'stress' && isRwRealtimeMetricKey(parsed, RW_ACTIVE_MEASURE_REALTIME_KEY_MAP.stress)) return 'stress';
  if (parsed.name === 'stress' && isRwMetricControlFailure(parsed, RW_ACTIVE_MEASURE_CONTROL_KEY_MAP.stress)) return 'stress';
  return '';
};

const isRwRealtimeMetricKey = (parsed: RingParsedData, expectedKey: RwKey | RwKey[]) => {
  const key = typeof parsed.key === 'number' ? parsed.key : Number(parsed.key);
  const expectedKeys = Array.isArray(expectedKey) ? expectedKey : [expectedKey];
  return Number.isFinite(key) && expectedKeys.includes(key);
};

const isRwMetricControlFailure = (parsed: RingParsedData, expectedControlKey: RwHealthDataControlKey) => {
  if (parsed.type !== 'rw_health_data_control_ack' || !isRwMetricFailureStatus(parsed)) return false;
  const controlKey = typeof parsed.controlKey === 'number' ? parsed.controlKey : Number(parsed.controlKey);
  return Number.isFinite(controlKey) && controlKey === expectedControlKey;
};

const getRwMetricAliasValue = (parsed: RingParsedData) => {
  if (parsed.type === 'rw_health_data_control_ack') return null;
  if (typeof parsed.value === 'number') return parsed.value > 0 && parsed.value !== 0x31 ? parsed.value : null;
  if (parsed.value != null && parsed.value !== 0x31) return parsed.value;
  if (!Array.isArray(parsed.data)) return null;
  const value = parsed.data.find((item) => typeof item === 'number' && item > 0 && item !== 0x31);
  return typeof value === 'number' ? value : null;
};

const isRwMetricFailureStatus = (parsed: RingParsedData) => {
  const status = typeof parsed.status === 'string' ? parsed.status.toLowerCase() : '';
  return parsed.success === false || status === 'failed' || status === 'nack' || parsed.statusCode === 0x31;
};

const formatLegacyTemperatureValue = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value.toFixed(2);
};

const getLegacyMeasureStatusCode = (parsed: RingParsedData, hasValue = false) => {
  if (typeof parsed.statusCode === 'number') {
    if (parsed.protocol === 'rw' && parsed.statusCode === 0x31) return 0x02;
    if (parsed.protocol === 'rw' && parsed.statusCode === 0x11) return hasValue ? 0x01 : 0x00;
    return parsed.statusCode;
  }
  if (typeof parsed.status === 'number') return parsed.status;

  const status = typeof parsed.status === 'string' ? parsed.status.toLowerCase() : '';
  if (status === 'failed' || status === 'nack') return 0x02;
  if (status === 'busy') return 0x03;
  if (hasValue || status === 'normal' || status === 'success' || status === 'ack') return 0x01;
  return undefined;
};

const RW_MONITORING_KEYS = [
  RwKey.HrMonitoring,
  RwKey.Spo2Monitoring,
  RwKey.HrvMonitoring,
  RwKey.StressMonitoring,
  RwKey.BloodSugarMonitoring,
  RwKey.BloodPressureMonitoring,
  RwKey.TemperatureMonitoring
];
const RW_MONITORING_WRITE_KEYS = [
  RwKey.HrMonitoring,
  RwKey.Spo2Monitoring,
  RwKey.HrvMonitoring,
  RwKey.StressMonitoring,
  RwKey.BloodSugarMonitoring,
  RwKey.BloodPressureMonitoring,
  RwKey.TemperatureDetecting
];
const RW_APP_READY_MONITORING_KEYS = [RwKey.HrMonitoring, RwKey.Spo2Monitoring, RwKey.HrvMonitoring, RwKey.StressMonitoring];

const secondsToRwIntervalMinutes = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return 30;
  return Math.max(1, Math.min(255, Math.round(seconds / 60)));
};

const numberToUint32LE = (value: number) => {
  const normalized = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)) >>> 0;
  return new Uint8Array([normalized & 0xff, (normalized >> 8) & 0xff, (normalized >> 16) & 0xff, (normalized >> 24) & 0xff]);
};

const parseCollectPeriodPayload = (payload?: LegacyCommandPayload) => {
  if (typeof payload === 'number') return payload;
  const bytes = payload instanceof Uint8Array ? payload : Array.isArray(payload) ? new Uint8Array(payload) : null;
  if (!bytes || bytes.length === 0) return 1200;
  return (bytes[0] || 0) | ((bytes[1] || 0) << 8) | ((bytes[2] || 0) << 16) | ((bytes[3] || 0) << 24);
};

const parseReadLocalDataPayload = (payload?: LegacyCommandPayload): [number, boolean] => {
  if (payload === undefined) return [0, true];
  if (typeof payload === 'number') return [normalizeRwReadTimestamp(payload), false];

  const bytes = payload instanceof Uint8Array ? payload : Array.isArray(payload) ? new Uint8Array(payload) : new Uint8Array();
  if (bytes.length < 4) return [0, true];
  return [normalizeRwReadTimestamp(readUint32LE(bytes, 0)), false];
};

const parseUpdateTimePayload = (payload?: LegacyCommandPayload) => {
  if (payload === undefined) return { timestampMs: Date.now(), timezone: 8 };
  if (typeof payload === 'number') return { timestampMs: payload, timezone: 8 };

  const bytes = payload instanceof Uint8Array ? payload : Array.isArray(payload) ? new Uint8Array(payload) : new Uint8Array();
  if (bytes.length < 8) return { timestampMs: Date.now(), timezone: bytes[0] ?? 8 };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    timestampMs: Number(view.getBigUint64(0, true)),
    timezone: bytes[8] ?? 8
  };
};

const resolveRwLocalDataReadIntent = (options: LegacyReadLocalDataOptions = {}): RwLocalDataReadIntent => {
  const readAll = options.readAll ?? false;
  const sinceTimestamp = normalizeRwReadTimestamp(options.sinceTimestamp === undefined ? (readAll ? 0 : getTodayZeroTimestamp()) : options.sinceTimestamp);
  return {
    readAll,
    sinceTimestamp,
    dataType: options.dataType,
    dataTypes: normalizeRwHistoryDataTypes(options.dataTypes),
    expiresAt: Date.now() + ACTIVE_MEASURE_ALIAS_TTL_MS
  };
};

const filterRwFilesByReadIntent = (files: any[], intent: RwLocalDataReadIntent) => {
  return files.filter((file) => {
    if (intent.dataTypes?.length && !intent.dataTypes.some((dataType) => isRwHistoryFileDataType(file, dataType))) return false;
    if (intent.dataType && !isRwHistoryFileDataType(file, intent.dataType)) return false;
    if (intent.readAll || !intent.sinceTimestamp) return true;
    const fileTimestamp = parseRwFileTimestampText(file?.timestampText);
    return !fileTimestamp || fileTimestamp >= intent.sinceTimestamp;
  });
};

const isRwHistoryFileDataType = (file: Record<string, any>, dataType: string) => {
  const normalizedTarget = normalizeRwHistoryDataType(dataType);
  if (!normalizedTarget) return true;
  const normalizedFileType = normalizeRwHistoryDataType(getRwHistoryDataType(file?.fileType, file?.fileName));
  return normalizedFileType === normalizedTarget;
};

const normalizeRwHistoryDataType = (value?: string) => {
  const normalized = `${value || ''}`.trim().replace(/-/g, '_').toLowerCase();
  const compact = normalized.replace(/[_\s]/g, '');
  if (!compact) return '';
  if (compact === 'sleep' || compact === 'sleepdata' || compact === 'sleepdetail' || compact === 'sleepdetails') return 'sleep';
  if (compact === 'step' || compact === 'steps' || compact === 'stepcount' || compact === 'sport' || compact === 'activity' || compact === 'dailyactivity') {
    return 'step';
  }
  return normalizeRwHealthDataName(normalized);
};

const normalizeRwHistoryDataTypes = (values?: string[]) => {
  if (!Array.isArray(values)) return undefined;
  const normalized = Array.from(new Set(values.map((value) => normalizeRwHistoryDataType(value)).filter(Boolean)));
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeRwReadTimestamp = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
};

const parseRwFileTimestampText = (value?: string) => {
  if (!value || !/^\d{14}$/.test(value)) return 0;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  return Math.floor(new Date(year, month, day, hour, minute, second).getTime() / 1000);
};

const normalizeRwHealthDataName = (name: string): RwHealthDataName => {
  const normalized = `${name || ''}`.trim().replace(/-/g, '_').toLowerCase();
  const compact = normalized.replace(/[_\s]/g, '');
  if (!compact) return '' as RwHealthDataName;
  if (compact === 'heartrate' || compact === 'heart' || compact === 'hr' || compact === 'heartrateraw') return 'heart_rate';
  if (compact === 'bloodoxygen' || compact === 'bloodoxygenraw' || compact === 'oxygen' || compact === 'spo2') return 'blood_oxygen';
  if (
    compact === 'temperature' ||
    compact === 'bodytemperature' ||
    compact === 'bodytemp' ||
    compact === 'skintemperature' ||
    compact === 'skintemp' ||
    compact === 'skin' ||
    compact === 'temp'
  ) {
    return 'temperature';
  }
  if (compact === 'bloodsugar' || compact === 'bs' || compact === 'glucose') return 'blood_sugar';
  if (compact === 'bloodpressure' || compact === 'bp') return 'blood_pressure';
  if (compact === 'hrv') return 'hrv';
  if (compact === 'stress') return 'stress';
  return normalized as RwHealthDataName;
};

const resolveRwReadableHealthDataKey = (name: RwHealthDataName) => {
  const normalizedName = normalizeRwHealthDataName(name);
  const key = RW_READABLE_HEALTH_DATA_KEY_MAP[normalizedName];
  if (!key) throw new Error(`Unsupported RW readable health data: ${name}`);
  return key;
};

const resolveRwHealthDataControlKey = (name: RwHealthDataName) => {
  const normalizedName = normalizeRwHealthDataName(name);
  const key = RW_HEALTH_DATA_CONTROL_KEY_MAP[normalizedName];
  if (!key) throw new Error(`Unsupported RW health data control: ${name}`);
  return key;
};

const resolveRwMonitoringKey = (name: RwMonitoringName) => {
  const normalizedName = normalizeRwHealthDataName(name);
  const key = RW_MONITORING_KEY_MAP[normalizedName];
  if (!key) throw new Error(`Unsupported RW monitoring config: ${name}`);
  return key;
};

const resolveRwMonitoringWriteKey = (name: RwMonitoringName) => {
  const normalizedName = normalizeRwHealthDataName(name);
  const key = RW_MONITORING_WRITE_KEY_MAP[normalizedName] || RW_MONITORING_KEY_MAP[normalizedName];
  if (!key) throw new Error(`Unsupported RW monitoring config write: ${name}`);
  return key;
};

const buildRwRealtimeHealthDataReadCommands = (name: RwHealthDataName): RwCommandWrite[] => {
  const normalizedName = normalizeRwHealthDataName(name);
  const readableKey = RW_READABLE_HEALTH_DATA_KEY_MAP[normalizedName];
  const realtimeKey = RW_REALTIME_HEALTH_DATA_KEY_MAP[normalizedName];
  const commands: RwCommandWrite[] = [];
  if (realtimeKey && realtimeKey !== readableKey) {
    commands.push(
      { label: `${normalizedName}/app-sdk-ab-crc-realtime-read`, bytes: buildRwReadKeyCommand(realtimeKey) },
      { label: `${normalizedName}/app-sdk-ab-crc-realtime-read-continue`, bytes: buildRwReadContinueKeyCommand(realtimeKey) },
      { label: `${normalizedName}/ab-no-crc-realtime-read`, bytes: buildRwReadKeyCommandWithoutChecksum(realtimeKey) },
      { label: `${normalizedName}/ab-no-crc-realtime-read-continue`, bytes: buildRwReadContinueKeyCommandWithoutChecksum(realtimeKey) }
    );
  }
  if (readableKey) {
    commands.push(
      { label: `${normalizedName}/app-sdk-ab-crc-health-read`, bytes: buildRwReadHealthDataCommand(readableKey) },
      { label: `${normalizedName}/app-sdk-ab-crc-health-read-continue`, bytes: buildRwReadContinueKeyCommand(readableKey) },
      { label: `${normalizedName}/ab-no-crc-health-read`, bytes: buildRwReadKeyCommandWithoutChecksum(readableKey) },
      { label: `${normalizedName}/ab-no-crc-health-read-continue`, bytes: buildRwReadContinueKeyCommandWithoutChecksum(readableKey) }
    );
  }
  return commands;
};

const RW_READABLE_HEALTH_DATA_KEY_MAP: Partial<Record<RwHealthDataName, RwKey>> = {
  heart_rate: RwKey.HeartRate,
  temperature: RwKey.Temperature,
  blood_oxygen: RwKey.BloodOxygen,
  spo2: RwKey.BloodOxygen,
  blood_sugar: RwKey.BloodSugar,
  hrv: RwKey.Hrv,
  stress: RwKey.Stress,
  blood_pressure: RwKey.BloodPressure
};

const RW_HEALTH_DATA_CONTROL_KEY_MAP: Partial<Record<RwHealthDataName, RwHealthDataControlKey>> = {
  heart_rate: RwHealthDataControlKey.HeartRate,
  temperature: RwHealthDataControlKey.Temperature,
  blood_oxygen: RwHealthDataControlKey.BloodOxygen,
  spo2: RwHealthDataControlKey.BloodOxygen,
  blood_sugar: RwHealthDataControlKey.BloodSugar,
  hrv: RwHealthDataControlKey.Hrv,
  stress: RwHealthDataControlKey.Stress,
  blood_pressure: RwHealthDataControlKey.BloodPressure
};

const RW_MONITORING_KEY_MAP: Partial<Record<RwMonitoringName, RwKey>> = {
  heart_rate: RwKey.HrMonitoring,
  temperature: RwKey.TemperatureMonitoring,
  blood_oxygen: RwKey.Spo2Monitoring,
  blood_sugar: RwKey.BloodSugarMonitoring,
  spo2: RwKey.Spo2Monitoring,
  hrv: RwKey.HrvMonitoring,
  stress: RwKey.StressMonitoring,
  blood_pressure: RwKey.BloodPressureMonitoring
};

const RW_MONITORING_WRITE_KEY_MAP: Partial<Record<RwMonitoringName, RwKey>> = {
  temperature: RwKey.TemperatureDetecting
};

const RW_REALTIME_HEALTH_DATA_KEY_MAP: Partial<Record<RwHealthDataName, RwKey>> = {
  heart_rate: RwKey.AppRealTimeHeartRate,
  temperature: RwKey.AppRealTimeTemperature,
  blood_oxygen: RwKey.AppRealTimeBloodOxygen,
  spo2: RwKey.AppRealTimeBloodOxygen,
  hrv: RwKey.AppRealTimeHrv,
  stress: RwKey.AppRealTimeStress,
  blood_sugar: RwKey.AppRealTimeBloodSugar,
  blood_pressure: RwKey.AppRealTimeBloodPressure
};

function normalizeScanDevice(device: UniApp.OnBluetoothDeviceFoundResult['devices'][number]): RingDeviceInfo {
  const rawDevice = device as RingDeviceInfo;
  const protocol = resolveRingProtocol(rawDevice);
  const advertis =
    protocol === 'qkeer-v2'
      ? rawDevice.advertis || parseQkeerV2AdvertisInfo(rawDevice) || undefined
      : protocol === 'rw'
        ? rawDevice.advertis || parseRwAdvertisInfo(rawDevice) || undefined
        : rawDevice.advertis;
  return {
    ...device,
    name: device.name || device.localName,
    displayName: device.name || device.localName,
    protocol,
    advertis,
    uniMacId: protocol === 'rw' ? rawDevice.mac || advertis?.macInfo || (isColonSeparatedBleMac(rawDevice.uniMacId) ? rawDevice.uniMacId : '') : rawDevice.uniMacId,
    mac: rawDevice.mac || advertis?.macInfo,
    lastSeenAt: Date.now()
  };
}

function mergeRwSourceDeviceMetadata(device: RingDeviceInfo, sourceDevice?: RingDeviceInfo): RingDeviceInfo {
  const stableIdentity = getRwStableMetadataIdentity(device) || getRwStableMetadataIdentity(sourceDevice);
  if (!sourceDevice) {
    return {
      ...device,
      uniMacId: stableIdentity || '',
      mac: stableIdentity,
      protocol: 'rw'
    };
  }

  return {
    ...sourceDevice,
    ...device,
    name: device.name || sourceDevice.name || sourceDevice.localName || sourceDevice.displayName,
    deviceName: device.deviceName || sourceDevice.deviceName || sourceDevice.name || sourceDevice.localName,
    displayName: device.displayName || sourceDevice.displayName || sourceDevice.name || sourceDevice.localName,
    localName: device.localName || sourceDevice.localName,
    uniMacId: stableIdentity || '',
    mac: stableIdentity,
    advertis: device.advertis || sourceDevice.advertis,
    protocol: 'rw'
  };
}

function getRwStableMetadataIdentity(device?: RingDeviceInfo) {
  if (!device) return '';
  if (device.mac) return device.mac;
  if (device.advertis?.macInfo) return device.advertis.macInfo;
  if (isColonSeparatedBleMac(device.uniMacId)) return device.uniMacId;
  return '';
}

function isColonSeparatedBleMac(value?: unknown) {
  return /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());
}

export const getRwScannedDeviceMergeKeys = (device: RingDeviceInfo) => {
  const name = `${device.displayName || device.name || device.localName || device.bleName || ''}`.trim().toUpperCase();
  const protocol = resolveRingProtocol(device);
  const advertisHex = getRwAdvertisHex(device.advertisData);
  const advertisTail = advertisHex.slice(-24);
  const services = [
    device.serviceId,
    ...(Array.isArray(device.advertisServiceUUIDs) ? device.advertisServiceUUIDs : []),
    ...(Array.isArray(device.advertisServiceUUIDsList) ? device.advertisServiceUUIDsList : [])
  ]
    .filter(Boolean)
    .map((value) => `${value}`.toUpperCase())
    .join('|');

  return [
    device.deviceId ? `device:${device.deviceId}` : '',
    isColonSeparatedBleMac(device.uniMacId) ? `mac:${device.uniMacId}` : '',
    device.mac ? `mac:${device.mac}` : '',
    device.advertis?.macInfo ? `mac:${device.advertis.macInfo}` : '',
    advertisTail ? `adv:${protocol}:${advertisTail}` : '',
    name && advertisTail ? `name-adv:${protocol}:${name}:${advertisTail}` : '',
    !device.deviceId && name && services ? `name-service:${protocol}:${name}:${services}` : ''
  ].filter(Boolean);
};

function getRwAdvertisHex(value?: RingDeviceInfo['advertisData']) {
  if (!value) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, '').toUpperCase();
  if (Array.isArray(value))
    return value
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  return bufferToHex(value as unknown as ArrayBuffer).toUpperCase();
}

function isRwScanDevice(device: RingDeviceInfo, prefixes: string[]) {
  const name = `${device.name || device.localName || device.displayName || ''}`.toUpperCase();
  const hasExpectedName = prefixes.some((prefix) => name.startsWith(prefix.toUpperCase()));

  return hasExpectedName && isRwProtocolDeviceName(device);
}

function isAllowedBusinessScanDevice(device: RingDeviceInfo, options: LegacyScanOptions) {
  if (!options.includeUnknown) return false;
  const name = `${device.name || device.localName || device.displayName || ''}`.toUpperCase();
  const protocol = resolveRingProtocol(device);
  if (protocol === 'rw' || protocol === 'qkeer-v2') return true;

  return ['HR', 'IF', 'QK', 'QKEERING', 'PPLUS', 'MUSLEEP_RING', 'QKV2'].some((prefix) => name.startsWith(prefix));
}

function getServices(deviceId: string): Promise<UniApp.GetBLEDeviceServicesSuccess['services']> {
  return rejectBleCallAfter(
    new Promise<UniApp.GetBLEDeviceServicesSuccess['services']>((resolve, reject) => {
      uni.getBLEDeviceServices({
        deviceId,
        success: (res) => resolve(res.services),
        fail: reject
      });
    }),
    RW_GATT_DISCOVERY_CALL_TIMEOUT_MS,
    'getBLEDeviceServices'
  );
}

function getCharacteristics(deviceId: string, serviceId: string): Promise<UniApp.GetBLEDeviceCharacteristicsSuccess['characteristics']> {
  return rejectBleCallAfter(
    new Promise<UniApp.GetBLEDeviceCharacteristicsSuccess['characteristics']>((resolve, reject) => {
      uni.getBLEDeviceCharacteristics({
        deviceId,
        serviceId,
        success: (res) => resolve(res.characteristics),
        fail: reject
      });
    }),
    RW_GATT_DISCOVERY_CALL_TIMEOUT_MS,
    'getBLEDeviceCharacteristics'
  );
}

function readBleCharacteristicValue(deviceId: string, serviceId: string, characteristicId: string) {
  return new Promise((resolve, reject) => {
    uni.readBLECharacteristicValue({
      deviceId,
      serviceId,
      characteristicId,
      success: resolve,
      fail: reject
    });
  });
}

const BLE_CHAR_PROP_READ = 0x02;
const BLE_CHAR_PROP_WRITE_NO_RESPONSE = 0x04;
const BLE_CHAR_PROP_WRITE = 0x08;
const BLE_CHAR_PROP_NOTIFY = 0x10;
const BLE_CHAR_PROP_INDICATE = 0x20;

type NormalizedCharacteristicProperties = {
  read?: boolean;
  write?: boolean;
  writeNoResponse?: boolean;
  notify?: boolean;
  indicate?: boolean;
};

// App(Android) 端 getBLEDeviceCharacteristics 返回的 properties 可能是数字位掩码，
// 而 mp-weixin 是对象 { read, write, notify, indicate }。统一归一化为对象，兼容两种格式。
function normalizeCharacteristicProperties(properties: unknown): NormalizedCharacteristicProperties {
  if (!properties) return {};
  if (typeof properties === 'object') {
    const record = properties as Record<string, unknown>;
    return {
      read: Boolean(record.read),
      write: Boolean(record.write),
      writeNoResponse: Boolean(record.writeNoResponse),
      notify: Boolean(record.notify),
      indicate: Boolean(record.indicate)
    };
  }
  const bits = Number(properties);
  if (!Number.isFinite(bits)) return {};
  return {
    read: Boolean(bits & BLE_CHAR_PROP_READ),
    writeNoResponse: Boolean(bits & BLE_CHAR_PROP_WRITE_NO_RESPONSE),
    write: Boolean(bits & BLE_CHAR_PROP_WRITE),
    notify: Boolean(bits & BLE_CHAR_PROP_NOTIFY),
    indicate: Boolean(bits & BLE_CHAR_PROP_INDICATE)
  };
}

// BLE 通知/读回的 value 在 mp-weixin 是 ArrayBuffer，App 端历史可能返回 base64 字符串，统一转成 Uint8Array。
function coerceBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (typeof value === 'string' && value.trim()) {
    const decodeBase64 = (uni as unknown as { base64ToArrayBuffer?: (data: string) => ArrayBuffer }).base64ToArrayBuffer;
    if (typeof decodeBase64 === 'function') {
      try {
        const buffer = decodeBase64(value);
        if (buffer) return new Uint8Array(buffer);
      } catch {
        // ignore, fall through to atob
      }
    }
    if (typeof atob === 'function') {
      try {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
      } catch {
        // ignore, return empty below
      }
    }
  }
  return new Uint8Array();
}

function findStandardBatteryLevelCharacteristic(groups: Array<{ serviceId: string; chars: UniApp.GetBLEDeviceCharacteristicsSuccess['characteristics'] }>) {
  for (const group of groups) {
    if (!sameUuid(group.serviceId, BLE_BATTERY_SERVICE_UUID)) continue;
    const characteristic =
      group.chars.find((char) => sameUuid(char.uuid, BLE_BATTERY_LEVEL_CHAR_UUID) && normalizeCharacteristicProperties(char.properties).read) ||
      group.chars.find((char) => normalizeCharacteristicProperties(char.properties).read);
    if (characteristic) {
      return {
        serviceId: group.serviceId,
        characteristicId: characteristic.uuid
      };
    }
  }
  return null;
}

function findStandardHeartRateMeasurementCharacteristic(groups: Array<{ serviceId: string; chars: UniApp.GetBLEDeviceCharacteristicsSuccess['characteristics'] }>) {
  for (const group of groups) {
    if (!sameUuid(group.serviceId, BLE_HEART_RATE_SERVICE_UUID)) continue;
    const characteristic =
      group.chars.find(
        (char) =>
          sameUuid(char.uuid, BLE_HEART_RATE_MEASUREMENT_CHAR_UUID) &&
          (normalizeCharacteristicProperties(char.properties).notify ||
            normalizeCharacteristicProperties(char.properties).indicate ||
            normalizeCharacteristicProperties(char.properties).read)
      ) ||
      group.chars.find(
        (char) =>
          normalizeCharacteristicProperties(char.properties).notify ||
          normalizeCharacteristicProperties(char.properties).indicate ||
          normalizeCharacteristicProperties(char.properties).read
      );
    if (characteristic) {
      return {
        serviceId: group.serviceId,
        characteristicId: characteristic.uuid,
        canRead: Boolean(normalizeCharacteristicProperties(characteristic.properties).read)
      };
    }
  }
  return null;
}

function findStandardPulseOximeterCharacteristic(groups: Array<{ serviceId: string; chars: UniApp.GetBLEDeviceCharacteristicsSuccess['characteristics'] }>) {
  for (const group of groups) {
    if (!sameUuid(group.serviceId, BLE_PULSE_OXIMETER_SERVICE_UUID)) continue;
    const characteristic =
      group.chars.find(
        (char) =>
          sameUuid(char.uuid, BLE_PLX_CONTINUOUS_CHAR_UUID) &&
          (normalizeCharacteristicProperties(char.properties).notify ||
            normalizeCharacteristicProperties(char.properties).indicate ||
            normalizeCharacteristicProperties(char.properties).read)
      ) ||
      group.chars.find(
        (char) =>
          sameUuid(char.uuid, BLE_PLX_SPOT_CHECK_CHAR_UUID) &&
          (normalizeCharacteristicProperties(char.properties).notify ||
            normalizeCharacteristicProperties(char.properties).indicate ||
            normalizeCharacteristicProperties(char.properties).read)
      ) ||
      group.chars.find(
        (char) =>
          normalizeCharacteristicProperties(char.properties).notify ||
          normalizeCharacteristicProperties(char.properties).indicate ||
          normalizeCharacteristicProperties(char.properties).read
      );
    if (characteristic) {
      return {
        serviceId: group.serviceId,
        characteristicId: characteristic.uuid,
        canRead: Boolean(normalizeCharacteristicProperties(characteristic.properties).read)
      };
    }
  }
  return null;
}

function findStandardDeviceInformationCharacteristics(groups: Array<{ serviceId: string; chars: UniApp.GetBLEDeviceCharacteristicsSuccess['characteristics'] }>) {
  const result: {
    firmware?: { serviceId: string; characteristicId: string };
    hardware?: { serviceId: string; characteristicId: string };
    software?: { serviceId: string; characteristicId: string };
  } = {};
  for (const group of groups) {
    if (!sameUuid(group.serviceId, BLE_DEVICE_INFORMATION_SERVICE_UUID)) continue;
    const readableChars = group.chars.filter((char) => normalizeCharacteristicProperties(char.properties).read);
    const firmware = readableChars.find((char) => sameUuid(char.uuid, BLE_FIRMWARE_REVISION_CHAR_UUID));
    const hardware = readableChars.find((char) => sameUuid(char.uuid, BLE_HARDWARE_REVISION_CHAR_UUID));
    const software = readableChars.find((char) => sameUuid(char.uuid, BLE_SOFTWARE_REVISION_CHAR_UUID));
    if (firmware) result.firmware = { serviceId: group.serviceId, characteristicId: firmware.uuid };
    if (hardware) result.hardware = { serviceId: group.serviceId, characteristicId: hardware.uuid };
    if (software) result.software = { serviceId: group.serviceId, characteristicId: software.uuid };
  }
  return result;
}

function findNotifyCharacteristics(groups: Array<{ serviceId: string; chars: UniApp.GetBLEDeviceCharacteristicsSuccess['characteristics'] }>, preferredServiceId: string) {
  const candidates = groups.flatMap((group) =>
    group.chars
      .filter((char) => {
        const properties = normalizeCharacteristicProperties(char.properties);
        return properties.notify || properties.indicate;
      })
      .map((char) => ({
        serviceId: group.serviceId,
        characteristicId: char.uuid
      }))
  );

  return uniqueNotifyCandidates([
    ...candidates.filter((candidate) => sameUuid(candidate.serviceId, preferredServiceId) && sameUuid(candidate.characteristicId, RW_NOTIFY_CHAR_UUID)),
    ...candidates.filter((candidate) => sameUuid(candidate.characteristicId, RW_NOTIFY_CHAR_UUID)),
    ...candidates.filter((candidate) => sameUuid(candidate.serviceId, preferredServiceId)),
    ...candidates
  ]);
}

function findWritableCharacteristics(groups: Array<{ serviceId: string; chars: UniApp.GetBLEDeviceCharacteristicsSuccess['characteristics'] }>) {
  const candidates = groups.flatMap((group) =>
    group.chars.filter(isWritableCharacteristic).map((characteristic) => ({
      serviceId: group.serviceId,
      characteristic
    }))
  );

  return uniqueWriteCandidates([...candidates.filter((candidate) => sameUuid(candidate.characteristic.uuid, RW_WRITE_CHAR_UUID)), ...candidates]);
}

function formatCharacteristic(characteristic: UniApp.GetBLEDeviceCharacteristicsSuccess['characteristics'][number]) {
  const props = Object.entries(normalizeCharacteristicProperties(characteristic.properties))
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join('/');
  return `${characteristic.uuid}(${props || 'none'})`;
}

function isWritableCharacteristic(characteristic: UniApp.GetBLEDeviceCharacteristicsSuccess['characteristics'][number]) {
  const properties = normalizeCharacteristicProperties(characteristic.properties);
  return Boolean(properties.write || properties.writeNoResponse);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueNotifyCandidates(candidates: Array<{ serviceId: string; characteristicId: string }>) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.serviceId.toLowerCase()}|${candidate.characteristicId.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueWriteCandidates<T extends { serviceId: string; characteristic: { uuid: string } }>(candidates: T[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.serviceId.toLowerCase()}|${candidate.characteristic.uuid.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return `${error}`;
  }
}

function sameUuid(left: string, right: string) {
  const normalizedLeft = normalizeBluetoothUuid(left);
  const normalizedRight = normalizeBluetoothUuid(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function normalizeBluetoothUuid(value: string) {
  const normalized = `${value || ''}`.replace(/-/g, '').toLowerCase();
  if (/^[0-9a-f]{4}$/.test(normalized)) return `0000${normalized}00001000800000805f9b34fb`;
  return normalized;
}

function parseStandardBatteryLevelNotification(
  res: { deviceId: string; serviceId: string; characteristicId: string },
  rawBytes: Uint8Array,
  device: RingDeviceInfo,
  stableIdentity: string,
  receivedAt: number
): RingParsedData | null {
  const isStandardBatteryChannel = sameUuid(res.serviceId, BLE_BATTERY_SERVICE_UUID) && sameUuid(res.characteristicId, BLE_BATTERY_LEVEL_CHAR_UUID);
  const isDiscoveredBatteryChannel =
    Boolean(device.standardBatteryServiceId && device.standardBatteryCharId) &&
    sameUuid(res.serviceId, device.standardBatteryServiceId || '') &&
    sameUuid(res.characteristicId, device.standardBatteryCharId || '');
  if ((!isStandardBatteryChannel && !isDiscoveredBatteryChannel) || rawBytes.length < 1) {
    return null;
  }

  const battery = rawBytes[0];
  if (!Number.isFinite(battery) || battery < 0 || battery > 100) return null;

  return {
    type: 'battery',
    protocol: 'rw',
    deviceId: res.deviceId,
    uniMacId: stableIdentity,
    mac: stableIdentity,
    advertis: device.advertis,
    deviceName: device.name,
    battery,
    value: `${battery}%`,
    status: 'normal',
    source: 'standard_ble_battery_service',
    serviceId: res.serviceId,
    characteristicId: res.characteristicId,
    timestamp: receivedAt,
    receivedAt,
    parsedAt: receivedAt
  };
}

function parseStandardDeviceInformationNotification(
  res: { deviceId: string; serviceId: string; characteristicId: string },
  rawBytes: Uint8Array,
  device: RingDeviceInfo,
  stableIdentity: string,
  receivedAt: number
): RingParsedData | null {
  const isStandardDeviceInformationService =
    sameUuid(res.serviceId, BLE_DEVICE_INFORMATION_SERVICE_UUID) ||
    sameUuid(res.serviceId, device.standardFirmwareServiceId || '') ||
    sameUuid(res.serviceId, device.standardHardwareServiceId || '') ||
    sameUuid(res.serviceId, device.standardSoftwareServiceId || '');
  if (!isStandardDeviceInformationService || rawBytes.length < 1) return null;
  const version = decodeStandardBleText(rawBytes);
  if (!version) return null;

  const isFirmware =
    sameUuid(res.characteristicId, BLE_FIRMWARE_REVISION_CHAR_UUID) || Boolean(device.standardFirmwareCharId && sameUuid(res.characteristicId, device.standardFirmwareCharId));
  const isHardware =
    sameUuid(res.characteristicId, BLE_HARDWARE_REVISION_CHAR_UUID) || Boolean(device.standardHardwareCharId && sameUuid(res.characteristicId, device.standardHardwareCharId));
  const isSoftware =
    sameUuid(res.characteristicId, BLE_SOFTWARE_REVISION_CHAR_UUID) || Boolean(device.standardSoftwareCharId && sameUuid(res.characteristicId, device.standardSoftwareCharId));
  if (!isFirmware && !isHardware && !isSoftware) return null;

  return {
    type: 'firmware_version',
    protocol: 'rw',
    deviceId: res.deviceId,
    uniMacId: stableIdentity,
    mac: stableIdentity,
    advertis: device.advertis,
    deviceName: device.name,
    ...(isFirmware ? { firmwareVersion: version } : {}),
    ...(isHardware ? { hardwareVersion: version } : {}),
    ...(isSoftware ? { softwareVersion: version, uiVersion: version } : {}),
    value: version,
    status: 'normal',
    source: 'standard_ble_device_information_service',
    serviceId: res.serviceId,
    characteristicId: res.characteristicId,
    timestamp: receivedAt,
    receivedAt,
    parsedAt: receivedAt
  };
}

function parseStandardHeartRateMeasurementNotification(
  res: { deviceId: string; serviceId: string; characteristicId: string },
  rawBytes: Uint8Array,
  device: RingDeviceInfo,
  stableIdentity: string,
  receivedAt: number
): RingParsedData | null {
  const isStandardHeartRateChannel = sameUuid(res.serviceId, BLE_HEART_RATE_SERVICE_UUID) && sameUuid(res.characteristicId, BLE_HEART_RATE_MEASUREMENT_CHAR_UUID);
  const isDiscoveredHeartRateChannel =
    Boolean(device.standardHeartRateServiceId && device.standardHeartRateCharId) &&
    sameUuid(res.serviceId, device.standardHeartRateServiceId || '') &&
    sameUuid(res.characteristicId, device.standardHeartRateCharId || '');
  if ((!isStandardHeartRateChannel && !isDiscoveredHeartRateChannel) || rawBytes.length < 2) {
    return null;
  }

  const flags = rawBytes[0];
  const isUint16 = Boolean(flags & 0x01);
  if (isUint16 && rawBytes.length < 3) return null;
  const heartRate = isUint16 ? rawBytes[1] | (rawBytes[2] << 8) : rawBytes[1];
  if (!isLikelyHeartRateValue(heartRate)) return null;

  return {
    type: 'active_measure',
    protocol: 'rw',
    deviceId: res.deviceId,
    uniMacId: stableIdentity,
    mac: stableIdentity,
    advertis: device.advertis,
    deviceName: device.name,
    heartRate,
    heartbeatStatus: 1,
    status: 'normal',
    source: 'standard_ble_heart_rate_service',
    serviceId: res.serviceId,
    characteristicId: res.characteristicId,
    timestamp: receivedAt,
    receivedAt,
    parsedAt: receivedAt
  };
}

function parseStandardPulseOximeterNotification(
  res: { deviceId: string; serviceId: string; characteristicId: string },
  rawBytes: Uint8Array,
  device: RingDeviceInfo,
  stableIdentity: string,
  receivedAt: number
): RingParsedData | null {
  const isStandardPulseOximeterChannel =
    sameUuid(res.serviceId, BLE_PULSE_OXIMETER_SERVICE_UUID) &&
    (sameUuid(res.characteristicId, BLE_PLX_CONTINUOUS_CHAR_UUID) || sameUuid(res.characteristicId, BLE_PLX_SPOT_CHECK_CHAR_UUID));
  const isDiscoveredPulseOximeterChannel =
    Boolean(device.standardPulseOximeterServiceId && device.standardPulseOximeterCharId) &&
    sameUuid(res.serviceId, device.standardPulseOximeterServiceId || '') &&
    sameUuid(res.characteristicId, device.standardPulseOximeterCharId || '');
  if ((!isStandardPulseOximeterChannel && !isDiscoveredPulseOximeterChannel) || rawBytes.length < 2) {
    return null;
  }

  const sfloatBloodOxygen = parseBluetoothSfloat(rawBytes, 1);
  const sfloatHeartRate = parseBluetoothSfloat(rawBytes, 3);
  const roundedSfloatBloodOxygen = typeof sfloatBloodOxygen === 'number' ? Math.round(sfloatBloodOxygen) : null;
  const roundedSfloatHeartRate = typeof sfloatHeartRate === 'number' ? Math.round(sfloatHeartRate) : null;
  const compactBloodOxygen = parseCompactPulseOximeterValue(rawBytes, 1);
  const compactHeartRate = parseCompactPulseOximeterValue(rawBytes, 2);
  const roundedBloodOxygen = isLikelyBloodOxygenValue(roundedSfloatBloodOxygen)
    ? roundedSfloatBloodOxygen
    : isLikelyBloodOxygenValue(compactBloodOxygen)
      ? compactBloodOxygen
      : null;
  const roundedHeartRate = isLikelyHeartRateValue(roundedSfloatHeartRate) ? roundedSfloatHeartRate : isLikelyHeartRateValue(compactHeartRate) ? compactHeartRate : null;
  if (!isLikelyBloodOxygenValue(roundedBloodOxygen)) return null;

  return {
    type: 'active_OxyGenMeasure',
    protocol: 'rw',
    deviceId: res.deviceId,
    uniMacId: stableIdentity,
    mac: stableIdentity,
    advertis: device.advertis,
    deviceName: device.name,
    ...(isLikelyHeartRateValue(roundedHeartRate) ? { heartRate: roundedHeartRate } : {}),
    bloodOxygen: roundedBloodOxygen,
    bloodOxygenStatus: 1,
    status: 'normal',
    source: 'standard_ble_pulse_oximeter_service',
    serviceId: res.serviceId,
    characteristicId: res.characteristicId,
    timestamp: receivedAt,
    receivedAt,
    parsedAt: receivedAt
  };
}

function parseBluetoothSfloat(bytes: Uint8Array, offset: number) {
  if (offset + 1 >= bytes.length) return null;
  const raw = bytes[offset] | (bytes[offset + 1] << 8);
  if (raw === 0x07ff || raw === 0x0800 || raw === 0x0801 || raw === 0x0802 || raw === 0x0803) return null;
  let mantissa = raw & 0x0fff;
  if (mantissa >= 0x0800) mantissa -= 0x1000;
  let exponent = (raw >> 12) & 0x0f;
  if (exponent >= 0x08) exponent -= 0x10;
  const value = mantissa * 10 ** exponent;
  return Number.isFinite(value) ? value : null;
}

function parseCompactPulseOximeterValue(bytes: Uint8Array, offset: number) {
  if (offset >= bytes.length) return null;
  const value = bytes[offset];
  return Number.isFinite(value) ? value : null;
}

function isLikelyHeartRateValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 20 && value <= 240;
}

function isLikelyBloodOxygenValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 70 && value <= 100;
}

function decodeStandardBleText(bytes: Uint8Array) {
  const nonZero = Array.from(bytes).filter((byte) => byte !== 0);
  if (nonZero.length === 0) return '';
  const ascii = nonZero
    .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ''))
    .join('')
    .trim();
  return ascii;
}

function bufferToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
