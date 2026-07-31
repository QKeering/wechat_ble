<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onShow, onHide, onLoad, onPageScroll, onPullDownRefresh } from '@dcloudio/uni-app';
import { useRingBLE } from '@/composables/useRingBLE';
import { useRingBusinessController } from '@/composables/useRingBusinessController';
import {
  RW_FOREGROUND_METRIC_READ_AT_MS,
  RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
  type RwForegroundMetric,
  formatRwForegroundMetricResult,
  getRwForegroundMetricExpectedKey,
  getRwForegroundMetricValue,
  useRwForegroundMeasurement
} from '@/composables/useRwForegroundMeasurement';
import { useUserStore } from '@/stores/user';
import { useRingStore } from '@/stores';
import type { RingParsedData } from '@/sdk/ring-ble';
import {
  RwHealthDataControlKey,
  RwKey,
  RwQkeerV2HistoryCommand,
  buildRwControlHealthDataCommand,
  buildRwDeleteHealthDataCommand,
  buildRwFrame,
  buildRwKeyCommand,
  buildRwKeyCommandWithoutChecksum,
  buildRwQkeerV2HistoryListCommand,
  buildRwQkeerV2LastDataCommand,
  buildRwQkeerV2Packet,
  buildRwReadBatteryCommand,
  buildRwReadFileListCommand,
  buildRwReadFirmwareVersionCommand,
  buildRwReadContinueKeyCommand,
  buildRwReadHealthDataCommand,
  buildRwReadHealthMonitoringCommand,
  buildRwReadKeyCommand,
  buildRwReadKeyCommandWithoutChecksum,
  buildRwReadLocalDataCommand,
  buildRwReadTimeCommand,
  buildRwSetBodyTemperatureDetectingCommand,
  buildRwSetHealthMonitoringCommand,
  bytesToHex,
  hexToBytes,
  RwKeyFlag
} from '@/sdk/ring-ble/rw/protocol';
import { getFullUrl } from '@/utils/utils.js';
import { formatBleErrorMessage, isExpectedBleRuntimeError } from '@/utils/bleError';
import {
  clearRwDiagnosticRemoteLogs,
  clearRwDiagnosticUploadQueue,
  enqueueRwDiagnosticUpload,
  flushRwDiagnosticUploadQueue
} from '@/utils/rwDiagnosticUpload';
import { submitData } from '@/common/api/homeDetail';
import { scan, getBindInfo, unbind } from '@/common/api/device';
import CustomSteps from '@/components/customSteps.vue';
import { clearFrontendRingBindingState, hasBoundRingIdentity } from '@/utils/ringBinding';
import { hasAnyRingCommunicationReady, isRingConnectionActive, isRingConnectionConnecting } from '@/utils/ringConnectionStatus';
import { clearRwDiagnosticCommandLock, setRwDiagnosticCommandLock } from '@/utils/rwDiagnosticCommandLock';
import { formatBatteryPercentForDisplay, isBatteryChargingLike } from '@/utils/batteryDisplay';
const {
  handleConnectDevice,
  deviceInfo: ringDeviceInfo,
  isDeviceConnected,
  autoConnectLastDevice,
  disconnect,
  initBluetooth,
  ensureCommunicationReady,
  refreshHealthData,
  sendBytes,
  waitForParsedData,
  waitForRwCompatHistoryIdle
} = useRingBLE();
const userStore = useUserStore();
const ringStore = useRingStore();
const controller = useRingBusinessController();
const { runRwForegroundMeasurement, stopActiveRwMeasurement } = useRwForegroundMeasurement();
const RING_DIAGNOSTIC_LOG_STORAGE_KEY = 'qkeer:ring-diagnostic-logs';
const RING_DIAGNOSTIC_LOG_MAX_COUNT = 500;
const RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH = 4000;
const RING_PROTOCOL_PROBE_REPORT_CHUNK_SIZE = 10;
const RW_DIAGNOSTIC_BUILD_TAG = 'rw-visible-build-tag-20260720-2048';
const MINE_SHOW_TEMPERATURE_PROTOCOL_PROBES = false;
const MINE_SHOW_STEP_PROTOCOL_PROBES = true;
const MINE_SHOW_SLEEP_PROTOCOL_PROBE = true;
const MINE_SLEEP_PROTOCOL_PROBE_ISOLATION_LOCK = false;
const MINE_SLEEP_PROTOCOL_PROBE_ISOLATION_OWNER = 'mine-sleep-probe-isolation';
const RING_HISTORY_REPORT_RECENT_EVENT_COUNT = 8;
const MINE_PROTOCOL_PROBE_DIAGNOSTIC_LOCK_TTL_MS = 10 * 60 * 1000;
const MINE_PROTOCOL_PROBE_HISTORY_IDLE_TIMEOUT_MS = 20000;
const MINE_PROTOCOL_PROBE_SINGLE_HISTORY_IDLE_TIMEOUT_MS = 45000;
const MINE_PROTOCOL_PROBE_BUSINESS_IDLE_TIMEOUT_MS = 45000;
const MINE_PROTOCOL_PROBE_BUSINESS_QUIET_MS = 6000;
const MINE_PROTOCOL_PROBE_HISTORY_QUIET_MS = 800;
const MINE_PROTOCOL_PROBE_READY_SETTLE_MS = 1200;
const MINE_PROTOCOL_PROBE_RESTORE_SETTLE_MS = 9000;
interface RingDiagnosticLogEntry {
  id: number;
  time: string;
  source: string;
  event: string;
  details: string;
}
type MineHistorySyncKey = 'all' | 'summary' | 'sleep' | 'activity' | 'stress' | 'vital';
type MineProtocolProbeMode =
  | 'core'
  | 'full'
  | 'temperature'
  | 'temperatureMonitoring'
  | 'temperatureDetecting'
  | 'temperatureDetectingPlain'
  | 'temperatureDetectingShort'
  | 'temperatureDetectingNoCrc'
  | 'temperatureRealtimeRead'
  | 'temperatureRealtimeControlEnable'
  | 'temperatureRealtimeControlDisable'
  | 'temperatureHistory'
  | 'stressMonitoring'
  | 'heartRateRealtime'
  | 'bloodOxygenRealtime'
  | 'hrvRealtime'
  | 'stepCurrentDay'
  | 'stepCurrentDayC6'
  | 'activityHistory'
  | 'sleepHistory'
  | 'sleepSdkHistory'
  | 'sleepNativeDetail'
  | 'sleepNativeList'
  | 'sleepEnhanceRead'
  | 'sleepActivityCurrentDay'
  | 'sleepContinueHistory'
  | 'rawSleepHistory'
  | 'sleepDelete'
  | 'stepSleep';
interface MineHistorySyncItem {
  key: MineHistorySyncKey;
  label: string;
  dataType?: string;
  dataTypes?: string[];
}
interface MineMetricTestItem {
  name: RwForegroundMetric;
  label: string;
}
interface MineProtocolProbeCommand {
  key: string;
  label: string;
  family?: string;
  required?: boolean;
  expected: string;
  build: () => Uint8Array;
  predicate: (parsed: RingParsedData) => boolean;
  writeOnlyOk?: boolean;
  timeoutMs?: number;
  delayAfterMs?: number;
  pollAtMs?: readonly number[];
  pollResponseGraceMs?: number;
}
interface MineProtocolProbeSummaryItem {
  index?: number;
  key: string;
  label?: string;
  family?: string;
  required: boolean;
  expected?: string;
  timeoutMs?: number;
  ok?: boolean;
  timeout?: boolean;
}
interface MineRealtimeProbeMetric {
  keyPrefix: string;
  name: RwForegroundMetric;
  label: string;
  controlKey: RwHealthDataControlKey;
  realtimeKey: RwKey;
  readableKey: RwKey;
}
type MineRwDiagnosticActionOptions = {
  fromAcceptance?: boolean;
  silentToast?: boolean;
};

const bindInfo = ref<any>(null);
const menuList = [
  {
    icon: '/static/images/mine/menu01.png',
    title: '\u5bb6\u4eba\u5b88\u62a4',
    path: '/pages/family/family'
  },
  {
    icon: '/static/images/mine/menu02.png',
    title: '\u957f\u8f88\u6a21\u5f0f',
    path: '/pages/family/elderHome'
  },
  {
    icon: '/static/images/mine/menu01.png',
    title: '\u8bbe\u5907\u4fe1\u606f',
    path: '/pagesA/mines/device'
  },
  {
    icon: '/static/images/mine/menu02.png',
    title: '\u529f\u80fd\u8bbe\u7f6e',
    path: '/pagesA/mines/setting'
  },
  {
    icon: '/static/images/mine/menu03.png',
    title: '\u4f7f\u7528\u6307\u5357',
    path: '/pagesA/mines/guide'
  },
  {
    icon: '/static/images/mine/menu04.png',
    title: '\u5e38\u89c1\u95ee\u9898',
    path: '/pagesA/mines/question'
  }
];// const pullDownProgress// const pullDownProgress = ref(0);
const mineMenuNavigating = ref(false);
const handleMineMenuTap = (item: { path?: string }) => {
  if (!item?.path || mineMenuNavigating.value) return;
  mineMenuNavigating.value = true;
  (uni as any).$uv.route(item.path);
  setTimeout(() => {
    mineMenuNavigating.value = false;
  }, 800);
};
const scrollTop = ref(0);
// Delay hiding upload progress so success state remains visible briefly.
const shouldHideProgress = ref(false);
const historySyncBusy = ref(false);
const activeHistorySyncKey = ref<MineHistorySyncKey | ''>('');
const metricTestBusy = ref(false);
const activeMetricTestName = ref<RwForegroundMetric | ''>('');
const protocolProbeBusy = ref(false);
const activeProtocolProbeMode = ref<MineProtocolProbeMode | ''>('');
const activeProtocolProbeLabel = ref('');
const mineDeviceInfoSnapshotBusy = ref(false);
const mineRwAcceptanceBusy = ref(false);
const activeMineRwAcceptanceStep = ref('');
const rwDiagnosticActionText = ref('');
const latestMineMetricResult = ref<Record<string, any> | null>(null);
const mineHistorySummaryItem: MineHistorySyncItem = { key: 'summary', label: '\u6458\u8981', dataType: 'lastData' };
const mineHistorySyncItems: MineHistorySyncItem[] = [
  { key: 'sleep', label: '\u7761\u7720', dataTypes: ['sleepData'] },
  { key: 'activity', label: '\u6d3b\u52a8', dataTypes: ['activity'] },
  { key: 'stress', label: '\u538b\u529b', dataTypes: ['stress'] },
  { key: 'vital', label: '\u4f53\u5f81', dataTypes: ['heartRate', 'bloodOxygen', 'hrv', 'temperature', 'skinTemperature', 'bloodSugar', 'bloodPressure'] }
];
const mineMetricTestItems: MineMetricTestItem[] = [
  { name: 'heart_rate', label: '\u5fc3\u7387' },
  { name: 'blood_oxygen', label: '\u8840\u6c27' },
  { name: 'temperature', label: '\u4f53\u6e29' },
  { name: 'hrv', label: 'HRV' },
  { name: 'stress', label: '\u538b\u529b' },
  { name: 'blood_pressure', label: '\u8840\u538b' },
  { name: 'blood_sugar', label: '\u8840\u7cd6' }
];
const MINE_RW_L19_ACCEPTANCE_EXPECTED_KEYS = [
  'core-protocol',
  'metric:heart_rate',
  'metric:blood_oxygen',
  'metric:temperature',
  'metric:hrv',
  'metric:stress',
  'metric:blood_pressure',
  'metric:blood_sugar',
  'history:sleep',
  'history:activity',
  'history:stress',
  'history:vital'
];
const local = computed(() => userStore.localData);
const isIOS = computed(() => {
  const systemInfo = uni.getSystemInfoSync();
  return systemInfo.platform.toLowerCase().includes('ios');
});
const hasMineCommunicationReady = () =>
  hasAnyRingCommunicationReady(ringDeviceInfo.value, userStore.deviceInfo, ringStore.deviceInfo);
const getMineCurrentProtocol = () =>
  ringDeviceInfo.value?.protocol || ringStore.deviceInfo?.protocol || userStore.deviceInfo?.protocol;
const isMineRwRing = () => getMineCurrentProtocol() === 'rw';
const summarizeMineDevice = (device: Record<string, any> | null | undefined) => ({
  deviceId: device?.deviceId,
  name: device?.deviceName || device?.name || device?.localName || device?.displayName,
  protocol: device?.protocol,
  uniMacId: device?.uniMacId,
  mac: device?.mac || device?.advertis?.macInfo,
  serviceId: device?.serviceId,
  cmdCharId: device?.cmdCharId,
  dataServiceId: device?.dataServiceId,
  dataCharId: device?.dataCharId,
  notifyEnabled: device?.notifyEnabled
});
const escapeMineDiagnosticJsonText = (text: string) =>
  text.replace(/[^\x20-\x7e]/g, (char) =>
    Array.from(char)
      .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join('')
  );
const formatMineDiagnosticTime = (date = new Date()) => {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
};
const appendMineDiagnosticLog = (event: string, details?: unknown) => {
  try {
    const raw = uni.getStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY);
    const logs = Array.isArray(raw) ? raw : [];
    const entry = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      time: formatMineDiagnosticTime(),
      source: 'RW MINE',
      event,
      details: JSON.stringify(details || {})
    };
    logs.push(entry);
    uni.setStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY, logs.slice(-RING_DIAGNOSTIC_LOG_MAX_COUNT));
    enqueueRwDiagnosticUpload(entry);
  } catch {
    // Ignore diagnostic logging failures.
  }
};
const normalizeMineDiagnosticLogEntry = (entry: unknown): RingDiagnosticLogEntry | null => {
  if (!entry || typeof entry !== 'object') return null;
  const item = entry as Record<string, unknown>;
  const source = String(item.source || '').trim();
  const event = String(item.event || '').trim();
  if (!source || !event) return null;
  return {
    id: typeof item.id === 'number' ? item.id : Date.now(),
    time: String(item.time || ''),
    source,
    event,
    details: typeof item.details === 'string' ? item.details : JSON.stringify(item.details || '')
  };
};
const readMineDiagnosticLogs = (limit = 220): RingDiagnosticLogEntry[] => {
  try {
    const raw = uni.getStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY);
    const logs = Array.isArray(raw) ? raw.map(normalizeMineDiagnosticLogEntry).filter(Boolean) : [];
    return (logs as RingDiagnosticLogEntry[]).slice(-limit);
  } catch {
    return [];
  }
};
const clearMineDiagnosticLogs = () => {
  try {
    uni.setStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY, []);
  } catch {
    // Ignore diagnostic storage errors.
  }
};
const normalizeMineDiagnosticDetails = (details: unknown, maxLength = RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH) => {
  if (details == null) return '';
  let text = '';
  if (typeof details === 'string') {
    text = escapeMineDiagnosticJsonText(details);
  } else {
    try {
      const jsonText = JSON.stringify(details);
      text = escapeMineDiagnosticJsonText(jsonText === undefined ? String(details) : jsonText);
    } catch {
      text = escapeMineDiagnosticJsonText(String(details));
    }
  }
  return text.length > maxLength
    ? `${text.slice(0, maxLength)}...<truncated>`
    : text;
};
const formatMineDiagnosticLogEntry = (entry: RingDiagnosticLogEntry) => {
  const details = entry.details ? ` ${entry.details}` : '';
  return `[${entry.time}] [${entry.source}] ${entry.event}${details}`;
};
const formatMineDiagnosticLogs = (logs: RingDiagnosticLogEntry[]) => logs.map(formatMineDiagnosticLogEntry).join('\n');
const parseMineDiagnosticDetails = (entry: RingDiagnosticLogEntry): Record<string, any> => {
  try {
    const parsed = JSON.parse(entry.details || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};
const trimMineDiagnosticText = (value: unknown, maxLength = 120) => {
  if (value == null) return undefined;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};
const toMineDiagnosticCount = (...values: unknown[]) => {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
};
const toMineDiagnosticTextList = (value: unknown) => {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
};
const compactMineMetricCounts = (...values: unknown[]) => {
  const source = values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) as Record<string, any> | undefined;
  if (!source) return undefined;
  const result = Object.fromEntries(
    Object.entries(source)
      .map(([key, value]) => [key, toMineDiagnosticCount(value)])
      .filter(([, value]) => value !== undefined && Number(value) > 0)
  );
  return Object.keys(result).length > 0 ? result : undefined;
};
const compactMineQueryHints = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = Object.fromEntries(
    Object.entries(value as Record<string, any>)
      .filter(([, itemValue]) => itemValue !== undefined && itemValue !== null && itemValue !== '')
      .slice(0, 12)
  );
  return Object.keys(result).length > 0 ? result : undefined;
};
const getMineDiagnosticRecordValue = (record: Record<string, any>, aliases: string[]) => {
  for (const alias of aliases) {
    const value = record[alias];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  const lowerCaseEntries = Object.entries(record).reduce<Record<string, any>>((result, [key, value]) => {
    const normalizedKey = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(result, normalizedKey)) result[normalizedKey] = value;
    return result;
  }, {});
  for (const alias of aliases) {
    const value = lowerCaseEntries[alias.toLowerCase()];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};
const compactMineHistoryRecordSample = (value: unknown, maxCount = 2) => {
  if (!Array.isArray(value)) return undefined;
  const sample = value.slice(0, maxCount).map((item) => {
    if (!item || typeof item !== 'object') return item;
    const record = item as Record<string, any>;
    return Object.fromEntries(
      Object.entries({
        t: getMineDiagnosticRecordValue(record, ['recordTime', 'time', 'timestampText']),
        unix: getMineDiagnosticRecordValue(record, ['unixTime', 'timestamp', 'startTimestamp', 'recordTimestamp']),
        dt: getMineDiagnosticRecordValue(record, ['dataType', 'rawDataType', 'fileType', 'type']),
        rawDt: getMineDiagnosticRecordValue(record, ['rawDataType', 'fileType', 'sourceType']),
        key: getMineDiagnosticRecordValue(record, ['key', 'dataKey']),
        step: getMineDiagnosticRecordValue(record, ['stepCount', 'step_count', 'step', 'steps', 'totalSteps']),
        hr: getMineDiagnosticRecordValue(record, ['heartRate', 'heart_rate', 'heartrate', 'hr']),
        spo2: getMineDiagnosticRecordValue(record, ['spo2', 'bloodOxygen', 'blood_oxygen', 'bloodOxygenSaturation', 'bloodOxy', 'oxygen', 'bo']),
        hrv: getMineDiagnosticRecordValue(record, ['hrv', 'heartRateVariability', 'heart_rate_variability']),
        stress: getMineDiagnosticRecordValue(record, ['stress', 'stressIndex', 'stress_index', 'pressure', 'fatigue']),
        temp: getMineDiagnosticRecordValue(record, [
          'temperature',
          'temp',
          'bodyTemperature',
          'body_temperature',
          'bodyTemp',
          'body_temp',
          'skinTemperature',
          'skin_temperature',
          'skinTemp',
          'skin_temp'
        ]),
        bs: getMineDiagnosticRecordValue(record, ['bloodSugar', 'blood_sugar', 'glucose', 'sugar']),
        sys: getMineDiagnosticRecordValue(record, ['systolic', 'sbp', 'sp', 'high', 'highPressure', 'bloodPressureHigh']),
        dia: getMineDiagnosticRecordValue(record, ['diastolic', 'dbp', 'dp', 'low', 'lowPressure', 'bloodPressureLow']),
        slp: getMineDiagnosticRecordValue(record, ['sleepState', 'sleep_state', 'sleepStage', 'sleep_stage', 'sleepType', 'sleep_type', 'stage']),
        dur: getMineDiagnosticRecordValue(record, ['sleepDuration', 'durationMinutes', 'duration_minutes', 'sleepMinutes', 'sleep_minutes', 'len']),
        raw: getMineDiagnosticRecordValue(record, ['rawHex']),
        data: getMineDiagnosticRecordValue(record, ['dataHex'])
      }).filter(([, itemValue]) => itemValue !== undefined && itemValue !== null && itemValue !== '')
    );
  });
  return sample.length > 0 ? sample : undefined;
};
const compactMineHistorySubmitResponse = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const response = value as Record<string, any>;
  const summaryDates = Array.isArray(response.summaryDates)
    ? response.summaryDates.slice(0, 3).map((item) => {
        if (!item || typeof item !== 'object') return item;
        const record = item as Record<string, any>;
        return {
          date: record.date,
          elapsedMs: record.elapsedMs,
          hasSummary: record.hasSummary
        };
      })
    : response.summaryDates;
  return Object.fromEntries(
    Object.entries({
      success: response.success,
      code: response.code,
      count: response.count,
      inputCount: response.inputCount,
      healthCount: response.healthCount,
      sleepCount: response.sleepCount,
      failCount: response.failCount,
      elapsedMs: response.elapsedMs,
      syncElapsedMs: response.syncElapsedMs,
      healthWriteMs: response.healthWriteMs,
      sleepWriteMs: response.sleepWriteMs,
      deviceUpdateMs: response.deviceUpdateMs,
      summaryMs: response.summaryMs,
      touchedDates: response.touchedDates,
      summaryDates,
      message: trimMineDiagnosticText(response.message, 80)
    }).filter(([, itemValue]) => itemValue !== undefined && itemValue !== null && itemValue !== '')
  );
};
const getMineProtocolProbeLogKey = (details: Record<string, any>) => `${details.index || ''}:${details.key || ''}`;
const MINE_PROTOCOL_PROBE_COMMAND_EVENTS = new Set([
  'protocol-probe-command-start',
  'protocol-probe-command-poll',
  'protocol-probe-command-response',
  'protocol-probe-command-write-ok',
  'protocol-probe-command-timeout',
  'protocol-probe-command-error'
]);
const MINE_PROTOCOL_PROBE_COPY_EVENTS = new Set([
  'protocol-probe-plan',
  'protocol-probe-summary',
  'protocol-probe-history-busy',
  'protocol-probe-failed'
]);
const MINE_DIAGNOSTIC_RAW_COPY_EVENTS = new Set([
  'diagnostic-build',
  'diagnostic-copy-incomplete',
  'manual-reconnect-error',
  'manual-reconnect-result',
  'protocol-probe-command-timeout',
  'protocol-probe-command-error',
  'protocol-probe-summary',
  'protocol-probe-history-busy',
  'protocol-probe-failed',
  'manual-metric-result',
  'manual-metric-failed',
  'manual-history-sync-result',
  'manual-history-sync-failed',
  'rw-l19-acceptance-step-result',
  'rw-l19-acceptance-step-failed',
  'rw-l19-acceptance-summary'
]);
const isMineProtocolProbeCommandEvent = (entry: RingDiagnosticLogEntry) => MINE_PROTOCOL_PROBE_COMMAND_EVENTS.has(entry.event);
const getMineProtocolProbeScopedLogs = (logs: RingDiagnosticLogEntry[]) => {
  const lastProbeStartIndex = logs.map((entry) => entry.event).lastIndexOf('protocol-probe-start');
  if (lastProbeStartIndex >= 0) {
    const scopedLogs = logs.slice(lastProbeStartIndex);
    return {
      logs: scopedLogs,
      truncated: false,
      startDetails: parseMineDiagnosticDetails(scopedLogs[0])
    };
  }

  const commandLogs = logs.filter((entry) => isMineProtocolProbeCommandEvent(entry) || MINE_PROTOCOL_PROBE_COPY_EVENTS.has(entry.event));
  return {
    logs: commandLogs,
    truncated: commandLogs.some(isMineProtocolProbeCommandEvent),
    startDetails: {}
  };
};
const isMineHistoryDiagnosticEvent = (entry: RingDiagnosticLogEntry) => {
  if (entry.source === 'RW HISTORY') return true;
  if (entry.source === 'RW FLOW' && entry.event.startsWith('history-')) return true;
  if (entry.source === 'RW PAGE' && entry.event.startsWith('history-page-')) return true;
  if (entry.source === 'RW MINE' && entry.event.startsWith('manual-history-')) return true;
  return entry.event === 'diagnostic-history-report';
};
const isMineDiagnosticRawCopyEvent = (entry: RingDiagnosticLogEntry) => {
  if (MINE_DIAGNOSTIC_RAW_COPY_EVENTS.has(entry.event)) return true;
  if (/timeout|failed|error/i.test(entry.event)) return true;
  if (isMineHistoryDiagnosticEvent(entry)) {
    return /result|failed|timeout|retry|fallback|continue|empty-use-pre-native|upload|query|not-submittable|diagnostic-history-report/i.test(entry.event);
  }
  return false;
};
const formatMineDiagnosticCopyRawLogEntry = (entry: RingDiagnosticLogEntry) =>
  formatMineDiagnosticLogEntry({
    ...entry,
    details: normalizeMineDiagnosticDetails(parseMineDiagnosticDetails(entry), 1200)
  });
const formatMineDiagnosticCopyRawLogs = (logs: RingDiagnosticLogEntry[]) => logs.map(formatMineDiagnosticCopyRawLogEntry).join('\n');
const getMineDiagnosticRawCopyLogs = (logs: RingDiagnosticLogEntry[]) => {
  const filtered = logs.filter(isMineDiagnosticRawCopyEvent);
  if (filtered.length > 0) return filtered.slice(-40);
  return logs.filter((entry) => entry.source === 'RW MINE').slice(-20);
};
const summarizeMineHistoryDiagnosticEvent = (entry: RingDiagnosticLogEntry) => {
  const details = parseMineDiagnosticDetails(entry);
  const response = details.response && typeof details.response === 'object' ? details.response : {};
  const summary = details.summary && typeof details.summary === 'object' ? details.summary : {};
  return {
    src: entry.source.replace(/^RW\s+/, ''),
    e: entry.event,
    page: details.page,
    types: toMineDiagnosticTextList(details.dataTypes || details.dataType || summary.dataTypes || summary.dataType),
    status: details.status || summary.status || response.status,
    sourceType: details.sourceType || summary.sourceType || response.sourceType || response.type,
    packet: details.packetShape || summary.packetShape || response.packetShape,
    records: toMineDiagnosticCount(details.recordCount, details.count, summary.recordCount, summary.count, response.recordCount, response.totalNum),
    rawRecords: toMineDiagnosticCount(details.rawRecordCount, details.rawCount, summary.rawRecordCount, summary.rawCount),
    submitRecords: toMineDiagnosticCount(details.submitRecordCount, summary.submitRecordCount),
    filteredRecords: toMineDiagnosticCount(details.filteredOutCount, summary.filteredOutCount),
    futureFilteredRecords: toMineDiagnosticCount(details.futureFilteredOutCount, summary.futureFilteredOutCount),
    deviceUploaded: details.deviceUploaded ?? summary.deviceUploaded,
    backendUploaded: details.backendUploaded ?? summary.backendUploaded,
    backendSubmitted: details.backendSubmitted ?? summary.backendSubmitted,
    backendUploadStarted: details.backendUploadStarted ?? summary.backendUploadStarted,
    backendUploadPending: details.backendUploadPending ?? summary.backendUploadPending,
    uploaded: details.uploaded ?? details.submitted ?? summary.uploaded ?? summary.submitted,
    rawMetrics: compactMineMetricCounts(details.rawMetricCounts, details.uploadRawMetricCounts, summary.rawMetricCounts),
    uploadRawMetrics: compactMineMetricCounts(details.uploadRawMetricCounts, summary.uploadRawMetricCounts),
    submitMetrics: compactMineMetricCounts(details.submitMetricCounts, summary.submitMetricCounts),
    primaryRawMetrics: compactMineMetricCounts(details.primaryRawMetricCounts, summary.primaryRawMetricCounts),
    missingMetrics: toMineDiagnosticTextList(details.missingMetrics || summary.missingMetrics),
    rawSample: compactMineHistoryRecordSample(details.rawRecordSample || summary.rawRecordSample),
    filteredSample: compactMineHistoryRecordSample(
      details.filteredRecordSample || details.sampleFilteredRecords || summary.filteredRecordSample || summary.sampleFilteredRecords
    ),
    submitSample: compactMineHistoryRecordSample(details.submitRecordSample || summary.submitRecordSample),
    futureSample: compactMineHistoryRecordSample(
      details.futureFilteredRecordSample || details.sampleFutureFilteredRecords || summary.futureFilteredRecordSample || summary.sampleFutureFilteredRecords
    ),
    submitResponse: compactMineHistorySubmitResponse(details.submitResponse || summary.submitResponse),
    queryEndpoint: details.endpoint,
    queryItems: toMineDiagnosticCount(response.itemCount),
    queryHints: compactMineQueryHints(response.valueHints),
    queryRootKeys: toMineDiagnosticTextList(response.rootKeys).slice(0, 8),
    queryPayloadKeys: toMineDiagnosticTextList(response.payloadKeys).slice(0, 8),
    elapsedMs: toMineDiagnosticCount(details.elapsedMs, summary.elapsedMs),
    phase: details.phase || summary.phase,
    waitMs: toMineDiagnosticCount(details.waitMs),
    timeoutMs: toMineDiagnosticCount(details.timeoutMs),
    responseWaitMs: toMineDiagnosticCount(details.responseWaitMs),
    uploadTimeoutMs: toMineDiagnosticCount(details.uploadTimeoutMs),
    queueDepth: toMineDiagnosticCount(details.queueDepth),
    queuedBehind: toMineDiagnosticCount(details.queuedBehind),
    unexpectedResponseCount: toMineDiagnosticCount(details.unexpectedResponseCount),
    attempt: details.attempt || details.nextAttempt,
    flag: toMineDiagnosticCount(details.flag, response.flag),
    key: details.key,
    label: details.label,
    commands: toMineDiagnosticTextList(details.commands),
    error: trimMineDiagnosticText(details.error || details.message, 100),
    rawError: trimMineDiagnosticText(details.rawError, 160)
  };
};
const countMineHistoryEvents = (events: RingDiagnosticLogEntry[], names: string[]) =>
  names.reduce<Record<string, number>>((result, name) => {
    result[name] = events.filter((entry) => entry.event === name).length;
    return result;
  }, {});
const findLastMineHistoryEvent = (events: RingDiagnosticLogEntry[], names: string[]) =>
  [...events].reverse().find((entry) => names.includes(entry.event));
const summarizeMineHistoryCommandResults = (events: RingDiagnosticLogEntry[]) => {
  const commandRows: Array<Record<string, any>> = [];
  const commandEvents = new Set(['history-ab-key-response', 'history-ab-key-timeout']);

  events.forEach((entry) => {
    if (!commandEvents.has(entry.event)) return;
    const details = parseMineDiagnosticDetails(entry);
    const response = details.response && typeof details.response === 'object' ? details.response as Record<string, any> : {};
    const label = details.label || response.name || details.key;
    if (!label && details.key === undefined) return;
    const responseRecordCount = toMineDiagnosticCount(response.recordCount, response.totalNum) || 0;
    const hasPayload =
      details.hasPayload === true ||
      responseRecordCount > 0 ||
      (response.value !== undefined && response.value !== null && response.value !== '');

    commandRows.push(
      Object.fromEntries(
        Object.entries({
          e: entry.event.replace('history-ab-key-', ''),
          label,
          key: details.key ?? response.key,
          phase: details.phase,
          attempt: details.attempt,
          flag: toMineDiagnosticCount(details.flag, response.flag),
          status: entry.event === 'history-ab-key-timeout' ? 'timeout' : hasPayload ? 'payload' : 'empty',
          records: toMineDiagnosticCount(response.recordCount, response.totalNum),
          value: response.value,
          raw: trimMineDiagnosticText(response.rawHex, 40),
          error: trimMineDiagnosticText(details.error, 80)
        }).filter(([, value]) => value !== undefined && value !== null && value !== '')
      )
    );
  });

  return commandRows.length > 0 ? commandRows.slice(-24) : undefined;
};
const summarizeMineHistoryFallbackFlow = (events: RingDiagnosticLogEntry[]) => {
  const latestNative = findLastMineHistoryEvent(events, ['history-native-list-wait-response', 'history-native-list-wait-timeout']);
  const latestLastData = findLastMineHistoryEvent(events, ['history-last-data-wait-response', 'history-last-data-wait-timeout']);
  const latestFinalRead = findLastMineHistoryEvent(events, ['history-final-read-local-data-response', 'history-final-read-local-data-timeout']);
  const latestPreflight = findLastMineHistoryEvent(events, ['history-preflight-response', 'history-preflight-timeout', 'history-preflight-failed']);
  const compact = (entry?: RingDiagnosticLogEntry) => {
    if (!entry) return undefined;
    const details = parseMineDiagnosticDetails(entry);
    return Object.fromEntries(
      Object.entries({
        e: entry.event,
        waitMs: toMineDiagnosticCount(details.waitMs),
        responseType: details.response?.type || details.responseType,
        records: toMineDiagnosticCount(details.response?.recordCount, details.response?.totalNum),
        raw: trimMineDiagnosticText(details.response?.rawHex, 40),
        error: trimMineDiagnosticText(details.error || details.message, 80)
      }).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
  };
  return Object.fromEntries(
    Object.entries({
      preflight: compact(latestPreflight),
      nativeList: compact(latestNative),
      lastData: compact(latestLastData),
      finalRead: compact(latestFinalRead)
    }).filter(([, value]) => value !== undefined)
  );
};
const formatMineHistoryCompactReport = (logs: RingDiagnosticLogEntry[]) => {
  const historyLogs = logs.filter(isMineHistoryDiagnosticEvent);
  if (historyLogs.length === 0) return '';
  const startEvents = ['history-page-sync-start', 'history-sync-start', 'manual-history-sync-start', 'history-initial-wait-start'];
  const lastStartIndex = Math.max(...startEvents.map((event) => historyLogs.map((entry) => entry.event).lastIndexOf(event)));
  const scopedLogs = lastStartIndex >= 0 ? historyLogs.slice(lastStartIndex) : historyLogs.slice(-40);
  const latestTerminal =
    findLastMineHistoryEvent(scopedLogs, [
      'history-page-upload-result',
      'history-page-upload-failed',
      'history-page-upload-start',
      'history-page-sync-result',
      'history-page-sync-failed',
      'history-sync-result',
      'history-sync-failed',
      'manual-history-sync-result',
      'manual-history-sync-failed',
      'history-initial-timeout',
      'ab-health-history-received',
      'history-ab-key-partial-continue',
      'history-ab-key-empty-use-pre-native',
      'history-page-missing-vital-fallback-result',
      'history-page-missing-vital-fallback-failed',
      'history-page-missing-step-sleep-fallback-result',
      'history-page-missing-step-sleep-fallback-failed',
      'history-page-empty-fallback-result',
      'history-page-empty-fallback-failed',
      'native-list-received',
      'history-native-list-wait-response',
      'history-native-list-wait-timeout',
      'history-last-data-wait-response',
      'history-last-data-wait-timeout',
      'legacy-local-data-received'
    ]) || scopedLogs[scopedLogs.length - 1];
  const latestUpload = findLastMineHistoryEvent(scopedLogs, ['history-page-upload-result', 'history-page-upload-failed', 'history-page-upload-start']);
  const latestQuery = findLastMineHistoryEvent(scopedLogs, ['history-page-query-result', 'history-page-query-failed']);
  return formatMineDiagnosticLogEntry({
    id: Date.now(),
    time: formatMineDiagnosticTime(),
    source: 'RW MINE',
    event: 'diagnostic-history-report',
    details: normalizeMineDiagnosticDetails({
      tag: RW_DIAGNOSTIC_BUILD_TAG,
      n: scopedLogs.length,
      counts: countMineHistoryEvents(scopedLogs, [
        'history-page-sync-start',
        'history-page-sync-result',
        'history-page-sync-failed',
        'history-page-upload-start',
        'history-page-upload-result',
        'history-page-upload-failed',
        'history-page-missing-vital-fallback-start',
        'history-page-missing-vital-fallback-result',
        'history-page-missing-vital-fallback-upload-failed',
        'history-page-missing-vital-fallback-failed',
        'history-page-missing-step-sleep-fallback-start',
        'history-page-missing-step-sleep-fallback-result',
        'history-page-missing-step-sleep-fallback-upload-failed',
        'history-page-missing-step-sleep-fallback-failed',
        'history-page-empty-fallback-start',
        'history-page-empty-fallback-result',
        'history-page-empty-fallback-upload-failed',
        'history-page-empty-fallback-failed',
        'history-preflight-start',
        'history-preflight-response',
        'history-preflight-timeout',
        'history-fallback-wait-start',
        'history-initial-wait-start',
        'history-ab-key-fallback',
        'history-ab-key-response',
        'history-ab-key-timeout',
        'history-ab-key-retry-continue',
        'history-ab-key-partial-continue',
        'history-ab-key-empty-use-pre-native',
        'history-ab-key-result',
        'history-native-list-fallback',
        'history-native-list-wait-response',
        'history-native-list-wait-timeout',
        'history-native-last-data-fallback',
        'history-last-data-wait-response',
        'history-last-data-wait-timeout',
        'history-final-read-local-data-response',
        'history-final-read-local-data-timeout',
        'legacy-local-data-received',
        'native-list-received',
        'ab-health-history-received',
        'history-initial-timeout'
      ]),
      latest: latestTerminal ? summarizeMineHistoryDiagnosticEvent(latestTerminal) : null,
      upload: latestUpload ? summarizeMineHistoryDiagnosticEvent(latestUpload) : null,
      query: latestQuery ? summarizeMineHistoryDiagnosticEvent(latestQuery) : null,
      abCommands: summarizeMineHistoryCommandResults(scopedLogs),
      fallbackFlow: summarizeMineHistoryFallbackFlow(scopedLogs),
      recent: scopedLogs.slice(-RING_HISTORY_REPORT_RECENT_EVENT_COUNT).map(summarizeMineHistoryDiagnosticEvent)
    })
  });
};
const formatMineProtocolProbeCompactReport = (logs: RingDiagnosticLogEntry[]) => {
  const probeScope = getMineProtocolProbeScopedLogs(logs);
  if (probeScope.logs.length === 0) return '';
  const probeLogs = probeScope.logs;
  const commandMap = new Map<string, Record<string, any>>();
  const commandKeys: string[] = [];
  const ensureCommand = (details: Record<string, any>) => {
    const key = getMineProtocolProbeLogKey(details);
    if (!key || key === ':') return null;
    let item = commandMap.get(key);
    if (!item) {
      item = {};
      commandMap.set(key, item);
      commandKeys.push(key);
    }
    return item;
  };

  probeLogs.forEach((entry) => {
    if (!isMineProtocolProbeCommandEvent(entry)) return;
    const details = parseMineDiagnosticDetails(entry);
    const item = ensureCommand(details);
    if (!item) return;
    item.index = details.index ?? item.index;
    item.total = details.total ?? item.total;
    item.key = details.key || item.key;
    item.label = details.label || item.label;
    item.family = details.family || item.family;
    item.required = details.required ?? item.required;
    item.expected = details.expected || item.expected;
    item.hex = details.hex || item.hex;
    item.timeoutMs = details.timeoutMs ?? item.timeoutMs;

    if (entry.event === 'protocol-probe-command-response') {
      item.status = 'ok';
      item.elapsedMs = details.elapsedMs;
      item.rawResponseHex = details.rawResponseHex || details.rawResponsePacket || details.parsed?.rawHex;
      item.parsed = details.parsed;
    } else if (entry.event === 'protocol-probe-command-write-ok') {
      item.status = 'ok';
      item.elapsedMs = details.elapsedMs;
      item.wrote = true;
      item.writeOnly = true;
    } else if (entry.event === 'protocol-probe-command-timeout') {
      item.status = 'timeout';
      item.elapsedMs = details.elapsedMs;
      item.wrote = details.wrote;
      item.message = trimMineDiagnosticText(details.rawMessage || details.message);
    } else if (entry.event === 'protocol-probe-command-error') {
      item.status = 'error';
      item.elapsedMs = details.elapsedMs;
      item.wrote = details.wrote;
      item.message = trimMineDiagnosticText(details.rawMessage || details.message);
    } else if (entry.event === 'protocol-probe-command-poll') {
      if (!item.status) item.status = 'pending';
      item.elapsedMs = details.elapsedMs ?? item.elapsedMs;
      item.attempt = details.attempt ?? item.attempt;
      item.attemptCount = details.attemptCount ?? item.attemptCount;
    } else if (!item.status) {
      item.status = 'pending';
    }
  });

  let commands = commandKeys
    .map((key) => commandMap.get(key))
    .filter(Boolean)
    .map((item) => ({
      i: item?.index,
      t: item?.total,
      k: item?.key,
      f: item?.family,
      r: item?.required === true ? 1 : item?.required === false ? 0 : undefined,
      x: trimMineDiagnosticText(item?.expected, 64),
      h: item?.hex,
      s: item?.status || 'pending',
      ms: item?.elapsedMs,
      a: item?.attempt,
      ac: item?.attemptCount,
      to: item?.timeoutMs,
      w: item?.wrote === true ? 1 : item?.wrote === false ? 0 : undefined,
      wo: item?.writeOnly === true ? 1 : undefined,
      m: trimMineDiagnosticText(item?.message, 80),
      rh: item?.rawResponseHex,
      p: item?.parsed
        ? {
            t: item.parsed.type,
            n: item.parsed.name,
            s: item.parsed.status,
            code: item.parsed.statusCode,
            v: item.parsed.value,
            bat: item.parsed.battery,
            hr: item.parsed.heartRate,
            spo2: item.parsed.bloodOxygen,
            fw: item.parsed.firmwareVersion,
            hw: item.parsed.hardwareVersion,
            sw: item.parsed.softwareVersion,
            ui: item.parsed.uiVersion,
            c: item.parsed.recordCount,
            raw: item.parsed.rawHex
          }
        : undefined
    }));
  const getReportRowKey = (item: Record<string, any>) => `${item?.i || ''}:${item?.k || ''}`;
  const appendSummaryReportCommand = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, any>;
    const row = {
      i: record.i ?? record.index,
      t: record.t ?? record.total,
      k: record.k ?? record.key,
      f: record.f ?? record.family,
      r: record.r ?? (record.required === true ? 1 : record.required === false ? 0 : undefined),
      x: trimMineDiagnosticText(record.x ?? record.expected, 64),
      h: record.h ?? record.hex,
      s: record.s ?? record.status,
      ms: record.ms ?? record.elapsedMs,
      a: record.a ?? record.attempt,
      ac: record.ac ?? record.attemptCount,
      to: record.to ?? record.timeoutMs,
      w: record.w ?? (record.wrote === true ? 1 : record.wrote === false ? 0 : undefined),
      wo: record.wo ?? (record.writeOnly === true ? 1 : undefined),
      m: trimMineDiagnosticText(record.m ?? record.message, 80),
      rh: record.rh ?? record.rawResponseHex ?? record.rawResponsePacket ?? record.parsed?.rawHex,
      p: record.p ?? record.parsed
    };
    if (!row.k) return;
    const key = getReportRowKey(row);
    if (commands.some((existing) => getReportRowKey(existing) === key)) return;
    commands.push(row);
  };
  const summaryLogs = probeLogs.filter((entry) => entry.event === 'protocol-probe-summary');
  const latestSummary = summaryLogs.length > 0 ? parseMineDiagnosticDetails(summaryLogs[summaryLogs.length - 1]) : {};
  [
    ...(Array.isArray(latestSummary.requiredCommands) ? latestSummary.requiredCommands : []),
    ...(Array.isArray(latestSummary.failedCommands) ? latestSummary.failedCommands : [])
  ].forEach(appendSummaryReportCommand);
  commands = commands.sort((left, right) => {
    const leftIndex = Number(left?.i);
    const rightIndex = Number(right?.i);
    if (Number.isFinite(leftIndex) && Number.isFinite(rightIndex)) return leftIndex - rightIndex;
    if (Number.isFinite(leftIndex)) return -1;
    if (Number.isFinite(rightIndex)) return 1;
    return String(left?.k || '').localeCompare(String(right?.k || ''));
  });
  if (commands.length === 0) return '';

  const okCount = commands.filter((item) => item.s === 'ok').length;
  const timeoutCount = commands.filter((item) => item.s === 'timeout').length;
  const errorCount = commands.filter((item) => item.s === 'error').length;
  const pendingCount = commands.filter((item) => item.s === 'pending').length;
  const chunkCount = Math.max(1, Math.ceil(commands.length / RING_PROTOCOL_PROBE_REPORT_CHUNK_SIZE));
  const probeStartDetails = probeScope.startDetails;
  return Array.from({ length: chunkCount }, (_, index) => {
    const start = index * RING_PROTOCOL_PROBE_REPORT_CHUNK_SIZE;
    return formatMineDiagnosticLogEntry({
      id: Date.now() + index,
      time: formatMineDiagnosticTime(),
      source: 'RW MINE',
      event: 'diagnostic-probe-report',
      details: normalizeMineDiagnosticDetails({
        tag: RW_DIAGNOSTIC_BUILD_TAG,
        mode: probeStartDetails.mode || activeProtocolProbeMode.value || undefined,
        truncated: probeScope.truncated ? true : undefined,
        reason: probeScope.truncated ? 'protocol-probe-start-missing' : undefined,
        part: index + 1,
        parts: chunkCount,
        n: commands.length,
        ok: okCount,
        timeout: timeoutCount,
        error: errorCount,
        pending: pendingCount,
        commands: commands.slice(start, start + RING_PROTOCOL_PROBE_REPORT_CHUNK_SIZE)
      })
    });
  }).join('\n');
};
const getMineProtocolProbeCopyState = (logs: RingDiagnosticLogEntry[]) => {
  const probeScope = getMineProtocolProbeScopedLogs(logs);
  if (probeScope.logs.length === 0 && !protocolProbeBusy.value) return null;
  const probeLogs = probeScope.logs;
  const hasTerminal = probeLogs.some((entry) => entry.event === 'protocol-probe-summary' || entry.event === 'protocol-probe-failed');
  const started = probeLogs
    .filter((entry) => entry.event === 'protocol-probe-command-start')
    .map((entry) => {
      const details = parseMineDiagnosticDetails(entry);
      return {
        index: details.index,
        total: details.total,
        key: details.key,
        label: details.label,
        family: details.family,
        expected: details.expected
      };
    });
  const finishedKeys = new Set(
    probeLogs
      .filter((entry) =>
        ['protocol-probe-command-response', 'protocol-probe-command-write-ok', 'protocol-probe-command-timeout', 'protocol-probe-command-error'].includes(entry.event)
      )
      .map((entry) => {
        const details = parseMineDiagnosticDetails(entry);
        return `${details.index || ''}:${details.key || ''}`;
      })
  );
  const incomplete = started.filter((item) => !finishedKeys.has(`${item.index || ''}:${item.key || ''}`));
  if (!probeScope.truncated && !protocolProbeBusy.value && hasTerminal && incomplete.length === 0) return null;
  const startDetails = probeScope.startDetails;
  return {
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    reason: protocolProbeBusy.value
      ? 'protocol-probe-busy'
      : probeScope.truncated
        ? 'protocol-probe-start-missing'
        : 'protocol-probe-log-incomplete',
    protocolProbeBusy: protocolProbeBusy.value,
    activeProtocolProbe: activeProtocolProbeLabel.value || null,
    commandCount: startDetails.commandCount,
    requiredCommandCount: startDetails.requiredCommandCount,
    optionalCommandCount: startDetails.optionalCommandCount,
    startedCount: started.length,
    finishedCount: finishedKeys.size,
    truncated: probeScope.truncated,
    incomplete
  };
};
const formatMineDiagnosticCopyIncompleteWarning = (logs: RingDiagnosticLogEntry[]) => {
  const state = getMineProtocolProbeCopyState(logs);
  if (!state) return '';
  return formatMineDiagnosticLogEntry({
    id: Date.now(),
    time: formatMineDiagnosticTime(),
    source: 'RW MINE',
    event: 'diagnostic-copy-incomplete',
    details: normalizeMineDiagnosticDetails(state)
  });
};
const compactMineRwL19AcceptanceLogResult = (item: Record<string, any>) => {
  const result = item.result && typeof item.result === 'object' ? item.result : item;
  const summary = result.summary && typeof result.summary === 'object' ? result.summary : {};
  return Object.fromEntries(
    Object.entries({
      key: item.key,
      label: item.label,
      ok: item.ok === true || result.ok === true,
      elapsedMs: item.elapsedMs,
      value: result.value ?? item.value,
      recordCount: result.recordCount ?? summary.recordCount ?? item.recordCount,
      rawRecordCount: summary.rawRecordCount ?? item.rawRecordCount,
      submitRecordCount: summary.submitRecordCount ?? item.submitRecordCount,
      uploaded: summary.uploaded ?? result.uploaded ?? item.uploaded,
      requiredOkCount: result.requiredOkCount ?? item.requiredOkCount,
      requiredCommandCount: result.requiredCommandCount ?? item.requiredCommandCount,
      requiredFailedCount: result.requiredFailedCount ?? item.requiredFailedCount,
      message: trimMineDiagnosticText(result.message || item.message, 80)
    }).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
};
const formatMineRwL19AcceptanceCompactReport = (logs: RingDiagnosticLogEntry[]) => {
  const acceptanceLogs = logs.filter((entry) => entry.source === 'RW MINE' && entry.event.startsWith('rw-l19-acceptance-'));
  if (acceptanceLogs.length === 0 && !mineRwAcceptanceBusy.value) return '';
  const latestSummary = [...acceptanceLogs].reverse().find((entry) => entry.event === 'rw-l19-acceptance-summary');
  const latestStart = [...acceptanceLogs].reverse().find((entry) => entry.event === 'rw-l19-acceptance-start');
  const summary = latestSummary ? parseMineDiagnosticDetails(latestSummary) : {};
  const stepRows = acceptanceLogs
    .filter((entry) => entry.event === 'rw-l19-acceptance-step-result' || entry.event === 'rw-l19-acceptance-step-failed')
    .map((entry) => compactMineRwL19AcceptanceLogResult(parseMineDiagnosticDetails(entry)))
    .filter((item) => item.key);
  const results = (Array.isArray(summary.results) ? summary.results : stepRows).map((item) =>
    compactMineRwL19AcceptanceLogResult(item as Record<string, any>)
  );
  const failed = (Array.isArray(summary.failed) ? summary.failed : results.filter((item) => item.ok !== true)).map((item) =>
    compactMineRwL19AcceptanceLogResult(item as Record<string, any>)
  );
  const resultKeys = new Set(results.map((item) => String(item.key || '')).filter(Boolean));
  const missing = MINE_RW_L19_ACCEPTANCE_EXPECTED_KEYS.filter((key) => !resultKeys.has(key));
  const okCount = toMineDiagnosticCount(summary.okCount, results.filter((item) => item.ok === true).length) || 0;
  const failedCount = toMineDiagnosticCount(summary.failedCount, failed.length) || 0;
  const status = mineRwAcceptanceBusy.value
    ? 'running'
    : latestSummary && failedCount === 0 && missing.length === 0 && okCount >= MINE_RW_L19_ACCEPTANCE_EXPECTED_KEYS.length
      ? 'pass'
      : latestSummary
        ? 'fail'
        : 'incomplete';

  return formatMineDiagnosticLogEntry({
    id: Date.now(),
    time: formatMineDiagnosticTime(),
    source: 'RW MINE',
    event: 'diagnostic-acceptance-report',
    details: normalizeMineDiagnosticDetails({
      buildTag: RW_DIAGNOSTIC_BUILD_TAG,
      status,
      busy: mineRwAcceptanceBusy.value || undefined,
      activeStep: activeMineRwAcceptanceStep.value || undefined,
      started: latestStart ? true : undefined,
      summarized: latestSummary ? true : undefined,
      okCount,
      failedCount,
      stepCount: toMineDiagnosticCount(summary.stepCount, results.length, MINE_RW_L19_ACCEPTANCE_EXPECTED_KEYS.length),
      missing,
      failed,
      results
    })
  });
};
const summarizeMineHistoryResult = (result: Record<string, any> | null | undefined) =>
  result
    ? {
        status: result.status,
        recordCount: Array.isArray(result.records) ? result.records.length : result.recordCount,
        totalFileCount: result.totalFileCount ?? result.parsed?.totalFileCount,
        selectedFileCount: result.selectedFileCount ?? result.parsed?.selectedFileCount,
        filteredFileCount: result.filteredFileCount ?? result.parsed?.filteredFileCount,
        dataTypes: result.dataTypes ?? result.parsed?.dataTypes,
        uploaded: result.uploaded,
        deleted: result.deleted
      }
    : null;
const sleepMineProtocolProbe = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isMineBusinessRefreshBusy = () =>
  controller.isBusinessRequestInFlight() ||
  controller.isRefreshingBusinessData.value ||
  controller.isSyncingHistory.value ||
  controller.isRestoringDevice.value;
const waitForMineBusinessRefreshIdle = async (timeoutMs: number, quietMs: number) => {
  const startedAt = Date.now();
  let idleSince = isMineBusinessRefreshBusy() ? 0 : Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isMineBusinessRefreshBusy()) {
      if (!idleSince) idleSince = Date.now();
      if (Date.now() - idleSince >= quietMs) return true;
    } else {
      idleSince = 0;
    }
    await sleepMineProtocolProbe(100);
  }
  return !isMineBusinessRefreshBusy();
};
const getMineTodayStartSeconds = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor(now.getTime() / 1000);
};
const summarizeMineParsedData = (parsed: RingParsedData | null | undefined) => {
  if (!parsed) return null;
  const item = parsed as Record<string, any>;
  const rawHex = Array.isArray(parsed.raw)
    ? parsed.raw.map((value) => Number(value || 0).toString(16).padStart(2, '0')).join('')
    : undefined;
  const records = Array.isArray(item.records) ? item.records : [];
  const rawDataTypes = Array.from(
    new Set(
      records
        .map((record: Record<string, any>) => getMineDiagnosticRecordValue(record, ['rawDataType', 'fileType', 'sourceType']))
        .filter((value) => value !== undefined && value !== null && value !== '')
        .map((value) => String(value))
    )
  );
  return {
    type: parsed.type,
    name: item.name,
    key: item.key,
    flag: item.flag,
    status: item.status,
    statusCode: item.statusCode,
    value: item.value,
    battery: item.battery,
    heartRate: item.heartRate,
    bloodOxygen: item.bloodOxygen,
    stepCount: item.stepCount ?? item.step,
    sleepState: item.sleepState,
    sleepStatus: item.sleepStatus,
    durationMinutes: item.durationMinutes,
    firmwareVersion: item.firmwareVersion,
    hardwareVersion: item.hardwareVersion,
    softwareVersion: item.softwareVersion,
    uiVersion: item.uiVersion,
    packetShape: item.packetShape,
    qkeerCommand: item.qkeerCommand,
    dataType: item.dataType,
    recordCount: records.length || item.totalNum,
    rawDataTypes: rawDataTypes.length > 0 ? rawDataTypes : undefined,
    recordSample: compactMineHistoryRecordSample(records, 4),
    rawHex
  };
};
const mineErrorToString = (error: unknown) => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const record = error as Record<string, any>;
  return `${record?.errMsg || record?.message || error || ''}`.trim();
};
const isMineParsedType = (parsed: RingParsedData, types: string[]) => types.includes(parsed.type);
const hasMineVersionValue = (...values: unknown[]) => values.some((value) => value != null && String(value).trim() !== '' && String(value).trim() !== '-');
const isMineFirmwareSoftwareParsed = (parsed: RingParsedData) => {
  if (!isMineParsedType(parsed, ['firmware_version', 'hardwareVersion', 'softwareVersion'])) return false;
  const item = parsed as Record<string, any>;
  const hasFirmware = hasMineVersionValue(item.firmwareVersion, item.hardwareVersion, parsed.type === 'hardwareVersion' ? item.value : undefined);
  const hasSoftware = hasMineVersionValue(item.softwareVersion, item.uiVersion, parsed.type === 'softwareVersion' ? item.value : undefined);
  return hasFirmware && hasSoftware;
};
const isMineHealthDataParsed = (name: string) => (parsed: RingParsedData) => {
  const item = parsed as Record<string, any>;
  return ['rw_health_data', 'rw_health_data_ack'].includes(parsed.type) && item.name === name;
};
const getMineParsedKey = (parsed: RingParsedData) => {
  const item = parsed as Record<string, any>;
  const key = Number(item.key);
  return Number.isFinite(key) ? key : null;
};
const isMineHealthDataKeyParsed = (name: string, key: RwKey) => (parsed: RingParsedData) => {
  return isMineHealthDataParsed(name)(parsed) && getMineParsedKey(parsed) === key;
};
const getMineParsedFlag = (parsed: RingParsedData) => {
  const item = parsed as Record<string, any>;
  const flag = Number(item.flag);
  return Number.isFinite(flag) ? flag : null;
};
const isMineRwReadFlag = (flag: number | null) => flag === 0x10 || flag === 0x11;
const isMineAppRealtimeHealthKey = (key: number | null) => {
  return (
    key === RwKey.AppRealTimeHeartRate ||
    key === RwKey.AppRealTimeBloodPressure ||
    key === RwKey.AppRealTimeTemperature ||
    key === RwKey.AppRealTimeBloodOxygen ||
    key === RwKey.AppRealTimeStress ||
    key === RwKey.AppRealTimeHrv ||
    key === RwKey.AppRealTimeBloodSugar
  );
};
const isMineHealthDataKeyFlagParsed = (name: string, key: RwKey, flag: RwKeyFlag) => (parsed: RingParsedData) => {
  return isMineHealthDataKeyParsed(name, key)(parsed) && getMineParsedFlag(parsed) === flag;
};
const isMineRealtimeHealthDataParsed = (name: RwForegroundMetric, expectedKey: RwKey) => (parsed: RingParsedData) => {
  const item = parsed as Record<string, any>;
  const key = getMineParsedKey(parsed);
  const flag = getMineParsedFlag(parsed);
  return (
    parsed.type === 'rw_health_data' &&
    item.name === name &&
    key === expectedKey &&
    (isMineRwReadFlag(flag) || isMineAppRealtimeHealthKey(key)) &&
    getRwForegroundMetricValue(name, item) != null
  );
};
const isMineMonitoringParsed = (name: string) => (parsed: RingParsedData) => {
  const item = parsed as Record<string, any>;
  return ['rw_health_monitoring', 'rw_health_monitoring_ack'].includes(parsed.type) && item.name === name;
};
const isMineMonitoringKeyParsed = (name: string, key: RwKey) => (parsed: RingParsedData) => {
  return isMineMonitoringParsed(name)(parsed) && getMineParsedKey(parsed) === key;
};
const isMineGenericHealthControlAck = (item: Record<string, any>) => {
  const name = `${item.name || ''}`.trim().toLowerCase();
  const key = Number(item.key);
  return (
    key === RwKey.AppDataControl &&
    (!name || name === 'unknown') &&
    (item.status === 'success' || item.success === true || Number(item.statusCode) === 0 || Number(item.value) === 0)
  );
};
const isMineHealthControlParsed = (name: string, enabled?: boolean, options: { acceptGenericAck?: boolean } = {}) => (parsed: RingParsedData) => {
  const item = parsed as Record<string, any>;
  const expectedAction = enabled === undefined ? undefined : enabled ? 1 : 0;
  if (parsed.type !== 'rw_health_data_control_ack') return false;
  const actionMatches =
    expectedAction === undefined || item.controlAction === undefined || Number(item.controlAction) === expectedAction;
  return (
    (item.name === name && actionMatches) ||
    (options.acceptGenericAck === true && actionMatches && isMineGenericHealthControlAck(item))
  );
};
const getMineProtocolProbeFamily = (key: string) => {
  if (key.startsWith('battery/') || key.startsWith('firmware/')) return 'ab-core';
  if (key === 'time/read' || key === 'collect-period/read') return 'legacy-config';
  if (key.startsWith('temperature/')) return 'temperature-single';
  if (key.startsWith('monitoring/')) return 'ab-monitoring';
  if (key.startsWith('history-key/')) return 'ab-history-key';
  if (key.includes('/realtime-') || key.includes('/control-')) return 'ab-realtime';
  if (key === 'history/local-incremental' || key === 'history/file-list') return 'legacy-history';
  if (key.startsWith('history/qkeer-v2-')) return 'qkeer-v2-history';
  return key.split('/')[0] || 'unknown';
};
const mineUnverifiedRealtimeProbeMetrics: MineRealtimeProbeMetric[] = [
  {
    keyPrefix: 'hrv',
    name: 'hrv',
    label: 'HRV',
    controlKey: RwHealthDataControlKey.Hrv,
    realtimeKey: RwKey.AppRealTimeHrv,
    readableKey: RwKey.Hrv
  },
  {
    keyPrefix: 'stress',
    name: 'stress',
    label: '\u538b\u529b',
    controlKey: RwHealthDataControlKey.Stress,
    realtimeKey: RwKey.AppRealTimeStress,
    readableKey: RwKey.Stress
  },
  {
    keyPrefix: 'blood-pressure',
    name: 'blood_pressure',
    label: '\u8840\u538b',
    controlKey: RwHealthDataControlKey.BloodPressure,
    realtimeKey: RwKey.AppRealTimeBloodPressure,
    readableKey: RwKey.BloodPressure
  },
  {
    keyPrefix: 'blood-sugar',
    name: 'blood_sugar',
    label: '\u8840\u7cd6',
    controlKey: RwHealthDataControlKey.BloodSugar,
    realtimeKey: RwKey.AppRealTimeBloodSugar,
    readableKey: RwKey.BloodSugar
  }
];
const mineProtocolProbeCoreRequiredKeys = new Set([
  'history-key/activity-current-day/read',
  'history-key/activity/read',
  'history-key/sleep/read',
  'monitoring/temperature/read',
  'monitoring/temperature-detecting/write',
  'history-key/temperature/read'
]);
const getMineProtocolProbeDefaultRequired = (key: string) => mineProtocolProbeCoreRequiredKeys.has(key);
const mineProtocolProbeRequiredOrder = [
  'history-key/activity-current-day/read',
  'history-key/activity/read',
  'history-key/sleep/read',
  'monitoring/temperature/read',
  'monitoring/temperature-detecting/write',
  'history-key/temperature/read'
];
const mineTemperatureProtocolProbeKeys = new Set([
  'monitoring/temperature/read',
  'monitoring/temperature-detecting/write',
  'history-key/temperature/read',
  'history-key/temperature/read-no-crc'
]);
const mineTemperatureProtocolProbeRequiredKeys = new Set([
  'monitoring/temperature/read',
  'monitoring/temperature-detecting/write',
  'history-key/temperature/read'
]);
const mineTemperatureProtocolProbeOrder = [
  'monitoring/temperature/read',
  'monitoring/temperature-detecting/write',
  'history-key/temperature/read',
  'history-key/temperature/read-no-crc'
];
const mineStressMonitoringProtocolProbeKeys = new Set([
  'monitoring/hrv/write',
  'monitoring/hrv/read',
  'monitoring/stress/write',
  'monitoring/stress/read'
]);
const mineStressMonitoringProtocolProbeOrder = [
  'monitoring/hrv/write',
  'monitoring/hrv/read',
  'monitoring/stress/write',
  'monitoring/stress/read'
];
const mineHeartRateRealtimeProtocolProbeKeys = new Set([
  'heart-rate/control-enable',
  'heart-rate/app-realtime-read',
  'heart-rate/control-disable'
]);
const mineHeartRateRealtimeProtocolProbeOrder = [
  'heart-rate/control-enable',
  'heart-rate/app-realtime-read',
  'heart-rate/control-disable'
];
const mineBloodOxygenRealtimeProtocolProbeKeys = new Set([
  'blood-oxygen/control-enable',
  'blood-oxygen/app-realtime-read',
  'blood-oxygen/control-disable'
]);
const mineBloodOxygenRealtimeProtocolProbeOrder = [
  'blood-oxygen/control-enable',
  'blood-oxygen/app-realtime-read',
  'blood-oxygen/control-disable'
];
const mineHrvRealtimeProtocolProbeKeys = new Set([
  'hrv/control-enable',
  'hrv/app-realtime-read',
  'hrv/control-disable'
]);
const mineHrvRealtimeProtocolProbeOrder = [
  'hrv/control-enable',
  'hrv/app-realtime-read',
  'hrv/control-disable'
];
const mineSingleProtocolProbeKeyByMode: Partial<Record<MineProtocolProbeMode, string>> = {
  temperatureMonitoring: 'monitoring/temperature/read',
  temperatureDetecting: 'monitoring/temperature-detecting/write',
  temperatureDetectingPlain: 'monitoring/temperature-detecting/plain-write',
  temperatureDetectingShort: 'monitoring/temperature-detecting/sdk-short-write',
  temperatureDetectingNoCrc: 'monitoring/temperature-detecting/sdk-no-crc-write',
  temperatureRealtimeRead: 'temperature/app-realtime-read',
  temperatureRealtimeControlEnable: 'temperature/control-enable',
  temperatureRealtimeControlDisable: 'temperature/control-disable',
  temperatureHistory: 'history-key/temperature/read',
  stepCurrentDay: 'history-key/activity-current-day/read',
  stepCurrentDayC6: 'history-key/activity-current-day/c6-doc-read',
  sleepActivityCurrentDay: 'history-key/activity-current-day/read',
  activityHistory: 'history-key/activity/read',
  sleepHistory: 'history-key/sleep/read',
  sleepNativeDetail: 'history/qkeer-v2-sleep-detail',
  sleepNativeList: 'history/qkeer-v2-sleep-list',
  sleepEnhanceRead: 'history/qkeer-v2-enhance-sleep-read',
  sleepContinueHistory: 'history-key/sleep/read-continue',
  rawSleepHistory: 'history-key/raw-sleep/read',
  sleepDelete: 'history-key/sleep/delete'
};
const mineProtocolProbeSingleOnlyKeys = new Set([
  'monitoring/temperature-detecting/plain-write',
  'monitoring/temperature-detecting/sdk-short-write',
  'monitoring/temperature-detecting/sdk-no-crc-write'
]);
const MINE_PROTOCOL_PROBE_SDK_RETRY_POLL_AT_MS = [0, 5000, 10000] as const;
const MINE_PROTOCOL_PROBE_SDK_RETRY_TIMEOUT_MS = 16000;
const MINE_PROTOCOL_PROBE_SDK_RETRY_RESPONSE_GRACE_MS = 300;
const mineSdkRetryProtocolProbeKeys = new Set([
  'monitoring/temperature/read',
  'monitoring/temperature-detecting/write',
  'monitoring/temperature-detecting/plain-write',
  'monitoring/temperature-detecting/sdk-short-write',
  'monitoring/temperature-detecting/sdk-no-crc-write',
  'history-key/temperature/read'
]);
const mineStepSleepProtocolProbeKeys = new Set([
  'history-key/activity-current-day/read',
  'history-key/activity/read',
  'history-key/sleep/read'
]);
const mineStepSleepProtocolProbeOrder = [
  'history-key/activity-current-day/read',
  'history-key/activity/read',
  'history-key/sleep/read'
];
const mineSleepSdkProtocolProbeKeys = new Set([
  'history-key/sleep/sdk-read'
]);
const mineSleepSdkProtocolProbeOrder = [
  'history-key/sleep/sdk-read'
];
const normalizeMineProtocolProbeCommand = (command: MineProtocolProbeCommand): MineProtocolProbeCommand => ({
  ...command,
  required: command.required ?? getMineProtocolProbeDefaultRequired(command.key)
});
const withMineSdkRetryProbeCommand = <T extends MineProtocolProbeCommand>(command: T): T => {
  if (!mineSdkRetryProtocolProbeKeys.has(command.key)) return command;
  return {
    ...command,
    timeoutMs: Math.max(command.timeoutMs ?? 0, MINE_PROTOCOL_PROBE_SDK_RETRY_TIMEOUT_MS),
    pollAtMs: MINE_PROTOCOL_PROBE_SDK_RETRY_POLL_AT_MS,
    pollResponseGraceMs: MINE_PROTOCOL_PROBE_SDK_RETRY_RESPONSE_GRACE_MS
  };
};
const buildMineTemperatureDetectingPayload = (flags: number, duration: number) =>
  new Uint8Array([
    RwKey.TemperatureDetecting >> 8,
    RwKey.TemperatureDetecting & 0xff,
    0x00,
    flags & 0xff,
    0x00,
    0x00,
    0x17,
    0x3b,
    duration & 0xff
  ]);
const getMineProtocolProbeSortOrder = (command: MineProtocolProbeCommand) => {
  const requiredIndex = mineProtocolProbeRequiredOrder.indexOf(command.key);
  if (requiredIndex >= 0) return requiredIndex;
  return command.required === false ? 200 : 100;
};
const getMineTemperatureProtocolProbeSortOrder = (command: MineProtocolProbeCommand) => {
  const requiredIndex = mineTemperatureProtocolProbeOrder.indexOf(command.key);
  if (requiredIndex >= 0) return requiredIndex;
  return 200;
};
const getMineStepSleepProtocolProbeSortOrder = (command: MineProtocolProbeCommand) => {
  const requiredIndex = mineStepSleepProtocolProbeOrder.indexOf(command.key);
  if (requiredIndex >= 0) return requiredIndex;
  return 200;
};
const getMineSleepSdkProtocolProbeSortOrder = (command: MineProtocolProbeCommand) => {
  const requiredIndex = mineSleepSdkProtocolProbeOrder.indexOf(command.key);
  if (requiredIndex >= 0) return requiredIndex;
  return 200;
};
const getMineHeartRateRealtimeProtocolProbeSortOrder = (command: MineProtocolProbeCommand) => {
  const requiredIndex = mineHeartRateRealtimeProtocolProbeOrder.indexOf(command.key);
  if (requiredIndex >= 0) return requiredIndex;
  return 200;
};
const getMineBloodOxygenRealtimeProtocolProbeSortOrder = (command: MineProtocolProbeCommand) => {
  const requiredIndex = mineBloodOxygenRealtimeProtocolProbeOrder.indexOf(command.key);
  if (requiredIndex >= 0) return requiredIndex;
  return 200;
};
const getMineHrvRealtimeProtocolProbeSortOrder = (command: MineProtocolProbeCommand) => {
  const requiredIndex = mineHrvRealtimeProtocolProbeOrder.indexOf(command.key);
  if (requiredIndex >= 0) return requiredIndex;
  return 200;
};
const summarizeMineProtocolProbeGroups = (items: MineProtocolProbeSummaryItem[]) => {
  const groups: Record<string, { total: number; required: number; optional: number; ok: number; failed: number; timeout: number }> = {};
  items.forEach((item) => {
    const family = item.family || getMineProtocolProbeFamily(item.key);
    const group = groups[family] || { total: 0, required: 0, optional: 0, ok: 0, failed: 0, timeout: 0 };
    group.total += 1;
    if (item.required) group.required += 1;
    else group.optional += 1;
    if (item.ok === true) group.ok += 1;
    if (item.ok === false) group.failed += 1;
    if (item.timeout === true) group.timeout += 1;
    groups[family] = group;
  });
  return groups;
};
const summarizeMineProtocolProbeCommandPlan = (commands: MineProtocolProbeCommand[]) => {
  const items: MineProtocolProbeSummaryItem[] = commands.map((command, index) => ({
    index: index + 1,
    key: command.key,
    label: command.label,
    family: command.family || getMineProtocolProbeFamily(command.key),
    required: command.required !== false,
    expected: command.expected,
    timeoutMs: command.timeoutMs ?? 10000
  }));
  return {
    required: items.filter((item) => item.required),
    optional: items.filter((item) => !item.required),
    families: summarizeMineProtocolProbeGroups(items)
  };
};
const createMineProtocolProbeCommands = (mode: MineProtocolProbeMode = 'full'): MineProtocolProbeCommand[] => {
  const startTimestamp = getMineTodayStartSeconds();
  const endTimestamp = Math.floor(Date.now() / 1000);
  const commands: MineProtocolProbeCommand[] = [
    {
      key: 'time/read',
      label: '\u8bfb\u53d6\u8bbe\u5907\u65f6\u95f4',
      expected: 'device_time/rw_time_ack',
      build: () => buildRwReadTimeCommand(),
      predicate: (parsed) => isMineParsedType(parsed, ['device_time', 'rw_time_ack']),
      timeoutMs: 8000
    },
    {
      key: 'battery/read',
      label: '\u8bfb\u53d6\u7535\u91cf(CRC)',
      expected: 'battery via app-sdk-ab-crc-read',
      build: () => buildRwReadKeyCommand(RwKey.Battery),
      predicate: (parsed) => parsed.type === 'battery',
      timeoutMs: 8000
    },
    {
      key: 'battery/read-no-crc',
      label: '\u8bfb\u53d6\u7535\u91cf(\u77ed\u547d\u4ee4)',
      expected: 'battery via ab-no-crc',
      build: () => buildRwReadBatteryCommand(),
      predicate: (parsed) => parsed.type === 'battery',
      required: false,
      timeoutMs: 8000
    },
    {
      key: 'firmware/read',
      label: '\u8bfb\u53d6\u56fa\u4ef6/\u8f6f\u4ef6\u7248\u672c(CRC)',
      expected: 'firmware_version with firmwareVersion/softwareVersion via app-sdk-ab-crc-read',
      build: () => buildRwReadKeyCommand(RwKey.FirmwareVersion),
      predicate: isMineFirmwareSoftwareParsed,
      timeoutMs: 8000
    },
    {
      key: 'firmware/read-no-crc',
      label: '\u8bfb\u53d6\u56fa\u4ef6/\u8f6f\u4ef6\u7248\u672c(\u77ed\u547d\u4ee4)',
      expected: 'firmware_version with firmwareVersion/softwareVersion via ab-no-crc',
      build: () => buildRwReadFirmwareVersionCommand(),
      predicate: isMineFirmwareSoftwareParsed,
      required: false,
      timeoutMs: 8000
    },
    {
      key: 'collect-period/read',
      label: '\u8bfb\u53d6\u91c7\u96c6\u9891\u7387',
      expected: 'collect_period_read',
      build: () => buildRwFrame(0x37, 0x01),
      predicate: (parsed) => parsed.type === 'collect_period_read',
      timeoutMs: 8000
    },
    {
      key: 'monitoring/heart-rate/read',
      label: '\u8bfb\u53d6\u5fc3\u7387\u76d1\u6d4b\u914d\u7f6e',
      expected: 'rw_health_monitoring:heart_rate',
      build: () => buildRwReadHealthMonitoringCommand(RwKey.HrMonitoring),
      predicate: isMineMonitoringParsed('heart_rate'),
      timeoutMs: 8000
    },
    {
      key: 'monitoring/blood-oxygen/read',
      label: '\u8bfb\u53d6\u8840\u6c27\u76d1\u6d4b\u914d\u7f6e',
      expected: 'rw_health_monitoring:blood_oxygen',
      build: () => buildRwReadHealthMonitoringCommand(RwKey.Spo2Monitoring),
      predicate: isMineMonitoringParsed('blood_oxygen'),
      timeoutMs: 8000
    },
    {
      key: 'monitoring/temperature/read',
      label: '\u8bfb\u53d6\u4f53\u6e29\u76d1\u6d4b\u914d\u7f6e',
      expected: 'rw_health_monitoring:temperature',
      build: () => buildRwReadHealthMonitoringCommand(RwKey.TemperatureMonitoring),
      predicate: isMineMonitoringKeyParsed('temperature', RwKey.TemperatureMonitoring),
      timeoutMs: 8000
    },
    {
      key: 'monitoring/temperature-detecting/write',
      label: '\u5f00\u542f\u4f53\u6e29\u68c0\u6d4b(0x021b)',
      expected: 'rw_health_monitoring_ack:temperature via BLE_KEY_TEMPERATURE_DETECTING',
      build: () =>
        buildRwSetBodyTemperatureDetectingCommand({
          enabled: true,
          startHour: 0,
          startMinute: 0,
          endHour: 23,
          endMinute: 59,
          duration: 60
        }),
      predicate: isMineMonitoringKeyParsed('temperature', RwKey.TemperatureDetecting),
      timeoutMs: 8000
    },
    {
      key: 'monitoring/temperature-detecting/plain-write',
      label: '\u5f00\u542f\u4f53\u6e29\u68c0\u6d4b01(0x021b)',
      expected: 'rw_health_monitoring_ack:temperature via BLE_KEY_TEMPERATURE_DETECTING plain enabled=0x01',
      build: () => buildRwKeyCommand(buildMineTemperatureDetectingPayload(0x01, 60)),
      predicate: isMineMonitoringKeyParsed('temperature', RwKey.TemperatureDetecting),
      required: false,
      timeoutMs: 8000
    },
    {
      key: 'monitoring/temperature-detecting/sdk-short-write',
      label: '\u5f00\u542f\u4f53\u6e29\u68c0\u6d4b5\u5206(0x021b)',
      expected: 'rw_health_monitoring_ack:temperature via BLE_KEY_TEMPERATURE_DETECTING sdk flags=0xff duration=5',
      build: () =>
        buildRwSetBodyTemperatureDetectingCommand({
          enabled: true,
          startHour: 0,
          startMinute: 0,
          endHour: 23,
          endMinute: 59,
          duration: 5
        }),
      predicate: isMineMonitoringKeyParsed('temperature', RwKey.TemperatureDetecting),
      required: false,
      timeoutMs: 8000
    },
    {
      key: 'monitoring/temperature-detecting/sdk-no-crc-write',
      label: '\u5f00\u542f\u4f53\u6e29\u68c0\u6d4b\u77ed\u5e27(0x021b)',
      expected: 'rw_health_monitoring_ack:temperature via BLE_KEY_TEMPERATURE_DETECTING sdk payload without CRC',
      build: () => buildRwKeyCommandWithoutChecksum(buildMineTemperatureDetectingPayload(0xff, 60)),
      predicate: isMineMonitoringKeyParsed('temperature', RwKey.TemperatureDetecting),
      required: false,
      timeoutMs: 8000
    },
    {
      key: 'temperature/control-enable',
      label: '\u4f53\u6e29\u5b9e\u65f6\u5f00\u542f(0x0609/0x08)',
      expected: 'rw_health_data_control_ack:temperature enable',
      build: () => buildRwControlHealthDataCommand(RwHealthDataControlKey.Temperature, true),
      predicate: isMineHealthControlParsed('temperature', true, { acceptGenericAck: true }),
      required: false,
      timeoutMs: 8000,
      delayAfterMs: 500
    },
    {
      key: 'temperature/app-realtime-read',
      label: '\u4f53\u6e29APP\u5b9e\u65f6\u8bfb\u53d6(0x0230 CRC)',
      expected: 'rw_health_data:temperature key=0x0230 via app-sdk-ab-crc-read',
      build: () => buildRwReadKeyCommand(RwKey.AppRealTimeTemperature),
      predicate: isMineRealtimeHealthDataParsed('temperature', RwKey.AppRealTimeTemperature),
      required: false,
      timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
      pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
      pollResponseGraceMs: 250
    },
    {
      key: 'temperature/app-realtime-read-no-crc',
      label: '\u4f53\u6e29APP\u5b9e\u65f6\u8bfb\u53d6(0x0230\u77ed\u547d\u4ee4)',
      expected: 'rw_health_data:temperature key=0x0230 via ab-no-crc',
      build: () => buildRwReadKeyCommandWithoutChecksum(RwKey.AppRealTimeTemperature),
      predicate: isMineRealtimeHealthDataParsed('temperature', RwKey.AppRealTimeTemperature),
      required: false,
      timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
      pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
      pollResponseGraceMs: 250
    },
    {
      key: 'temperature/c6-realtime-read',
      label: '\u4f53\u6e29C6\u7b49\u4ef7\u8bfb\u53d6(0x0230 CRC)',
      expected: 'rw_health_data:temperature key=0x0230 via c6-equivalent-crc-read',
      build: () => hexToBytes('c60100030cb4023010'),
      predicate: isMineRealtimeHealthDataParsed('temperature', RwKey.AppRealTimeTemperature),
      required: false,
      timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
      pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
      pollResponseGraceMs: 250
    },
    {
      key: 'temperature/c6-realtime-read-no-crc',
      label: '\u4f53\u6e29C6\u7b49\u4ef7\u8bfb\u53d6(0x0230\u77ed\u547d\u4ee4)',
      expected: 'rw_health_data:temperature key=0x0230 via c6-no-crc-read',
      build: () => hexToBytes('c6010003023010'),
      predicate: isMineRealtimeHealthDataParsed('temperature', RwKey.AppRealTimeTemperature),
      required: false,
      timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
      pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
      pollResponseGraceMs: 250
    },
    {
      key: 'monitoring/hrv/write',
      label: '\u5f00\u542fHRV\u76d1\u6d4b(0x026A)',
      expected: 'rw_health_monitoring_ack:hrv enabled interval=5',
      build: () =>
        buildRwSetHealthMonitoringCommand(RwKey.HrvMonitoring, {
          enabled: true,
          startHour: 0,
          startMinute: 0,
          endHour: 23,
          endMinute: 59,
          interval: 5
        }),
      predicate: isMineMonitoringKeyParsed('hrv', RwKey.HrvMonitoring),
      timeoutMs: 8000,
      delayAfterMs: 500
    },
    {
      key: 'monitoring/hrv/read',
      label: '\u8bfb\u53d6HRV\u76d1\u6d4b\u914d\u7f6e',
      expected: 'rw_health_monitoring:hrv',
      build: () => buildRwReadHealthMonitoringCommand(RwKey.HrvMonitoring),
      predicate: isMineMonitoringParsed('hrv'),
      timeoutMs: 8000
    },
    {
      key: 'monitoring/stress/read',
      label: '\u8bfb\u53d6\u538b\u529b\u76d1\u6d4b\u914d\u7f6e',
      expected: 'rw_health_monitoring:stress',
      build: () => buildRwReadHealthMonitoringCommand(RwKey.StressMonitoring),
      predicate: isMineMonitoringParsed('stress'),
      timeoutMs: 8000
    },
    {
      key: 'monitoring/stress/write',
      label: '\u5f00\u542f\u538b\u529b\u76d1\u6d4b(0x026B)',
      expected: 'rw_health_monitoring_ack:stress enabled interval=5',
      build: () =>
        buildRwSetHealthMonitoringCommand(RwKey.StressMonitoring, {
          enabled: true,
          startHour: 0,
          startMinute: 0,
          endHour: 23,
          endMinute: 59,
          interval: 5
        }),
      predicate: isMineMonitoringKeyParsed('stress', RwKey.StressMonitoring),
      timeoutMs: 8000,
      delayAfterMs: 500
    },
    {
      key: 'monitoring/blood-sugar/read',
      label: '\u8bfb\u53d6\u8840\u7cd6\u76d1\u6d4b\u914d\u7f6e',
      expected: 'rw_health_monitoring:blood_sugar',
      build: () => buildRwReadHealthMonitoringCommand(RwKey.BloodSugarMonitoring),
      predicate: isMineMonitoringParsed('blood_sugar'),
      timeoutMs: 8000
    },
    {
      key: 'monitoring/blood-pressure/read',
      label: '\u8bfb\u53d6\u8840\u538b\u76d1\u6d4b\u914d\u7f6e',
      expected: 'rw_health_monitoring:blood_pressure',
      build: () => buildRwReadHealthMonitoringCommand(RwKey.BloodPressureMonitoring),
      predicate: isMineMonitoringParsed('blood_pressure'),
      timeoutMs: 8000
    },
    {
      key: 'history-key/activity-current-day/read',
      label: '\u8bfb\u53d6\u5f53\u5929\u6b65\u6570',
      expected: 'rw_health_data:step/rw_health_data_ack:step key=0x051a',
      build: () => buildRwReadHealthDataCommand(RwKey.ActivityCurrentDay),
      predicate: isMineHealthDataKeyParsed('step', RwKey.ActivityCurrentDay),
      timeoutMs: 8000
    },
    {
      key: 'history-key/activity-current-day/c6-doc-read',
      label: '\u8bfb\u53d6\u5f53\u5929\u6b65\u6570(C6\u6587\u6863\u5e27)',
      family: 'c6-history-key',
      expected: 'rw_health_data:step/rw_health_data_ack:step key=0x051a via c6 doc frame',
      build: () => hexToBytes('c60100034e15051a10'),
      predicate: isMineHealthDataKeyParsed('step', RwKey.ActivityCurrentDay),
      required: false,
      timeoutMs: 8000
    },
    {
      key: 'history-key/activity/read',
      label: '\u8bfb\u53d6\u6d3b\u52a8\u5386\u53f2',
      expected: 'rw_health_data:step/rw_health_data_ack:step key=0x0502',
      build: () => buildRwReadHealthDataCommand(RwKey.Activity),
      predicate: isMineHealthDataKeyParsed('step', RwKey.Activity),
      timeoutMs: 8000
    },
    {
      key: 'history-key/sleep/read',
      label: '\u8bfb\u53d6\u7761\u7720\u5386\u53f2',
      expected: 'rw_health_data:sleep/rw_health_data_ack:sleep key=0x0505',
      build: () => buildRwReadHealthDataCommand(RwKey.Sleep),
      predicate: isMineHealthDataKeyParsed('sleep', RwKey.Sleep),
      timeoutMs: 8000
    },
    {
      key: 'history-key/sleep/sdk-read',
      label: '\u7761\u7720SDK\u8bfb\u53d6(0x0505)',
      family: 'ab-history-key-sdk-sleep',
      expected: 'SDK step1 only, rw_health_data:sleep/rw_health_data_ack:sleep key=0x0505 flag=0x10',
      build: () => buildRwReadHealthDataCommand(RwKey.Sleep),
      predicate: isMineHealthDataKeyFlagParsed('sleep', RwKey.Sleep, RwKeyFlag.Read),
      required: true,
      timeoutMs: 8000
    },
    {
      key: 'history-key/sleep/delete',
      label: '\u6e05\u7a7a\u7761\u7720\u5386\u53f2(0x0505)',
      expected: 'rw_health_data_ack:sleep key=0x0505 flag=0x30 via PDF delete command 050530',
      build: () => buildRwDeleteHealthDataCommand(RwKey.Sleep),
      predicate: isMineHealthDataKeyFlagParsed('sleep', RwKey.Sleep, RwKeyFlag.Delete),
      required: true,
      timeoutMs: 8000
    },
    {
      key: 'history-key/raw-sleep/read',
      label: '\u8bfb\u53d6\u539f\u59cb\u7761\u7720\u5386\u53f2',
      expected: 'rw_health_data:sleep/rw_health_data_ack:sleep key=0x02fe',
      build: () => buildRwReadHealthDataCommand(RwKey.RawSleep),
      predicate: isMineHealthDataKeyParsed('sleep', RwKey.RawSleep),
      required: false,
      timeoutMs: 8000
    },
    {
      key: 'history-key/heart-rate/read',
      label: '\u8bfb\u53d6\u5fc3\u7387\u5386\u53f2',
      expected: 'rw_health_data:heart_rate/rw_health_data_ack:heart_rate',
      build: () => buildRwReadHealthDataCommand(RwKey.HeartRate),
      predicate: isMineHealthDataParsed('heart_rate'),
      timeoutMs: 8000
    },
    {
      key: 'history-key/blood-oxygen/read',
      label: '\u8bfb\u53d6\u8840\u6c27\u5386\u53f2',
      expected: 'rw_health_data:blood_oxygen/rw_health_data_ack:blood_oxygen',
      build: () => buildRwReadHealthDataCommand(RwKey.BloodOxygen),
      predicate: isMineHealthDataParsed('blood_oxygen'),
      timeoutMs: 8000
    },
    {
      key: 'history-key/temperature/read',
      label: '\u8bfb\u53d6\u4f53\u6e29\u5386\u53f2',
      expected: 'rw_health_data:temperature/rw_health_data_ack:temperature key=0x0508',
      build: () => buildRwReadHealthDataCommand(RwKey.Temperature),
      predicate: isMineHealthDataKeyParsed('temperature', RwKey.Temperature),
      timeoutMs: 8000
    },
    {
      key: 'history-key/temperature/read-no-crc',
      label: '\u8bfb\u53d6\u4f53\u6e29\u5386\u53f2(\u77ed\u547d\u4ee4)',
      expected: 'rw_health_data:temperature/rw_health_data_ack:temperature key=0x0508 via ab-no-crc',
      build: () => buildRwReadKeyCommandWithoutChecksum(RwKey.Temperature),
      predicate: isMineHealthDataKeyParsed('temperature', RwKey.Temperature),
      required: false,
      timeoutMs: 8000
    },
    {
      key: 'history-key/hrv/read',
      label: '\u8bfb\u53d6HRV\u5386\u53f2',
      expected: 'rw_health_data:hrv/rw_health_data_ack:hrv',
      build: () => buildRwReadHealthDataCommand(RwKey.Hrv),
      predicate: isMineHealthDataParsed('hrv'),
      timeoutMs: 8000
    },
    {
      key: 'history-key/stress/read',
      label: '\u8bfb\u53d6\u538b\u529b\u5386\u53f2',
      expected: 'rw_health_data:stress/rw_health_data_ack:stress',
      build: () => buildRwReadHealthDataCommand(RwKey.Stress),
      predicate: isMineHealthDataParsed('stress'),
      timeoutMs: 8000
    },
    {
      key: 'history-key/blood-sugar/read',
      label: '\u8bfb\u53d6\u8840\u7cd6\u5386\u53f2',
      expected: 'rw_health_data:blood_sugar/rw_health_data_ack:blood_sugar',
      build: () => buildRwReadHealthDataCommand(RwKey.BloodSugar),
      predicate: isMineHealthDataParsed('blood_sugar'),
      timeoutMs: 8000
    },
    {
      key: 'history-key/blood-pressure/read',
      label: '\u8bfb\u53d6\u8840\u538b\u5386\u53f2',
      expected: 'rw_health_data:blood_pressure/rw_health_data_ack:blood_pressure',
      build: () => buildRwReadHealthDataCommand(RwKey.BloodPressure),
      predicate: isMineHealthDataParsed('blood_pressure'),
      timeoutMs: 8000
    },
    {
      key: 'history-key/activity-current-day/read-continue',
      label: '\u7ee7\u7eed\u8bfb\u53d6\u5f53\u5929\u6b65\u6570',
      expected: 'rw_health_data:step/rw_health_data_ack:step key=0x051a',
      build: () => buildRwReadContinueKeyCommand(RwKey.ActivityCurrentDay),
      predicate: isMineHealthDataKeyParsed('step', RwKey.ActivityCurrentDay),
      timeoutMs: 8000
    },
    {
      key: 'history-key/activity/read-continue',
      label: '\u7ee7\u7eed\u8bfb\u53d6\u6d3b\u52a8\u5386\u53f2',
      expected: 'rw_health_data:step/rw_health_data_ack:step key=0x0502',
      build: () => buildRwReadContinueKeyCommand(RwKey.Activity),
      predicate: isMineHealthDataKeyParsed('step', RwKey.Activity),
      timeoutMs: 8000
    },
    {
      key: 'history-key/sleep/read-continue',
      label: '\u7ee7\u7eed\u8bfb\u53d6\u7761\u7720\u5386\u53f2',
      expected: 'rw_health_data:sleep/rw_health_data_ack:sleep key=0x0505',
      build: () => buildRwReadContinueKeyCommand(RwKey.Sleep),
      predicate: isMineHealthDataKeyParsed('sleep', RwKey.Sleep),
      timeoutMs: 8000
    },
    {
      key: 'history-key/heart-rate/read-continue',
      label: '\u7ee7\u7eed\u8bfb\u53d6\u5fc3\u7387\u5386\u53f2',
      expected: 'rw_health_data:heart_rate/rw_health_data_ack:heart_rate',
      build: () => buildRwReadContinueKeyCommand(RwKey.HeartRate),
      predicate: isMineHealthDataParsed('heart_rate'),
      timeoutMs: 8000
    },
    {
      key: 'history-key/blood-oxygen/read-continue',
      label: '\u7ee7\u7eed\u8bfb\u53d6\u8840\u6c27\u5386\u53f2',
      expected: 'rw_health_data:blood_oxygen/rw_health_data_ack:blood_oxygen',
      build: () => buildRwReadContinueKeyCommand(RwKey.BloodOxygen),
      predicate: isMineHealthDataParsed('blood_oxygen'),
      timeoutMs: 8000
    },
    {
      key: 'history-key/temperature/read-continue',
      label: '\u7ee7\u7eed\u8bfb\u53d6\u4f53\u6e29\u5386\u53f2',
      expected: 'rw_health_data:temperature/rw_health_data_ack:temperature',
      build: () => buildRwReadContinueKeyCommand(RwKey.Temperature),
      predicate: isMineHealthDataKeyParsed('temperature', RwKey.Temperature),
      timeoutMs: 8000
    },
    {
      key: 'history-key/hrv/read-continue',
      label: '\u7ee7\u7eed\u8bfb\u53d6HRV\u5386\u53f2',
      expected: 'rw_health_data:hrv/rw_health_data_ack:hrv',
      build: () => buildRwReadContinueKeyCommand(RwKey.Hrv),
      predicate: isMineHealthDataParsed('hrv'),
      timeoutMs: 8000
    },
    {
      key: 'history-key/stress/read-continue',
      label: '\u7ee7\u7eed\u8bfb\u53d6\u538b\u529b\u5386\u53f2',
      expected: 'rw_health_data:stress/rw_health_data_ack:stress',
      build: () => buildRwReadContinueKeyCommand(RwKey.Stress),
      predicate: isMineHealthDataParsed('stress'),
      timeoutMs: 8000
    },
    {
      key: 'history-key/blood-sugar/read-continue',
      label: '\u7ee7\u7eed\u8bfb\u53d6\u8840\u7cd6\u5386\u53f2',
      expected: 'rw_health_data:blood_sugar/rw_health_data_ack:blood_sugar',
      build: () => buildRwReadContinueKeyCommand(RwKey.BloodSugar),
      predicate: isMineHealthDataParsed('blood_sugar'),
      timeoutMs: 8000
    },
    {
      key: 'history-key/blood-pressure/read-continue',
      label: '\u7ee7\u7eed\u8bfb\u53d6\u8840\u538b\u5386\u53f2',
      expected: 'rw_health_data:blood_pressure/rw_health_data_ack:blood_pressure',
      build: () => buildRwReadContinueKeyCommand(RwKey.BloodPressure),
      predicate: isMineHealthDataParsed('blood_pressure'),
      timeoutMs: 8000
    },
    {
      key: 'heart-rate/control-enable',
      label: '\u5fc3\u7387\u5b9e\u65f6\u5f00\u542f',
      expected: 'rw_health_data_control_ack:heart_rate enable',
      build: () => buildRwControlHealthDataCommand(RwHealthDataControlKey.HeartRate, true),
      predicate: isMineHealthControlParsed('heart_rate', true),
      writeOnlyOk: true,
      timeoutMs: 8000,
      delayAfterMs: 0
    },
    {
      key: 'heart-rate/app-realtime-read',
      label: '\u5fc3\u7387APP\u5b9e\u65f6\u8bfb\u53d6(0x0224 CRC)',
      expected: 'rw_health_data:heart_rate key=0x0224 via app-sdk-ab-crc-read',
      build: () => buildRwReadKeyCommand(RwKey.AppRealTimeHeartRate),
      predicate: isMineRealtimeHealthDataParsed('heart_rate', RwKey.AppRealTimeHeartRate),
      timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
      pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
      pollResponseGraceMs: 250
    },
    {
      key: 'heart-rate/app-realtime-read-no-crc',
      label: '\u5fc3\u7387APP\u5b9e\u65f6\u8bfb\u53d6(0x0224\u77ed\u547d\u4ee4)',
      expected: 'rw_health_data:heart_rate key=0x0224 via ab-no-crc',
      build: () => buildRwReadKeyCommandWithoutChecksum(RwKey.AppRealTimeHeartRate),
      predicate: isMineRealtimeHealthDataParsed('heart_rate', RwKey.AppRealTimeHeartRate),
      required: false,
      timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
      pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
      pollResponseGraceMs: 250
    },
    {
      key: 'heart-rate/realtime-read',
      label: '\u5fc3\u7387\u5b9e\u65f6\u8bfb\u53d6',
      expected: 'rw_health_data:heart_rate key=0x0503 via app-sdk-ab-crc-read',
      build: () => buildRwReadHealthDataCommand(RwKey.HeartRate),
      predicate: isMineRealtimeHealthDataParsed('heart_rate', RwKey.HeartRate),
      timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
      pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
      pollResponseGraceMs: 250
    },
    {
      key: 'heart-rate/realtime-read-no-crc',
      label: '\u5fc3\u7387\u5b9e\u65f6\u8bfb\u53d6(\u77ed\u547d\u4ee4)',
      expected: 'rw_health_data:heart_rate key=0x0503 via ab-no-crc',
      build: () => buildRwReadKeyCommandWithoutChecksum(RwKey.HeartRate),
      predicate: isMineRealtimeHealthDataParsed('heart_rate', RwKey.HeartRate),
      required: false,
      timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
      pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
      pollResponseGraceMs: 250
    },
    {
      key: 'heart-rate/control-disable',
      label: '\u5fc3\u7387\u5b9e\u65f6\u5173\u95ed',
      expected: 'rw_health_data_control_ack:heart_rate disable',
      build: () => buildRwControlHealthDataCommand(RwHealthDataControlKey.HeartRate, false),
      predicate: isMineHealthControlParsed('heart_rate', false),
      writeOnlyOk: true,
      timeoutMs: 8000
    },
    {
      key: 'blood-oxygen/control-enable',
      label: '\u8840\u6c27\u5b9e\u65f6\u5f00\u542f',
      expected: 'rw_health_data_control_ack:blood_oxygen enable',
      build: () => buildRwControlHealthDataCommand(RwHealthDataControlKey.BloodOxygen, true),
      predicate: isMineHealthControlParsed('blood_oxygen', true),
      writeOnlyOk: true,
      timeoutMs: 8000,
      delayAfterMs: 0
    },
    {
      key: 'blood-oxygen/app-realtime-read',
      label: '\u8840\u6c27APP\u5b9e\u65f6\u8bfb\u53d6(0x024E CRC)',
      expected: 'rw_health_data:blood_oxygen key=0x024e via app-sdk-ab-crc-read',
      build: () => buildRwReadKeyCommand(RwKey.AppRealTimeBloodOxygen),
      predicate: isMineRealtimeHealthDataParsed('blood_oxygen', RwKey.AppRealTimeBloodOxygen),
      timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
      pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
      pollResponseGraceMs: 250
    },
    {
      key: 'blood-oxygen/app-realtime-read-no-crc',
      label: '\u8840\u6c27APP\u5b9e\u65f6\u8bfb\u53d6(0x024E\u77ed\u547d\u4ee4)',
      expected: 'rw_health_data:blood_oxygen key=0x024e via ab-no-crc',
      build: () => buildRwReadKeyCommandWithoutChecksum(RwKey.AppRealTimeBloodOxygen),
      predicate: isMineRealtimeHealthDataParsed('blood_oxygen', RwKey.AppRealTimeBloodOxygen),
      required: false,
      timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
      pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
      pollResponseGraceMs: 250
    },
    {
      key: 'blood-oxygen/realtime-read',
      label: '\u8840\u6c27\u5b9e\u65f6\u8bfb\u53d6',
      expected: 'rw_health_data:blood_oxygen key=0x0509 via app-sdk-ab-crc-read',
      build: () => buildRwReadHealthDataCommand(RwKey.BloodOxygen),
      predicate: isMineRealtimeHealthDataParsed('blood_oxygen', RwKey.BloodOxygen),
      timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
      pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
      pollResponseGraceMs: 250
    },
    {
      key: 'blood-oxygen/realtime-read-no-crc',
      label: '\u8840\u6c27\u5b9e\u65f6\u8bfb\u53d6(\u77ed\u547d\u4ee4)',
      expected: 'rw_health_data:blood_oxygen key=0x0509 via ab-no-crc',
      build: () => buildRwReadKeyCommandWithoutChecksum(RwKey.BloodOxygen),
      predicate: isMineRealtimeHealthDataParsed('blood_oxygen', RwKey.BloodOxygen),
      required: false,
      timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
      pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
      pollResponseGraceMs: 250
    },
    {
      key: 'blood-oxygen/control-disable',
      label: '\u8840\u6c27\u5b9e\u65f6\u5173\u95ed',
      expected: 'rw_health_data_control_ack:blood_oxygen disable',
      build: () => buildRwControlHealthDataCommand(RwHealthDataControlKey.BloodOxygen, false),
      predicate: isMineHealthControlParsed('blood_oxygen', false),
      writeOnlyOk: true,
      timeoutMs: 8000
    },
    {
      key: 'temperature/control-disable',
      label: '\u4f53\u6e29\u5b9e\u65f6\u5173\u95ed(0x0609/0x08)',
      expected: 'rw_health_data_control_ack:temperature disable',
      build: () => buildRwControlHealthDataCommand(RwHealthDataControlKey.Temperature, false),
      predicate: isMineHealthControlParsed('temperature', false, { acceptGenericAck: true }),
      writeOnlyOk: true,
      required: false,
      timeoutMs: 8000
    },
    ...mineUnverifiedRealtimeProbeMetrics.flatMap((metric) => [
      {
        key: `${metric.keyPrefix}/control-enable`,
        label: `${metric.label}\u5b9e\u65f6\u5f00\u542f`,
        expected: `rw_health_data_control_ack:${metric.name} enable`,
        build: () => buildRwControlHealthDataCommand(metric.controlKey, true),
        predicate: isMineHealthControlParsed(metric.name, true),
        timeoutMs: 8000,
        delayAfterMs: 0
      },
      {
        key: `${metric.keyPrefix}/app-realtime-read`,
        label: `${metric.label} APP\u5b9e\u65f6\u8bfb\u53d6`,
        expected: `rw_health_data:${metric.name} key=0x${metric.realtimeKey.toString(16)} via app-sdk-ab-crc-read`,
        build: () => buildRwReadKeyCommand(metric.realtimeKey),
        predicate: isMineRealtimeHealthDataParsed(metric.name, metric.realtimeKey),
        timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
        pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
        pollResponseGraceMs: 250
      },
      {
        key: `${metric.keyPrefix}/app-realtime-read-no-crc`,
        label: `${metric.label} APP\u5b9e\u65f6\u8bfb\u53d6(\u77ed\u547d\u4ee4)`,
        expected: `rw_health_data:${metric.name} key=0x${metric.realtimeKey.toString(16)} via ab-no-crc`,
        build: () => buildRwReadKeyCommandWithoutChecksum(metric.realtimeKey),
        predicate: isMineRealtimeHealthDataParsed(metric.name, metric.realtimeKey),
        required: false,
        timeoutMs: RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS,
        pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS,
        pollResponseGraceMs: 250
      },
      {
        key: `${metric.keyPrefix}/health-read`,
        label: `${metric.label}\u5386\u53f2\u8bfb\u53d6`,
        expected: `rw_health_data:${metric.name}/rw_health_data_ack:${metric.name}`,
        build: () => buildRwReadHealthDataCommand(metric.readableKey),
        predicate: isMineHealthDataParsed(metric.name),
        required: false,
        timeoutMs: 8000
      },
      {
        key: `${metric.keyPrefix}/control-disable`,
        label: `${metric.label}\u5b9e\u65f6\u5173\u95ed`,
        expected: `rw_health_data_control_ack:${metric.name} disable`,
        build: () => buildRwControlHealthDataCommand(metric.controlKey, false),
        predicate: isMineHealthControlParsed(metric.name, false),
        timeoutMs: 8000
      }
    ]),
    {
      key: 'history/local-incremental',
      label: '\u672c\u5730\u5386\u53f2\u589e\u91cf',
      expected: 'local_data',
      build: () => buildRwReadLocalDataCommand(startTimestamp, false),
      predicate: (parsed) => parsed.type === 'local_data',
      timeoutMs: 12000
    },
    {
      key: 'history/file-list',
      label: '\u5386\u53f2\u6587\u4ef6\u5217\u8868',
      expected: 'rw_file_list',
      build: () => buildRwReadFileListCommand(),
      predicate: (parsed) => parsed.type === 'rw_file_list',
      timeoutMs: 12000
    },
    {
      key: 'history/qkeer-v2-sleep-detail',
      label: '\u7761\u7720\u5386\u53f2\u8be6\u60c5',
      expected: 'qkeer_v2_sleep',
      build: () => buildRwQkeerV2HistoryListCommand(RwQkeerV2HistoryCommand.Sleep, startTimestamp, endTimestamp),
      predicate: (parsed) => parsed.type === 'qkeer_v2_sleep',
      timeoutMs: 12000
    },
    {
      key: 'history/qkeer-v2-sleep-list',
      label: '\u7761\u7720\u5386\u53f2\u5217\u8868',
      expected: 'qkeer_v2_sleep_list',
      build: () => buildRwQkeerV2HistoryListCommand(RwQkeerV2HistoryCommand.SleepList, startTimestamp, endTimestamp),
      predicate: (parsed) => parsed.type === 'qkeer_v2_sleep_list',
      timeoutMs: 12000
    },
    {
      key: 'history/qkeer-v2-enhance-sleep-read',
      label: '\u589e\u5f3a\u7761\u7720\u8bfb\u53d6',
      expected: 'qkeer_v2_enhance_sleep_read',
      build: () => buildRwQkeerV2Packet(RwQkeerV2HistoryCommand.EnhanceSleepRead, new Uint8Array([0x00])),
      predicate: (parsed) => parsed.type === 'qkeer_v2_enhance_sleep_read',
      timeoutMs: 8000
    },
    {
      key: 'history/qkeer-v2-health-list',
      label: '\u4f53\u5f81\u5386\u53f2\u5217\u8868',
      expected: 'qkeer_v2_health_list',
      build: () => buildRwQkeerV2HistoryListCommand(RwQkeerV2HistoryCommand.HealthList, startTimestamp, endTimestamp),
      predicate: (parsed) => parsed.type === 'qkeer_v2_health_list',
      timeoutMs: 12000
    },
    {
      key: 'history/qkeer-v2-step-list',
      label: '\u6d3b\u52a8\u5386\u53f2\u5217\u8868',
      expected: 'qkeer_v2_step_list',
      build: () => buildRwQkeerV2HistoryListCommand(RwQkeerV2HistoryCommand.StepList, startTimestamp, endTimestamp),
      predicate: (parsed) => parsed.type === 'qkeer_v2_step_list',
      timeoutMs: 12000
    },
    {
      key: 'history/qkeer-v2-last-data',
      label: '\u6700\u8fd1\u6458\u8981\u6570\u636e',
      expected: 'qkeer_v2_last_data',
      build: () => buildRwQkeerV2LastDataCommand(),
      predicate: (parsed) => parsed.type === 'qkeer_v2_last_data',
      timeoutMs: 12000
    }
  ];
  const normalizedCommands = commands
    .map((command, originalIndex) => ({
      ...normalizeMineProtocolProbeCommand(command),
      originalIndex
    }));
  const singleProtocolProbeKey = mineSingleProtocolProbeKeyByMode[mode];
  const selectableCommands = singleProtocolProbeKey
    ? normalizedCommands
    : normalizedCommands.filter((command) => !mineProtocolProbeSingleOnlyKeys.has(command.key));
  const filteredCommands = singleProtocolProbeKey
    ? selectableCommands
      .filter((command) => command.key === singleProtocolProbeKey)
      .map((command) => withMineSdkRetryProbeCommand({ ...command, required: true }))
    : mode === 'temperature'
    ? selectableCommands
      .filter((command) => mineTemperatureProtocolProbeKeys.has(command.key))
      .map((command) => ({
        ...command,
        required: mineTemperatureProtocolProbeRequiredKeys.has(command.key)
      }))
    : mode === 'stepSleep'
      ? selectableCommands
        .filter((command) => mineStepSleepProtocolProbeKeys.has(command.key))
        .map((command) => ({ ...command, required: true }))
      : mode === 'stressMonitoring'
        ? selectableCommands
          .filter((command) => mineStressMonitoringProtocolProbeKeys.has(command.key))
          .map((command) => ({ ...command, required: true }))
      : mode === 'heartRateRealtime'
        ? selectableCommands
          .filter((command) => mineHeartRateRealtimeProtocolProbeKeys.has(command.key))
          .map((command) => ({ ...command, required: true }))
      : mode === 'bloodOxygenRealtime'
        ? selectableCommands
          .filter((command) => mineBloodOxygenRealtimeProtocolProbeKeys.has(command.key))
          .map((command) => ({ ...command, required: true }))
      : mode === 'hrvRealtime'
        ? selectableCommands
          .filter((command) => mineHrvRealtimeProtocolProbeKeys.has(command.key))
          .map((command) => ({
            ...command,
            required: true,
            timeoutMs: command.key === 'hrv/app-realtime-read' ? Math.max(command.timeoutMs ?? 0, 65000) : command.timeoutMs,
            pollAtMs: command.key === 'hrv/app-realtime-read' ? [1500, 8000, 18000, 28000, 40000, 52000] : command.pollAtMs
          }))
      : mode === 'sleepSdkHistory'
        ? selectableCommands
          .filter((command) => mineSleepSdkProtocolProbeKeys.has(command.key))
          .map((command) => ({ ...command, required: true }))
      : selectableCommands.filter((command) => mode === 'full' || command.required !== false);
  const sortOrder = mode === 'temperature'
    ? getMineTemperatureProtocolProbeSortOrder
      : mode === 'stepSleep'
        ? getMineStepSleepProtocolProbeSortOrder
      : mode === 'stressMonitoring'
        ? (command: MineProtocolProbeCommand) => mineStressMonitoringProtocolProbeOrder.indexOf(command.key)
      : mode === 'heartRateRealtime'
        ? getMineHeartRateRealtimeProtocolProbeSortOrder
      : mode === 'bloodOxygenRealtime'
        ? getMineBloodOxygenRealtimeProtocolProbeSortOrder
      : mode === 'hrvRealtime'
        ? getMineHrvRealtimeProtocolProbeSortOrder
      : mode === 'sleepSdkHistory'
        ? getMineSleepSdkProtocolProbeSortOrder
      : getMineProtocolProbeSortOrder;
  return filteredCommands
    .sort((a, b) => sortOrder(a) - sortOrder(b) || a.originalIndex - b.originalIndex)
    .map(({ originalIndex, ...command }) => command);
};
const getMineDiagnosticCopyDetails = () =>
  normalizeMineDiagnosticDetails({
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    snapshot: getMineProtocolProbeSnapshot(),
    uploadStatus: userStore.uploadingStatus,
    isUploading: userStore.isUploading,
    localDataLength: Array.isArray(userStore.localData) ? userStore.localData.length : 0,
    lastHistoryResult: summarizeMineHistoryResult(controller.lastHistoryResult.value as Record<string, any> | null),
    activeMetric: activeMetricTestName.value || null,
    activeProtocolProbeMode: activeProtocolProbeMode.value || null,
    activeProtocolProbe: activeProtocolProbeLabel.value || null,
    lastMetricResult: latestMineMetricResult.value
  });

const formatMineDiagnosticCopyHeader = (details = getMineDiagnosticCopyDetails()) =>
  formatMineDiagnosticLogEntry({
    id: Date.now(),
    time: formatMineDiagnosticTime(),
    source: 'RW MINE',
    event: 'diagnostic-copy',
    details
  });
const copyMineDiagnosticLogs = async () => {
  const copyDetails = getMineDiagnosticCopyDetails();
  appendMineDiagnosticLog('diagnostic-copy', copyDetails);
  await flushRwDiagnosticUploadQueue();
  const logs = readMineDiagnosticLogs(RING_DIAGNOSTIC_LOG_MAX_COUNT);
  const incompleteWarning = formatMineDiagnosticCopyIncompleteWarning(logs);
  const acceptanceReport = formatMineRwL19AcceptanceCompactReport(logs);
  const probeReport = formatMineProtocolProbeCompactReport(logs);
  const historyReport = formatMineHistoryCompactReport(logs);
  const rawLogs = getMineDiagnosticRawCopyLogs(logs);
  const body = formatMineDiagnosticCopyRawLogs(rawLogs);
  const data = [formatMineDiagnosticCopyHeader(copyDetails), incompleteWarning, acceptanceReport, probeReport, historyReport, body || '\u6682\u65e0RW\u8bca\u65ad\u65e5\u5fd7']
    .filter(Boolean)
    .join('\n');
  uni.setClipboardData({
    data,
    success: () => {
      const message = incompleteWarning
        ? '\u65e5\u5fd7\u5df2\u590d\u5236\uff0c\u81ea\u68c0\u5c1a\u672a\u5b8c\u6574'
        : '\u65e5\u5fd7\u5df2\u590d\u5236';
      rwDiagnosticActionText.value = message;
      uni.showToast({ title: message, icon: 'none' });
    }
  });
};
const clearMineRwDiagnosticLogs = async () => {
  clearMineDiagnosticLogs();
  clearRwDiagnosticUploadQueue();
  const remoteCleared = await clearRwDiagnosticRemoteLogs();
  rwDiagnosticActionText.value = remoteCleared ? '\u65e5\u5fd7\u5df2\u6e05\u7a7a' : '\u672c\u5730\u65e5\u5fd7\u5df2\u6e05\u7a7a\uff0c\u540e\u7aef\u6e05\u7a7a\u5931\u8d25';
  uni.showToast({ title: rwDiagnosticActionText.value, icon: remoteCleared ? 'success' : 'none' });
};
const setMineSleepProbeIsolationLock = (reason: string) => {
  if (!MINE_SLEEP_PROTOCOL_PROBE_ISOLATION_LOCK) return null;
  const lock = setRwDiagnosticCommandLock({
    owner: MINE_SLEEP_PROTOCOL_PROBE_ISOLATION_OWNER,
    reason,
    mode: activeProtocolProbeMode.value || 'sleepHistory',
    ttlMs: MINE_PROTOCOL_PROBE_DIAGNOSTIC_LOCK_TTL_MS
  });
  controller.pauseBusinessAutoRefresh();
  appendMineDiagnosticLog('sleep-probe-isolation-lock-set', {
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    reason,
    lock,
    autoRefreshPaused: true
  });
  return lock;
};
const clearMineSleepProbeIsolationLock = (reason: string) => {
  const cleared = clearRwDiagnosticCommandLock(MINE_SLEEP_PROTOCOL_PROBE_ISOLATION_OWNER);
  controller.resumeBusinessAutoRefresh();
  appendMineDiagnosticLog('sleep-probe-isolation-lock-clear', {
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    reason,
    owner: MINE_SLEEP_PROTOCOL_PROBE_ISOLATION_OWNER,
    cleared,
    autoRefreshPaused: false
  });
  return cleared;
};
const getMineConnectionSnapshot = () => ({
  buildTag: RW_DIAGNOSTIC_BUILD_TAG,
  page: 'mine',
  connected: isConnectedStatus.value,
  pageConnected: isConnectedStatus.value,
  ready: hasMineCommunicationReady(),
  storeConnected: ringStore.isConnected,
  userConnected: userStore.isConnected,
  storeReconnectStatus: ringStore.reconnectStatus,
  userReconnectStatus: userStore.reconnectStatus,
  storeReconnectResult: ringStore.reconnectResult,
  userReconnectResult: userStore.reconnectResult,
  isReconnecting: userStore.isReconnecting,
  currentDevice: summarizeMineDevice(ringDeviceInfo.value as Record<string, any>),
  storeDevice: summarizeMineDevice(ringStore.deviceInfo as Record<string, any>),
  userDevice: summarizeMineDevice(userStore.deviceInfo as Record<string, any>)
});
const getMineProtocolProbeSnapshot = () => {
  const device = summarizeMineDevice(ringDeviceInfo.value as Record<string, any>);
  return {
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    connected: isConnectedStatus.value,
    ready: hasMineCommunicationReady(),
    storeConnected: ringStore.isConnected,
    userConnected: userStore.isConnected,
    reconnectStatus: userStore.reconnectStatus || ringStore.reconnectStatus,
    isReconnecting: userStore.isReconnecting,
    deviceId: device.deviceId,
    name: device.name,
    protocol: device.protocol,
    serviceId: device.serviceId,
    cmdCharId: device.cmdCharId,
    dataServiceId: device.dataServiceId,
    dataCharId: device.dataCharId,
    notifyEnabled: device.notifyEnabled
  };
};
const isConnectedStatus = computed(() =>
  isRingConnectionActive({
    ready: hasMineCommunicationReady(),
    connected: userStore.isConnected === true || ringStore.isConnected === true,
    reconnectStatus: userStore.reconnectStatus || ringStore.reconnectStatus
  })
);
const isLoading = computed(() =>
  isRingConnectionConnecting({
    ready: hasMineCommunicationReady(),
    connected: userStore.isConnected === true || ringStore.isConnected === true,
    reconnectStatus: userStore.reconnectStatus || ringStore.reconnectStatus,
    isReconnecting: userStore.isReconnecting === true || ringStore.isReconnecting === true
  })
);
const mineBluetoothStatus = computed(() => {
  if (isConnectedStatus.value) {
    return {
      iconPath: '/static/images/mine/bluetooth02.png',
      text: '已连接',
      textColor: '#4C76F1'
    };
  }
  if (isLoading.value) {
    return {
      iconPath: '/static/images/mine/bluetooth01.png',
      text: '连接中',
      textColor: '#010101'
    };
  }
  return {
    iconPath: '/static/images/mine/bluetooth03.png',
    text: '未连接',
    textColor: '#010101'
  };
});
const isMineHistorySyncing = computed(() => historySyncBusy.value || controller.isSyncingHistory.value);
const isMineMetricReading = computed(() => metricTestBusy.value);
const isMineProtocolProbeRunning = computed(() => protocolProbeBusy.value);
const isMineBleCommandSending = computed(
  () => userStore.isSending === true || controller.isRefreshingBusinessData.value || mineDeviceInfoSnapshotBusy.value
);
const isMineRwActionBusy = computed(
  () => isMineHistorySyncing.value || isMineMetricReading.value || isMineProtocolProbeRunning.value || isMineBleCommandSending.value
);
const isMineRwAnyActionBusy = computed(() => isMineRwActionBusy.value || mineRwAcceptanceBusy.value);
const isMineHistoryButtonLoading = (key: MineHistorySyncKey) => isMineHistorySyncing.value && activeHistorySyncKey.value === key;
const historySyncButtonText = computed(() => (isMineHistoryButtonLoading('summary') ? '\u8bfb\u53d6\u4e2d...' : '\u8bfb\u53d6\u6458\u8981'));
const getMineHistoryButtonText = (item: MineHistorySyncItem) => (isMineHistoryButtonLoading(item.key) ? '\u540c\u6b65\u4e2d...' : item.label);
const isMineCoreProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'core');
const isMineFullProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'full');
const isMineTemperatureProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'temperature');
const isMineTemperatureMonitoringProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'temperatureMonitoring');
const isMineTemperatureDetectingProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'temperatureDetecting');
const isMineTemperatureDetectingPlainProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'temperatureDetectingPlain');
const isMineTemperatureDetectingShortProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'temperatureDetectingShort');
const isMineTemperatureDetectingNoCrcProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'temperatureDetectingNoCrc');
const isMineTemperatureRealtimeReadProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'temperatureRealtimeRead');
const isMineTemperatureRealtimeControlEnableProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'temperatureRealtimeControlEnable');
const isMineTemperatureRealtimeControlDisableProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'temperatureRealtimeControlDisable');
const isMineTemperatureHistoryProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'temperatureHistory');
const isMineStressMonitoringProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'stressMonitoring');
const isMineHeartRateRealtimeProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'heartRateRealtime');
const isMineBloodOxygenRealtimeProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'bloodOxygenRealtime');
const isMineHrvRealtimeProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'hrvRealtime');
const isMineStepCurrentDayProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'stepCurrentDay');
const isMineStepCurrentDayC6ProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'stepCurrentDayC6');
const isMineActivityHistoryProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'activityHistory');
const isMineSleepHistoryProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'sleepHistory');
const isMineSleepSdkHistoryProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'sleepSdkHistory');
const isMineSleepNativeDetailProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'sleepNativeDetail');
const isMineSleepNativeListProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'sleepNativeList');
const isMineSleepEnhanceReadProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'sleepEnhanceRead');
const isMineSleepActivityCurrentDayProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'sleepActivityCurrentDay');
const isMineSleepContinueHistoryProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'sleepContinueHistory');
const isMineRawSleepHistoryProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'rawSleepHistory');
const isMineSleepDeleteProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'sleepDelete');
const isMineStepSleepProtocolProbeRunning = computed(() => isMineProtocolProbeRunning.value && activeProtocolProbeMode.value === 'stepSleep');
const protocolProbeButtonText = computed(() => (isMineCoreProtocolProbeRunning.value ? '\u6838\u5fc3\u81ea\u68c0\u4e2d...' : '\u6838\u5fc3\u81ea\u68c0'));
const fullProtocolProbeButtonText = computed(() => (isMineFullProtocolProbeRunning.value ? '\u5b8c\u6574\u81ea\u68c0\u4e2d...' : '\u5b8c\u6574\u81ea\u68c0'));
const temperatureProtocolProbeButtonText = computed(() => (isMineTemperatureProtocolProbeRunning.value ? '\u4f53\u6e29\u5355\u6d4b\u4e2d...' : '\u4f53\u6e29\u5355\u6d4b'));
const temperatureMonitoringProtocolProbeButtonText = computed(() => (isMineTemperatureMonitoringProtocolProbeRunning.value ? '\u4f53\u6e29\u914d\u7f6e\u4e2d...' : '\u4f53\u6e29\u914d\u7f6e'));
const temperatureDetectingProtocolProbeButtonText = computed(() => (isMineTemperatureDetectingProtocolProbeRunning.value ? '\u4f53\u6e29\u5f00\u542f\u4e2d...' : '\u4f53\u6e29\u5f00\u542f'));
const temperatureDetectingPlainProtocolProbeButtonText = computed(() => (isMineTemperatureDetectingPlainProtocolProbeRunning.value ? '\u4f53\u6e29\u5f0001\u4e2d...' : '\u4f53\u6e29\u5f0001'));
const temperatureDetectingShortProtocolProbeButtonText = computed(() => (isMineTemperatureDetectingShortProtocolProbeRunning.value ? '\u4f53\u6e29\u5f005\u5206\u4e2d...' : '\u4f53\u6e29\u5f005\u5206'));
const temperatureDetectingNoCrcProtocolProbeButtonText = computed(() => (isMineTemperatureDetectingNoCrcProtocolProbeRunning.value ? '\u4f53\u6e29\u5f00\u77ed\u5e27\u4e2d...' : '\u4f53\u6e29\u5f00\u77ed\u5e27'));
const temperatureRealtimeReadProtocolProbeButtonText = computed(() => (isMineTemperatureRealtimeReadProtocolProbeRunning.value ? '\u4f53\u6e29\u5b9e\u65f60230\u4e2d...' : '\u4f53\u6e29\u5b9e\u65f60230'));
const temperatureRealtimeControlEnableProtocolProbeButtonText = computed(() => (isMineTemperatureRealtimeControlEnableProtocolProbeRunning.value ? '\u4f53\u6e29\u63a7\u5236\u5f00\u4e2d...' : '\u4f53\u6e29\u63a7\u5236\u5f00'));
const temperatureRealtimeControlDisableProtocolProbeButtonText = computed(() => (isMineTemperatureRealtimeControlDisableProtocolProbeRunning.value ? '\u4f53\u6e29\u63a7\u5236\u5173\u4e2d...' : '\u4f53\u6e29\u63a7\u5236\u5173'));
const temperatureHistoryProtocolProbeButtonText = computed(() => (isMineTemperatureHistoryProtocolProbeRunning.value ? '\u4f53\u6e29\u5386\u53f2\u4e2d...' : '\u4f53\u6e29\u5386\u53f2'));
const stressMonitoringProtocolProbeButtonText = computed(() => (isMineStressMonitoringProtocolProbeRunning.value ? 'HRV\u538b\u529b\u5f00\u4e2d...' : 'HRV\u538b\u529b\u5f00'));
const heartRateRealtimeProtocolProbeButtonText = computed(() => (isMineHeartRateRealtimeProtocolProbeRunning.value ? '\u5fc3\u73870224\u4e2d...' : '\u5fc3\u73870224'));
const bloodOxygenRealtimeProtocolProbeButtonText = computed(() => (isMineBloodOxygenRealtimeProtocolProbeRunning.value ? '\u8840\u6c27024E\u4e2d...' : '\u8840\u6c27024E'));
const hrvRealtimeProtocolProbeButtonText = computed(() => (isMineHrvRealtimeProtocolProbeRunning.value ? 'HRV0269\u4e2d...' : 'HRV0269'));
const stepCurrentDayProtocolProbeButtonText = computed(() => (isMineStepCurrentDayProtocolProbeRunning.value ? '\u5f53\u5929\u6b65\u6570051a\u4e2d...' : '\u5f53\u5929\u6b65\u6570051a'));
const stepCurrentDayC6ProtocolProbeButtonText = computed(() => (isMineStepCurrentDayC6ProtocolProbeRunning.value ? '\u6b65\u6570C6\u5bf9\u7167\u4e2d...' : '\u6b65\u6570C6\u5bf9\u7167'));
const activityHistoryProtocolProbeButtonText = computed(() => (isMineActivityHistoryProtocolProbeRunning.value ? '\u6d3b\u52a8\u5386\u53f20502\u4e2d...' : '\u6d3b\u52a8\u5386\u53f20502'));
const sleepHistoryProtocolProbeButtonText = computed(() => (isMineSleepHistoryProtocolProbeRunning.value ? '\u7761\u7720\u5386\u53f20505\u4e2d...' : '\u7761\u7720\u5386\u53f20505'));
const sleepSdkHistoryProtocolProbeButtonText = computed(() => (isMineSleepSdkHistoryProtocolProbeRunning.value ? '\u7761\u7720SDK0505\u4e2d...' : '\u7761\u7720SDK0505'));
const sleepNativeDetailProtocolProbeButtonText = computed(() => (isMineSleepNativeDetailProtocolProbeRunning.value ? '\u7761\u7720Native03\u4e2d...' : '\u7761\u7720Native03'));
const sleepNativeListProtocolProbeButtonText = computed(() => (isMineSleepNativeListProtocolProbeRunning.value ? '\u7761\u7720Native31\u4e2d...' : '\u7761\u7720Native31'));
const sleepEnhanceReadProtocolProbeButtonText = computed(() => (isMineSleepEnhanceReadProtocolProbeRunning.value ? '\u589e\u5f3a\u7761\u772073\u4e2d...' : '\u589e\u5f3a\u7761\u772073'));
const sleepActivityCurrentDayProtocolProbeButtonText = computed(() => (isMineSleepActivityCurrentDayProtocolProbeRunning.value ? '\u7761\u7720\u5019\u9009051a\u4e2d...' : '\u7761\u7720\u5019\u9009051a'));
const sleepContinueHistoryProtocolProbeButtonText = computed(() => (isMineSleepContinueHistoryProtocolProbeRunning.value ? '\u7761\u7720\u7eed\u8bfb0505\u4e2d...' : '\u7761\u7720\u7eed\u8bfb0505'));
const rawSleepHistoryProtocolProbeButtonText = computed(() => (isMineRawSleepHistoryProtocolProbeRunning.value ? '\u539f\u59cb\u7761\u772002FE\u4e2d...' : '\u539f\u59cb\u7761\u772002FE'));
const sleepDeleteProtocolProbeButtonText = computed(() => (isMineSleepDeleteProtocolProbeRunning.value ? '\u6e05\u7a7a\u7761\u77200505\u4e2d...' : '\u6e05\u7a7a\u7761\u77200505'));
const stepSleepProtocolProbeButtonText = computed(() => (isMineStepSleepProtocolProbeRunning.value ? '\u6b65\u6570/\u7761\u7720\u5355\u6d4b\u4e2d...' : '\u6b65\u6570/\u7761\u7720\u5355\u6d4b'));
const rwAcceptanceButtonText = computed(() => (mineRwAcceptanceBusy.value ? activeMineRwAcceptanceStep.value || 'RW/L19\u9a8c\u6536\u4e2d...' : 'RW/L19\u9a8c\u6536'));
const getMineProtocolProbeModeLabel = (mode: MineProtocolProbeMode) => {
  if (mode === 'core') return '\u6838\u5fc3\u81ea\u68c0';
  if (mode === 'temperature') return '\u4f53\u6e29\u5355\u6d4b';
  if (mode === 'temperatureMonitoring') return '\u4f53\u6e29\u914d\u7f6e';
  if (mode === 'temperatureDetecting') return '\u4f53\u6e29\u5f00\u542f';
  if (mode === 'temperatureDetectingPlain') return '\u4f53\u6e29\u5f0001';
  if (mode === 'temperatureDetectingShort') return '\u4f53\u6e29\u5f005\u5206';
  if (mode === 'temperatureDetectingNoCrc') return '\u4f53\u6e29\u5f00\u77ed\u5e27';
  if (mode === 'temperatureRealtimeRead') return '\u4f53\u6e29\u5b9e\u65f60230';
  if (mode === 'temperatureRealtimeControlEnable') return '\u4f53\u6e29\u63a7\u5236\u5f00';
  if (mode === 'temperatureRealtimeControlDisable') return '\u4f53\u6e29\u63a7\u5236\u5173';
  if (mode === 'temperatureHistory') return '\u4f53\u6e29\u5386\u53f2';
  if (mode === 'stressMonitoring') return 'HRV\u538b\u529b\u5f00';
  if (mode === 'heartRateRealtime') return '\u5fc3\u73870224';
  if (mode === 'bloodOxygenRealtime') return '\u8840\u6c27024E';
  if (mode === 'hrvRealtime') return 'HRV0269';
  if (mode === 'stepCurrentDay') return '\u5f53\u5929\u6b65\u6570051a';
  if (mode === 'stepCurrentDayC6') return '\u5f53\u5929\u6b65\u6570C6';
  if (mode === 'activityHistory') return '\u6d3b\u52a8\u5386\u53f20502';
  if (mode === 'sleepHistory') return '\u7761\u7720\u5386\u53f20505';
  if (mode === 'sleepSdkHistory') return '\u7761\u7720SDK0505';
  if (mode === 'sleepNativeDetail') return '\u7761\u7720Native03';
  if (mode === 'sleepNativeList') return '\u7761\u7720Native31';
  if (mode === 'sleepEnhanceRead') return '\u589e\u5f3a\u7761\u772073';
  if (mode === 'sleepActivityCurrentDay') return '\u7761\u7720\u5019\u9009051a';
  if (mode === 'sleepContinueHistory') return '\u7761\u7720\u7eed\u8bfb0505';
  if (mode === 'rawSleepHistory') return '\u539f\u59cb\u7761\u772002FE';
  if (mode === 'sleepDelete') return '\u6e05\u7a7a\u7761\u77200505';
  if (mode === 'stepSleep') return '\u6b65\u6570/\u7761\u7720\u5355\u6d4b';
  return '\u5b8c\u6574\u81ea\u68c0';
};
const confirmMineSleepDeleteProbe = () =>
  new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '\u786e\u8ba4\u6e05\u7a7a\u7761\u7720',
      content: '\u5c06\u5411RW\u8bbe\u5907\u53d1\u9001\u4f9b\u5e94\u5546PDF\u7761\u7720\u5220\u9664\u547d\u4ee4050530\uff0c\u4ec5\u7528\u4e8eSDK\u534f\u8bae\u9a8c\u8bc1\u3002',
      confirmText: '\u786e\u8ba4\u6e05\u7a7a',
      confirmColor: '#e34d59',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false)
    });
  });
const handleMineSleepDeleteProbe = async () => {
  const confirmed = await confirmMineSleepDeleteProbe();
  if (!confirmed) return { ok: false, skipped: true, message: '\u5df2\u53d6\u6d88\u6e05\u7a7a\u7761\u7720\u547d\u4ee4' };
  return handleMineProtocolProbe('sleepDelete');
};
const getMineHistorySyncLabel = (key: MineHistorySyncKey | '') => {
  if (key === 'all') return '\u5168\u90e8\u5386\u53f2';
  if (key === 'summary') return '\u6458\u8981';
  return mineHistorySyncItems.find((item) => item.key === key)?.label || '\u5386\u53f2';
};
const getMineHistoryStatusLabel = (status: string) => {
  if (status === 'success') return '\u5386\u53f2\u540c\u6b65\u5b8c\u6210';
  if (status === 'filtered') return '\u5386\u53f2\u5df2\u8fc7\u6ee4';
  if (status === 'empty') return '\u5386\u53f2\u4e3a\u7a7a';
  if (status === 'failed') return '\u5386\u53f2\u540c\u6b65\u5931\u8d25';
  if (status === 'pending' || status === 'requested') return '\u5386\u53f2\u7b49\u5f85\u8bbe\u5907\u8fd4\u56de';
  return '\u5386\u53f2\u72b6\u6001\u4e0d\u786e\u5b9a';
};
const isMineMetricButtonLoading = (name: RwForegroundMetric) => isMineMetricReading.value && activeMetricTestName.value === name;
const getMineMetricButtonText = (item: MineMetricTestItem) => (isMineMetricButtonLoading(item.name) ? '\u6d4b\u91cf\u4e2d...' : item.label);
const mineHistoryStatusText = computed(() => {
  if (isMineHistorySyncing.value) return `${getMineHistorySyncLabel(activeHistorySyncKey.value)}\u540c\u6b65\u4e2d`;
  const result = controller.lastHistoryResult.value as Record<string, any> | null;
  if (!result) return '\u5386\u53f2\u53ef\u624b\u52a8\u540c\u6b65';
  const status = String(result.status || 'unknown');
  const recordCount = Number(result.recordCount ?? result.records?.length ?? result.parsed?.recordCount ?? result.parsed?.totalNum ?? 0);
  const uploaded = result.uploaded === true || result.uploadedStatus === 'success';
  const uploadText = uploaded ? '\u5df2\u4e0a\u4f20' : result.uploaded === false ? '\u672a\u4e0a\u4f20' : '';
  if (recordCount > 0) return '\u5386\u53f2 ' + recordCount + ' \u6761' + (uploadText ? ' ' + uploadText : '');
  return getMineHistoryStatusLabel(status);
});
const rwDiagnosticStatusText = computed(() => {
  if (rwDiagnosticActionText.value) return rwDiagnosticActionText.value;
  if (mineRwAcceptanceBusy.value) return activeMineRwAcceptanceStep.value || 'RW/L19\u9a8c\u6536\u4e2d';
  if (isMineMetricReading.value) return '\u6d4b\u91cf\u4e2d';
  if (isMineProtocolProbeRunning.value) return activeProtocolProbeLabel.value || '\u534f\u8bae\u81ea\u68c0\u4e2d';
  if (isMineHistorySyncing.value) return `${getMineHistorySyncLabel(activeHistorySyncKey.value)}\u540c\u6b65\u4e2d`;
  if (isMineBleCommandSending.value) return '\u8bbe\u5907\u547d\u4ee4\u6267\u884c\u4e2d';
  return '\u53ef\u70b9\u51fb\u6d4b\u8bd5';
});
const getMineBatterySourceValue = (item: Record<string, any> | null | undefined) =>
  item?.metrics?.battery ?? item?.metrics?.batteryValue ?? item?.metrics?.value ?? item?.battery ?? item?.batteryValue ?? item?.value;
const isValidMineBatteryValue = (value: unknown) => {
  if (value == null || value === '') return false;
  const numeric = Number(String(value).replace('%', '').trim());
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100;
};
const latestBattery = computed(() => {
  const sources = [userStore.normalizedData || [], userStore.receivedData || []];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const item = source[index] as Record<string, any>;
      const type = item?.type || item?.dataType || item?.sourceType;
      if (type !== 'battery' && type !== 'firmware_version') continue;
      if (isValidMineBatteryValue(getMineBatterySourceValue(item))) return item;
    }
  }
  return null;
});
const getFirstMetricValue = (...values: any[]) => values.find((value) => value != null && value !== '');
const hasMineBatterySnapshot = () =>
  getFirstMetricValue(
    getMineBatterySourceValue(latestBattery.value as Record<string, any> | null),
    userStore.healthData?.battery,
    userStore.latestMetrics?.battery
  ) != null;
const hasMineFirmwareSnapshot = () =>
  Boolean(
    userStore.healthData?.firmwareVersion ||
      userStore.healthData?.softwareVersion ||
      userStore.latestMetrics?.firmwareVersion ||
      userStore.latestMetrics?.softwareVersion
  );
const displayBatteryValue = computed(() => {
  const value = getFirstMetricValue(
    getMineBatterySourceValue(latestBattery.value as Record<string, any> | null),
    userStore.healthData?.battery,
    userStore.latestMetrics?.battery
  );
  return formatBatteryPercentForDisplay(value, '--');
});
const getMineBatteryStatusValue = (item: Record<string, any> | null | undefined) =>
  item?.metrics?.batteryStatus ?? item?.metrics?.chargingStatusText ?? item?.metrics?.chargingStatus ?? item?.batteryStatus ?? item?.chargingStatusText ?? item?.chargingStatus;
const isMineBatteryCharging = computed(() => {
  const batteryItem = latestBattery.value as Record<string, any> | null;
  if (!batteryItem) return false;
  const rawValue = getMineBatterySourceValue(batteryItem);
  const statusValue = getMineBatteryStatusValue(batteryItem);
  const healthStatus = userStore.healthData?.batteryStatus ?? userStore.latestMetrics?.batteryStatus;
  return isBatteryChargingLike(rawValue, statusValue ?? healthStatus);
});
const batteryPercent = computed(() => {
  if (isMineBatteryCharging.value) return 100;
  const value = getFirstMetricValue(
    getMineBatterySourceValue(latestBattery.value as Record<string, any> | null),
    userStore.healthData?.battery,
    userStore.latestMetrics?.battery
  );
  if (value == null || value === '') return 0;
  const num = Number(String(value).replace('%', '').trim());
  if (!Number.isFinite(num)) return 0;
  return Math.min(Math.max(Math.round(num), 0), 100);
});
// Whether cached battery info can be shown.
const shouldShowBatteryInfo = computed(() => {
  if (isConnectedStatus.value) {
    return true;
  }
  return false;
});
const shouldShowReconnectButton = computed(() => {
  // Show reconnect when a bound ring identity or ready connection exists.
  const info = bindInfo.value || {};
  return Boolean(hasBoundRingIdentity(info) || hasMineCommunicationReady());
});
const hasMineCachedSnapshot = () => {
  const metrics = userStore.latestMetrics || {};
  const healthData = userStore.healthData || {};
  return Boolean(
    metrics.battery != null ||
      metrics.firmwareVersion ||
      metrics.softwareVersion ||
      metrics.heartRate != null ||
      metrics.bloodOxygen != null ||
      healthData.battery != null ||
      healthData.firmwareVersion ||
      healthData.softwareVersion ||
      healthData.heartRate != null ||
      healthData.bloodOxygen != null ||
      userStore.receivedData?.some((item: any) => item?.type === 'battery' || item?.type === 'firmware_version')
  );
};

onPageScroll((e) => {
  scrollTop.value = e.scrollTop;
});
    // Read bound device info.
type MineSnapshotRefreshOptions = {
  blocking?: boolean;
  force?: boolean;
};

const executeCommandsSequentially = async (options: MineSnapshotRefreshOptions = {}) => {
  if (userStore.isSending === true) {
    return;
  }

  if (!options.force && hasMineCachedSnapshot() && hasMineBatterySnapshot()) {
    return;
  }

  userStore.updateIsSending(true);
  const refreshTask = refreshMineDeviceSnapshot(options)
    .catch((error) => {
      logMineBleIssue(error, '\u8bbe\u5907\u6570\u636e\u6682\u672a\u8fd4\u56de');
    })
    .finally(() => {
      userStore.updateIsSending(false);
    });

  if (options.blocking) {
    await refreshTask;
  }
};
// @ts-ignore
let uploadTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => userStore.isUploading,
  (newVal) => {
    if (uploadTimer) clearTimeout(uploadTimer);

    if (userStore.uploadingStatus === 'success') {
      uploadTimer = setTimeout(() => {
        shouldHideProgress.value = true;
        uploadTimer = null;
      }, 1000);
    } else if (newVal === true || userStore.uploadingStatus === 'uploading') {
      // Show while uploading.
      shouldHideProgress.value = false;
    } else {
      // Hide immediately for other states.
      shouldHideProgress.value = true;
    }
  },
  { immediate: true }
);

const scanDevice = async () => {
  try {
    if (isLoading.value) {
      uni.showToast({
        title: '\u8fde\u63a5\u4e2d\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    const setting = await uni.getSetting();

    if (!setting.authSetting['scope.camera']) {
      await uni.authorize({
        scope: 'scope.camera'
      });
    }

    uni.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode', 'barCode'],
      success: (res) => {
        handleScanSuccess(res);
      },
      fail: (err) => {
        handleScanError(err);
      }
    });
  } catch (error) {
    const typedError = error as { errMsg?: string };
    if (typedError.errMsg && typedError.errMsg.includes('auth deny')) {
      uni.showModal({
        title: '\u63d0\u793a',
        content: '\u9700\u8981\u76f8\u673a\u6743\u9650\u624d\u80fd\u4f7f\u7528\u626b\u7801\u529f\u80fd\uff0c\u8bf7\u5728\u8bbe\u7f6e\u4e2d\u5f00\u542f\u6743\u9650',
        confirmText: '\u53bb\u8bbe\u7f6e',
        success: (res) => {
          if (res.confirm) {
            uni.openSetting();
          }
        }
      });
    } else {
      uni.showToast({
        title: '\u626b\u7801\u5931\u8d25',
        icon: 'none',
        duration: 2000
      });
    }
  }
};
// Handle scan success.
const handleScanSuccess = async (res: any) => {
  const result = res.result;

  uni.showToast({
    title: '\u626b\u7801\u6210\u529f',
    icon: 'success',
    duration: 1500
  });
  const scanRes = await scan({
    sn: result
  });
  if (scanRes) {
    await handleConnectDevice(scanRes.mac || '', scanRes.name || '', '', true);
    const { deviceId, serviceId } = userStore.deviceInfo;

    if (deviceId) {
      const alreadyConnected = await isDeviceConnected(deviceId, serviceId || '');

      if (alreadyConnected) {
        userStore.updateIsConnected(true);
        await refreshMineDeviceSnapshot({ force: true });
        return;
      }
      await autoConnectLastDevice();
      await refreshMineDeviceSnapshot({ force: true });
    } else {
    }
  }
};

// Handle scan error.
const handleScanError = (err: any) => {
  const errMsg = err.errMsg || '';

  if (errMsg.includes('cancel')) {
    return;
  } else if (errMsg.includes('auth deny')) {
    uni.showModal({
      title: '\u63d0\u793a',
      content: '\u76f8\u673a\u6743\u9650\u88ab\u62d2\u7edd\uff0c\u65e0\u6cd5\u4f7f\u7528\u626b\u7801\u529f\u80fd',
      confirmText: '\u53bb\u8bbe\u7f6e',
      success: (res) => {
        if (res.confirm) {
          uni.openSetting();
        }
      }
    });
  } else {
    uni.showToast({
      title: '\u626b\u7801\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5',
      icon: 'none',
      duration: 2000
    });
  }
};
const jumpDetail = () => {
  if (isLoading.value) {
    uni.showToast({
      title: '\u8fde\u63a5\u4e2d\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
      icon: 'none',
      duration: 2000
    });
    return;
  }
  uni.$uv.route('/pagesA/mines/connectDevice');
};const reconnectThrottle = () => {
  uni.$uv.throttle(async () => {
    userStore.updateIsManualReconnecting(true);
    userStore.updateReconnectResult(false);

    // await new Promise((resolve) => setTimeout(resolve, 500));
    // Disconnect before reconnect.
    await disconnect();
  }, 1000);
};
function logMineBleIssue(error: unknown, fallback: string) {
  if (isExpectedBleRuntimeError(error)) return;
  const message = formatBleErrorMessage(error, fallback);
  if (!message || message === fallback) return;
}

async function refreshMineDeviceSnapshot(options: MineSnapshotRefreshOptions = {}) {
  const hasCachedSnapshot = hasMineCachedSnapshot();
  const needsDeviceInfoRefresh = !hasMineBatterySnapshot() || !hasMineFirmwareSnapshot();
  if (!options.force && hasCachedSnapshot && !needsDeviceInfoRefresh) return;
  const isRwRing = getMineCurrentProtocol() === 'rw';
  const timeoutMs = isRwRing ? 35000 : 3500;

  try {
    await ensureCommunicationReady();
    await refreshHealthData({
      includeDeviceTime: false,
      includeCollectPeriod: false,
      includeDeviceInfo: needsDeviceInfoRefresh,
      includeRealtimeMetrics: isRwRing ? false : undefined,
      includeHistorySnapshot: isRwRing ? false : undefined,
      timeoutMs
    });
  } catch (error) {
    logMineBleIssue(error, '\u8bbe\u5907\u6570\u636e\u6682\u672a\u8fd4\u56de');
  }
}

const refreshMineRwDeviceInfoSnapshotInBackground = (reason: string) => {
  if (!isMineRwRing()) return;
  if (
    mineDeviceInfoSnapshotBusy.value ||
    historySyncBusy.value ||
    metricTestBusy.value ||
    protocolProbeBusy.value ||
    mineRwAcceptanceBusy.value ||
    userStore.isSending === true
  ) {
    appendMineDiagnosticLog('rw-device-info-background-refresh-skip', {
      reason,
      busy: {
        deviceInfo: mineDeviceInfoSnapshotBusy.value,
        history: historySyncBusy.value,
        metric: metricTestBusy.value,
        protocolProbe: protocolProbeBusy.value,
        acceptance: mineRwAcceptanceBusy.value,
        sending: userStore.isSending === true
      },
      snapshot: getMineConnectionSnapshot()
    });
    return;
  }
  mineDeviceInfoSnapshotBusy.value = true;
  appendMineDiagnosticLog('rw-device-info-background-refresh-start', {
    reason,
    snapshot: getMineConnectionSnapshot()
  });
  void refreshMineDeviceSnapshot({ force: false })
    .then(() => {
      appendMineDiagnosticLog('rw-device-info-background-refresh-result', {
        reason,
        battery: displayBatteryValue.value,
        hasBattery: hasMineBatterySnapshot(),
        hasFirmware: hasMineFirmwareSnapshot(),
        snapshot: getMineConnectionSnapshot()
      });
    })
    .finally(() => {
      mineDeviceInfoSnapshotBusy.value = false;
    });
};

const restoreMineDeviceSnapshot = async (options: { refreshAfterRestore?: boolean } = {}) => {
  appendMineDiagnosticLog('restore-start', {
    snapshot: getMineConnectionSnapshot()
  });
  try {
    userStore.updateReconnectingStatus('1');
    const restored = await autoConnectLastDevice();
    if (!restored) {
      userStore.updateIsConnected(false);
      userStore.updateReconnectingStatus('0');
      appendMineDiagnosticLog('restore-result', {
        restored: false,
        ready: hasMineCommunicationReady(),
        snapshot: getMineConnectionSnapshot()
      });
      return false;
    }
    if (!hasMineCommunicationReady()) {
      userStore.updateIsConnected(false);
      userStore.updateReconnectingStatus('0');
      appendMineDiagnosticLog('restore-result', {
        restored: true,
        ready: false,
        snapshot: getMineConnectionSnapshot()
      });
      return false;
    }

    userStore.updateIsConnected(true);
    userStore.updateReconnectingStatus('2');
    const shouldRefreshAfterRestore = options.refreshAfterRestore ?? !isMineRwRing();
    if (shouldRefreshAfterRestore) {
      await executeCommandsSequentially({ force: options.refreshAfterRestore === true });
    } else {
      appendMineDiagnosticLog('restore-skip-rw-auto-refresh', {
        snapshot: getMineConnectionSnapshot()
      });
      refreshMineRwDeviceInfoSnapshotInBackground('restore-rw-ready');
    }
    appendMineDiagnosticLog('restore-result', {
      restored: true,
      ready: true,
      snapshot: getMineConnectionSnapshot()
    });
    return true;
  } catch (error) {
    userStore.updateIsConnected(false);
    userStore.updateReconnectingStatus('0');
    appendMineDiagnosticLog('restore-error', {
      message: formatBleErrorMessage(error, '\u8bbe\u5907\u6682\u672a\u6062\u590d'),
      snapshot: getMineConnectionSnapshot()
    });
    logMineBleIssue(error, '\u8bbe\u5907\u6682\u672a\u6062\u590d');
    return false;
  }
};

const connectAgain = async () => {
  if (isLoading.value) return;
  appendMineDiagnosticLog('manual-reconnect-start', {
    snapshot: getMineConnectionSnapshot()
  });
  try {
    userStore.updateIsManualReconnecting(true);
    userStore.updateReconnectingStatus('1');
    userStore.updateIsSending(false);
    await initBluetooth();
    const success = await autoConnectLastDevice();
    if (!success) {
      throw new Error('\u672a\u53d1\u73b0\u53ef\u91cd\u8fde\u8bbe\u5907\uff0c\u8bf7\u9760\u8fd1\u6212\u6307\u540e\u91cd\u8bd5');
    }
    if (!hasMineCommunicationReady()) {
      throw new Error('\u8bbe\u5907\u5df2\u8fde\u63a5\uff0c\u4f46\u901a\u4fe1\u670d\u52a1\u672a\u5c31\u7eea\uff0c\u8bf7\u91cd\u8bd5');
    }
    userStore.updateIsManualReconnecting(false);
    userStore.updateIsConnected(true);
    userStore.updateReconnectingStatus('2');
    if (!isMineRwRing()) {
      await executeCommandsSequentially();
    } else {
      appendMineDiagnosticLog('manual-reconnect-skip-rw-auto-refresh', {
        snapshot: getMineConnectionSnapshot()
      });
      refreshMineRwDeviceInfoSnapshotInBackground('manual-reconnect-rw-ready');
    }
    appendMineDiagnosticLog('manual-reconnect-result', {
      success: true,
      snapshot: getMineConnectionSnapshot()
    });
  } catch (error) {
    userStore.updateIsManualReconnecting(false);
    userStore.updateReconnectingStatus('0');
    userStore.updateIsSending(false);
    appendMineDiagnosticLog('manual-reconnect-error', {
      message: formatBleErrorMessage(error, '\u8bbe\u5907\u6682\u672a\u6062\u590d'),
      snapshot: getMineConnectionSnapshot()
    });
    logMineBleIssue(error, '\u91cd\u8fde\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u8bbe\u5907\u72b6\u6001');
    uni.showToast({
      title: formatBleErrorMessage(error, '\u8bbe\u5907\u6682\u672a\u6062\u590d'),
      icon: 'none',
      duration: 3000
    });
  }
};
// 解除绑定
const unbindDevice = () => {
  if (!bindInfo.value || !bindInfo.value.mac) return;
  uni.showModal({
    title: '提示',
    content: '确定要解除绑定吗？',
    success: async (res) => {
      if (!res.confirm) return;
      try {
        uni.showLoading({ title: '解绑中...', mask: true });
        await unbind({ mac: bindInfo.value.mac });
        await disconnect();
        userStore.updateReconnectingStatus('0');
        userStore.updateIsManualReconnecting(false);
        bindInfo.value = null;
        await clearFrontendRingBindingState(userStore, ringStore);
        uni.showToast({ title: '解绑成功', icon: 'success', duration: 1500 });
      } catch (error: any) {
        console.error('解绑失败:', error);
        uni.showToast({
          title: error?.msg || error?.message || '解绑失败，请重试',
          icon: 'none',
          duration: 2000
        });
      } finally {
        uni.hideLoading();
      }
    }
  });
};

onShow(async () => {
  try {
    if (!userStore.token) {
      clearMineSleepProbeIsolationLock('mine-page-show-no-token');
      userStore.updateDeviceInfo({});
      userStore.updateReceivedData([]);
      return;
    }
    clearMineSleepProbeIsolationLock('mine-page-show');
    let boundInfo: any = null;
    // Read bound device info.
    try {
      boundInfo = await getBindInfo();
      bindInfo.value = boundInfo;
    } catch (error) {
      logMineBleIssue(error, '\u7ed1\u5b9a\u4fe1\u606f\u6682\u65f6\u65e0\u6cd5\u83b7\u53d6');
    }
    appendMineDiagnosticLog('page-show', {
      hasBoundIdentity: hasBoundRingIdentity(boundInfo),
      isLoading: isLoading.value,
      snapshot: getMineConnectionSnapshot()
    });

    if (!hasBoundRingIdentity(boundInfo)) {
      clearMineSleepProbeIsolationLock('mine-page-show-unbound');
      bindInfo.value = null;
      await clearFrontendRingBindingState(userStore, ringStore);
      appendMineDiagnosticLog('page-show-unbound', {
        snapshot: getMineConnectionSnapshot()
      });
      return;
    }

    if (isLoading.value) {
      appendMineDiagnosticLog('page-show-skip-loading', {
        snapshot: getMineConnectionSnapshot()
      });
      return;
    }
    const { deviceId, serviceId } = userStore.deviceInfo;
    if (deviceId && serviceId) {
      const alreadyConnected = await isDeviceConnected(deviceId, serviceId || '');
      if (alreadyConnected) {
        // Only run commands after the communication fields are ready.
        if (hasMineCommunicationReady()) {
          userStore.updateIsConnected(true);
          userStore.updateReconnectingStatus('2');
          appendMineDiagnosticLog('page-show-already-connected', {
            snapshot: getMineConnectionSnapshot()
          });
          if (!isMineRwRing()) {
            await executeCommandsSequentially();
          } else {
            appendMineDiagnosticLog('page-show-skip-rw-auto-refresh', {
              snapshot: getMineConnectionSnapshot()
            });
            refreshMineRwDeviceInfoSnapshotInBackground('page-show-rw-ready');
          }
        } else {
          await restoreMineDeviceSnapshot();
        }
        return;
      }
      await restoreMineDeviceSnapshot();
    } else {
      if (hasBoundRingIdentity(boundInfo)) {
        await restoreMineDeviceSnapshot();
      } else {
        const restored = await restoreMineDeviceSnapshot();
        if (!restored) {
          userStore.updateDeviceInfo({});
          userStore.updateReceivedData([]);
        }
      }
    }
  } catch (error) {
    logMineBleIssue(error, '\u8bbe\u5907\u6682\u672a\u6062\u590d');
  }
});

onHide(() => {
  clearMineSleepProbeIsolationLock('mine-page-hide');
});

onPullDownRefresh(async () => {
  try {
    if (!userStore.token) {
      userStore.updateDeviceInfo({});
      userStore.updateReceivedData([]);
      return;
    }
    if (isLoading.value) {
      uni.showToast({
        title: '\u8fde\u63a5\u4e2d\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
        icon: 'none',
        duration: 2000
      });
      return;
    }
    userStore.fetchUserInfo();
    const boundInfo = await getBindInfo();
    bindInfo.value = boundInfo;
    if (!hasBoundRingIdentity(boundInfo)) {
      await clearFrontendRingBindingState(userStore, ringStore);
      return;
    }

    const { deviceId, serviceId } = userStore.deviceInfo;

    if (deviceId) {
      uni.showLoading({
        title: '\u5237\u65b0\u4e2d...',
        mask: true
      });
      const alreadyConnected = await isDeviceConnected(deviceId, serviceId || '');

      if (alreadyConnected) {
        if (hasMineCommunicationReady()) {
          userStore.updateIsConnected(true);
          userStore.updateReconnectingStatus('2');
          await executeCommandsSequentially({ force: true, blocking: true });
        } else {
          await restoreMineDeviceSnapshot({ refreshAfterRestore: true });
        }
        uni.hideLoading();
        uni.stopPullDownRefresh();
        return;
      }
      await restoreMineDeviceSnapshot({ refreshAfterRestore: true });

      uni.hideLoading();
    }
  } catch (error) {
    uni.hideLoading();
    if (!isExpectedBleRuntimeError(error)) {
      uni.showToast({
        title: formatBleErrorMessage(error, '\u8bbe\u5907\u6682\u672a\u6062\u590d'),
        icon: 'none',
        duration: 2000
      });
    }
  } finally {
    uni.stopPullDownRefresh();
  }
});
const showMineRwBusyToast = (action: string) => {
  const message = '\u8bbe\u5907\u547d\u4ee4\u6267\u884c\u4e2d\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5';
  rwDiagnosticActionText.value = message;
  appendMineDiagnosticLog('manual-action-skip-busy', {
    action,
    snapshot: getMineConnectionSnapshot()
  });
  uni.showToast({
    title: message,
    icon: 'none',
    duration: 2000
  });
};
const runMineProtocolProbeCommand = async (command: MineProtocolProbeCommand, index: number, total: number) => {
  const timeoutMs = command.timeoutMs ?? 10000;
  const delayAfterMs = command.delayAfterMs ?? 700;
  const pollAtMs = command.pollAtMs?.filter((item) => Number.isFinite(item) && item >= 0).sort((left, right) => left - right);
  const pollResponseGraceMs = command.pollResponseGraceMs ?? 250;
  const bytes = command.build();
  const hex = bytesToHex(bytes);
  const family = command.family || getMineProtocolProbeFamily(command.key);
  const required = command.required !== false;
  const startedAt = Date.now();
  let wrote = false;
  let lastAttempt: number | undefined;
  const attemptCount = pollAtMs?.length;
  activeProtocolProbeLabel.value = `${index + 1}/${total} ${command.label}`;
  rwDiagnosticActionText.value = activeProtocolProbeLabel.value;
  appendMineDiagnosticLog('protocol-probe-command-start', {
    index: index + 1,
    total,
    key: command.key,
    label: command.label,
    family,
    required,
    expected: command.expected,
    hex,
    timeoutMs,
    writeOnlyOk: command.writeOnlyOk === true ? true : undefined,
    pollAtMs,
    pollResponseGraceMs: pollAtMs?.length ? pollResponseGraceMs : undefined,
    snapshot: getMineProtocolProbeSnapshot()
  });

  const waitTask = waitForParsedData(command.predicate, timeoutMs);
  waitTask.catch(() => undefined);
  const waitForResponseOrDelay = async (delayMs: number) =>
    Promise.race([
      waitTask.then((parsed) => ({ parsed })),
      sleepMineProtocolProbe(Math.max(0, delayMs)).then(() => null)
    ]);
  const appendResponse = (parsed: RingParsedData) => {
    const elapsedMs = Date.now() - startedAt;
    const parsedSummary = summarizeMineParsedData(parsed);
    const rawResponseHex = parsedSummary?.rawHex;
    appendMineDiagnosticLog('protocol-probe-command-response', {
      index: index + 1,
      total,
      key: command.key,
      label: command.label,
      family,
      required,
      expected: command.expected,
      hex,
      elapsedMs,
      rawResponseHex,
      rawResponsePacket: rawResponseHex,
      parsed: parsedSummary,
      snapshot: getMineProtocolProbeSnapshot()
    });
    return {
      ok: true,
      index: index + 1,
      total,
      key: command.key,
      label: command.label,
      family,
      required,
      expected: command.expected,
      hex,
      elapsedMs,
      timeoutMs,
      attempt: lastAttempt,
      attemptCount,
      wrote,
      rawResponseHex,
      rawResponsePacket: rawResponseHex,
      parsed: parsedSummary,
      timeout: false,
      message: ''
    };
  };

  try {
    if (command.writeOnlyOk) {
      await sendBytes(bytes, `protocol-probe/${command.key}`);
      wrote = true;
      const elapsedMs = Date.now() - startedAt;
      appendMineDiagnosticLog('protocol-probe-command-write-ok', {
        index: index + 1,
        total,
        key: command.key,
        label: command.label,
        family,
        required,
        expected: command.expected,
        hex,
        elapsedMs,
        timeoutMs,
        snapshot: getMineProtocolProbeSnapshot()
      });
      return {
        ok: true,
        index: index + 1,
        total,
        key: command.key,
        label: command.label,
        family,
        required,
        expected: command.expected,
        hex,
        elapsedMs,
        timeoutMs,
        wrote,
        writeOnly: true,
        timeout: false,
        message: ''
      };
    }

    if (pollAtMs?.length) {
      let elapsed = 0;
      for (let attemptIndex = 0; attemptIndex < pollAtMs.length; attemptIndex += 1) {
        const currentMs = pollAtMs[attemptIndex];
        const beforePoll = await waitForResponseOrDelay(currentMs - elapsed);
        if (beforePoll) return appendResponse(beforePoll.parsed as RingParsedData);
        elapsed = currentMs;
        lastAttempt = attemptIndex + 1;
        appendMineDiagnosticLog('protocol-probe-command-poll', {
          index: index + 1,
          total,
          attempt: attemptIndex + 1,
          attemptCount: pollAtMs.length,
          key: command.key,
          label: command.label,
          family,
          required,
          expected: command.expected,
          hex,
          elapsedMs: currentMs,
          timeoutMs,
          snapshot: getMineProtocolProbeSnapshot()
        });
        await sendBytes(bytes, `protocol-probe/${command.key}/poll-${attemptIndex + 1}`);
        wrote = true;
        const afterPoll = await waitForResponseOrDelay(pollResponseGraceMs);
        if (afterPoll) return appendResponse(afterPoll.parsed as RingParsedData);
      }
      return appendResponse(await waitTask);
    }

    await sendBytes(bytes, `protocol-probe/${command.key}`);
    wrote = true;
    return appendResponse(await waitTask);
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const rawMessage = mineErrorToString(error);
    const isTimeout = wrote && /timeout|\u8d85\u65f6/i.test(rawMessage);
    appendMineDiagnosticLog(isTimeout ? 'protocol-probe-command-timeout' : 'protocol-probe-command-error', {
      index: index + 1,
      total,
      key: command.key,
      label: command.label,
      family,
      required,
      expected: command.expected,
      hex,
      elapsedMs,
      timeoutMs,
      wrote,
      rawMessage,
      message: formatBleErrorMessage(error, required ? '\u5fc5\u9a8c\u547d\u4ee4\u672a\u8fd4\u56de' : '\u517c\u5bb9\u547d\u4ee4\u672a\u8fd4\u56de'),
      snapshot: getMineProtocolProbeSnapshot()
    });
    return {
      ok: false,
      index: index + 1,
      total,
      key: command.key,
      label: command.label,
      family,
      required,
      expected: command.expected,
      hex,
      elapsedMs,
      timeoutMs,
      attempt: lastAttempt,
      attemptCount,
      wrote,
      timeout: isTimeout,
      message: rawMessage
    };
  } finally {
    if (delayAfterMs > 0) await sleepMineProtocolProbe(delayAfterMs);
  }
};
const compactMineProtocolProbeResult = (item: Record<string, any>) => ({
  i: item.index,
  t: item.total,
  k: item.key,
  f: item.family,
  r: item.required === true ? 1 : item.required === false ? 0 : undefined,
  x: trimMineDiagnosticText(item.expected, 64),
  h: item.hex,
  s: item.ok === true ? 'ok' : item.timeout === true ? 'timeout' : 'error',
  ms: item.elapsedMs,
  a: item.attempt,
  ac: item.attemptCount,
  to: item.timeoutMs,
  w: item.wrote === true ? 1 : item.wrote === false ? 0 : undefined,
  wo: item.writeOnly === true ? 1 : undefined,
  m: trimMineDiagnosticText(item.message, 80),
  rh: item.rawResponseHex || item.rawResponsePacket || item.parsed?.rawHex,
  p: item.parsed
    ? {
        t: item.parsed.type,
        n: item.parsed.name,
        s: item.parsed.status,
        code: item.parsed.statusCode,
        v: item.parsed.value,
        bat: item.parsed.battery,
        hr: item.parsed.heartRate,
        spo2: item.parsed.bloodOxygen,
        step: item.parsed.stepCount,
        slp: item.parsed.sleepState,
        sls: item.parsed.sleepStatus,
        dur: item.parsed.durationMinutes,
        fw: item.parsed.firmwareVersion,
        hw: item.parsed.hardwareVersion,
        sw: item.parsed.softwareVersion,
        ui: item.parsed.uiVersion,
        c: item.parsed.recordCount,
        rds: item.parsed.rawDataTypes,
        rec: item.parsed.recordSample,
        raw: item.parsed.rawHex
      }
    : undefined
});
const handleMineProtocolProbe = async (mode: MineProtocolProbeMode = 'core', options: MineRwDiagnosticActionOptions = {}) => {
  if (!options.fromAcceptance && (isMineRwActionBusy.value || mineRwAcceptanceBusy.value) && !protocolProbeBusy.value) {
    showMineRwBusyToast('protocol-probe');
    return { ok: false, skipped: true, message: '\u8bbe\u5907\u547d\u4ee4\u6267\u884c\u4e2d' };
  }
  if (protocolProbeBusy.value) return { ok: false, skipped: true, message: '\u81ea\u68c0\u6b63\u5728\u8fd0\u884c' };
  protocolProbeBusy.value = true;
  activeProtocolProbeMode.value = mode;
  activeProtocolProbeLabel.value = '';
  rwDiagnosticActionText.value = `${getMineProtocolProbeModeLabel(mode)}\u4e2d`;
  userStore.updateIsSending(true);
  const commands = createMineProtocolProbeCommands(mode);
  const requiredCommandCount = commands.filter((command) => command.required !== false).length;
  const optionalCommandCount = commands.length - requiredCommandCount;
  const commandPlan = summarizeMineProtocolProbeCommandPlan(commands);
  const singleCommandProbe = commands.length === 1;
  const historyIdleTimeoutMs = singleCommandProbe
    ? MINE_PROTOCOL_PROBE_SINGLE_HISTORY_IDLE_TIMEOUT_MS
    : MINE_PROTOCOL_PROBE_HISTORY_IDLE_TIMEOUT_MS;
  const blockedCommandPreview = commands.map((command, index) => ({
    index: index + 1,
    key: command.key,
    label: command.label,
    family: command.family,
    required: command.required !== false
  }));
  const diagnosticLockOwner = `mine-protocol-probe:${mode}:${Date.now()}`;
  const diagnosticLock = setRwDiagnosticCommandLock({
    owner: diagnosticLockOwner,
    reason: 'mine-protocol-probe',
    mode,
    ttlMs: MINE_PROTOCOL_PROBE_DIAGNOSTIC_LOCK_TTL_MS
  });
  controller.pauseBusinessAutoRefresh();
  appendMineDiagnosticLog('protocol-probe-start', {
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    mode,
    commandCount: commands.length,
    requiredCommandCount,
    optionalCommandCount,
    singleCommandProbe,
    historyIdleTimeoutMs,
    skipped: ['format-file-system', 'delete-all-local-data', 'factory-reset'],
    skipReason: '\u7834\u574f\u6027\u547d\u4ee4\u4e0d\u5728\u771f\u673a\u81ea\u68c0\u4e2d\u6267\u884c',
    diagnosticLock,
    snapshot: getMineProtocolProbeSnapshot()
  });
  appendMineDiagnosticLog('protocol-probe-diagnostic-lock-set', {
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    mode,
    lock: diagnosticLock,
    autoRefreshPaused: true
  });
  appendMineDiagnosticLog('protocol-probe-plan', {
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    mode,
    commandCount: commands.length,
    requiredCommandCount,
    optionalCommandCount,
    required: commandPlan.required,
    optional: commandPlan.optional,
    families: commandPlan.families,
    singleCommandProbe,
    historyIdleTimeoutMs
  });
  try {
    const readyBeforeRestore = hasMineCommunicationReady();
    let restoredForProbe = false;
    if (!hasMineCommunicationReady()) {
      const restored = await restoreMineDeviceSnapshot({ refreshAfterRestore: false });
      restoredForProbe = true;
      if (!restored || !hasMineCommunicationReady()) {
        throw new Error('\u8bbe\u5907\u901a\u4fe1\u672a\u5c31\u7eea\uff0c\u8bf7\u91cd\u8fde\u540e\u518d\u81ea\u68c0');
      }
    }
    const settleMs = readyBeforeRestore || !restoredForProbe ? MINE_PROTOCOL_PROBE_READY_SETTLE_MS : MINE_PROTOCOL_PROBE_RESTORE_SETTLE_MS;
    if (settleMs > 0) {
      appendMineDiagnosticLog('protocol-probe-ready-settle', {
        buildTag: RW_DIAGNOSTIC_BUILD_TAG,
        mode,
        restoredForProbe,
        readyBeforeRestore,
        settleMs,
        snapshot: getMineProtocolProbeSnapshot()
      });
      await sleepMineProtocolProbe(settleMs);
    }

    activeProtocolProbeLabel.value = '\u7b49\u5f85\u5386\u53f2\u540c\u6b65\u7a7a\u95f2';
    rwDiagnosticActionText.value = activeProtocolProbeLabel.value;
    const historyIdleStartedAt = Date.now();
    const historyIdle = await waitForRwCompatHistoryIdle(
      historyIdleTimeoutMs,
      MINE_PROTOCOL_PROBE_HISTORY_QUIET_MS
    ).catch((error: unknown) => {
      appendMineDiagnosticLog('protocol-probe-history-idle-error', {
        buildTag: RW_DIAGNOSTIC_BUILD_TAG,
        mode,
        singleCommandProbe,
        timeoutMs: historyIdleTimeoutMs,
        quietMs: MINE_PROTOCOL_PROBE_HISTORY_QUIET_MS,
        message: mineErrorToString(error)
      });
      return false;
    });
    appendMineDiagnosticLog('protocol-probe-history-idle', {
      buildTag: RW_DIAGNOSTIC_BUILD_TAG,
      mode,
      idle: historyIdle,
      elapsedMs: Date.now() - historyIdleStartedAt,
      timeoutMs: historyIdleTimeoutMs,
      quietMs: MINE_PROTOCOL_PROBE_HISTORY_QUIET_MS,
      singleCommandProbe
    });
    if (!historyIdle) {
      const message = '\u5386\u53f2\u540c\u6b65\u672a\u7a7a\u95f2\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u5355\u547d\u4ee4';
      appendMineDiagnosticLog('protocol-probe-history-busy', {
        buildTag: RW_DIAGNOSTIC_BUILD_TAG,
        mode,
        message,
        elapsedMs: Date.now() - historyIdleStartedAt,
        timeoutMs: historyIdleTimeoutMs,
        quietMs: MINE_PROTOCOL_PROBE_HISTORY_QUIET_MS,
        singleCommandProbe,
        blockedBeforeTx: true,
        commandSent: false,
        commands: blockedCommandPreview,
        snapshot: getMineConnectionSnapshot()
      });
      throw new Error(message);
    }

    activeProtocolProbeLabel.value = '\u7b49\u5f85\u8bbe\u5907\u4fe1\u606f\u5237\u65b0\u7a7a\u95f2';
    rwDiagnosticActionText.value = activeProtocolProbeLabel.value;
    const businessIdleStartedAt = Date.now();
    const businessIdle = await waitForMineBusinessRefreshIdle(
      MINE_PROTOCOL_PROBE_BUSINESS_IDLE_TIMEOUT_MS,
      MINE_PROTOCOL_PROBE_BUSINESS_QUIET_MS
    ).catch((error: unknown) => {
      appendMineDiagnosticLog('protocol-probe-business-idle-error', {
        buildTag: RW_DIAGNOSTIC_BUILD_TAG,
        mode,
        singleCommandProbe,
        timeoutMs: MINE_PROTOCOL_PROBE_BUSINESS_IDLE_TIMEOUT_MS,
        quietMs: MINE_PROTOCOL_PROBE_BUSINESS_QUIET_MS,
        message: mineErrorToString(error)
      });
      return false;
    });
    appendMineDiagnosticLog('protocol-probe-business-idle', {
      buildTag: RW_DIAGNOSTIC_BUILD_TAG,
      mode,
      idle: businessIdle,
      elapsedMs: Date.now() - businessIdleStartedAt,
      timeoutMs: MINE_PROTOCOL_PROBE_BUSINESS_IDLE_TIMEOUT_MS,
      quietMs: MINE_PROTOCOL_PROBE_BUSINESS_QUIET_MS,
      singleCommandProbe
    });
    if (!businessIdle) {
      const message = '\u8bbe\u5907\u4fe1\u606f\u5237\u65b0\u672a\u7a7a\u95f2\uff0c\u672c\u6b21\u672a\u53d1\u51fa\u5355\u547d\u4ee4';
      appendMineDiagnosticLog('protocol-probe-business-busy', {
        buildTag: RW_DIAGNOSTIC_BUILD_TAG,
        mode,
        message,
        elapsedMs: Date.now() - businessIdleStartedAt,
        timeoutMs: MINE_PROTOCOL_PROBE_BUSINESS_IDLE_TIMEOUT_MS,
        quietMs: MINE_PROTOCOL_PROBE_BUSINESS_QUIET_MS,
        singleCommandProbe,
        blockedBeforeTx: true,
        commandSent: false,
        commands: blockedCommandPreview,
        snapshot: getMineConnectionSnapshot()
      });
      throw new Error(message);
    }

    const results = [];
    for (let index = 0; index < commands.length; index += 1) {
      results.push(await runMineProtocolProbeCommand(commands[index], index, commands.length));
    }
    const okCount = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => !item.ok);
    const requiredResults = results.filter((item) => item.required !== false);
    const optionalResults = results.filter((item) => item.required === false);
    const requiredOkCount = requiredResults.filter((item) => item.ok).length;
    const optionalOkCount = optionalResults.filter((item) => item.ok).length;
    const requiredFailed = requiredResults.filter((item) => !item.ok);
    const optionalFailed = optionalResults.filter((item) => !item.ok);
    const compactResults = results.map(compactMineProtocolProbeResult);
    const resultFamilies = summarizeMineProtocolProbeGroups(
      results.map((item, index) => ({
        index: index + 1,
        key: item.key,
        label: item.label,
        family: item.family,
        required: item.required !== false,
        ok: item.ok === true,
        timeout: item.timeout === true
      }))
    );
    appendMineDiagnosticLog('protocol-probe-summary', {
      buildTag: RW_DIAGNOSTIC_BUILD_TAG,
      mode,
      okCount,
      failedCount: failed.length,
      requiredOkCount,
      requiredFailedCount: requiredFailed.length,
      requiredCommandCount,
      optionalOkCount,
      optionalFailedCount: optionalFailed.length,
      optionalCommandCount,
      families: resultFamilies,
      requiredCommands: compactResults.filter((item) => item.r === 1),
      failedCommands: compactResults.filter((item) => item.s !== 'ok'),
      failed: failed.map((item) => ({
        key: item.key,
        label: item.label,
        family: item.family,
        required: item.required,
        timeout: item.timeout,
        message: item.message
      })),
      snapshot: getMineConnectionSnapshot()
    });
    rwDiagnosticActionText.value = requiredFailed.length > 0
      ? `\u81ea\u68c0\u5b8c\u6210 \u5fc5\u9a8c${requiredOkCount}/${requiredCommandCount}\uff0c${requiredFailed.length}\u6761\u5fc5\u9a8c\u672a\u8fd4\u56de`
      : optionalFailed.length > 0
        ? `\u81ea\u68c0\u5b8c\u6210 \u5fc5\u9a8c${requiredOkCount}/${requiredCommandCount}\uff0c\u517c\u5bb9${optionalFailed.length}\u6761\u672a\u8fd4\u56de`
        : `\u81ea\u68c0\u5b8c\u6210 \u5fc5\u9a8c${requiredOkCount}/${requiredCommandCount}`;
    if (!options.silentToast) {
      uni.showToast({
        title: rwDiagnosticActionText.value,
        icon: 'none',
        duration: 3000
      });
    }
    return {
      ok: requiredFailed.length === 0,
      mode,
      okCount,
      failedCount: failed.length,
      requiredOkCount,
      requiredCommandCount,
      requiredFailedCount: requiredFailed.length,
      optionalFailedCount: optionalFailed.length
    };
  } catch (error) {
    const message = formatBleErrorMessage(error, '\u534f\u8bae\u81ea\u68c0\u5931\u8d25');
    appendMineDiagnosticLog('protocol-probe-failed', {
      mode,
      message,
      rawMessage: mineErrorToString(error),
      snapshot: getMineConnectionSnapshot()
    });
    rwDiagnosticActionText.value = message;
    if (!options.silentToast) {
      uni.showToast({
        title: message,
        icon: 'none',
        duration: 3000
      });
    }
    return { ok: false, mode, message, rawMessage: mineErrorToString(error) };
  } finally {
    const lockCleared = clearRwDiagnosticCommandLock(diagnosticLockOwner);
    const keepSleepProbeIsolated = MINE_SLEEP_PROTOCOL_PROBE_ISOLATION_LOCK && (mode === 'sleepHistory' || mode === 'sleepSdkHistory' || mode === 'sleepNativeDetail' || mode === 'sleepNativeList' || mode === 'sleepEnhanceRead' || mode === 'sleepActivityCurrentDay' || mode === 'sleepContinueHistory' || mode === 'rawSleepHistory' || mode === 'sleepDelete');
    if (keepSleepProbeIsolated) {
      setMineSleepProbeIsolationLock('sleep-probe-finished');
    } else {
      controller.resumeBusinessAutoRefresh();
    }
    appendMineDiagnosticLog('protocol-probe-diagnostic-lock-clear', {
      buildTag: RW_DIAGNOSTIC_BUILD_TAG,
      mode,
      owner: diagnosticLockOwner,
      cleared: lockCleared,
      autoRefreshPaused: keepSleepProbeIsolated
    });
    protocolProbeBusy.value = false;
    activeProtocolProbeMode.value = '';
    activeProtocolProbeLabel.value = '';
    userStore.updateIsSending(false);
  }
};
const handleMineMetricTest = async (metric: MineMetricTestItem, options: MineRwDiagnosticActionOptions = {}) => {
  if (!options.fromAcceptance && (isMineRwActionBusy.value || mineRwAcceptanceBusy.value)) {
    showMineRwBusyToast(`metric:${metric.name}`);
    return { ok: false, skipped: true, metric: metric.name, message: '\u8bbe\u5907\u547d\u4ee4\u6267\u884c\u4e2d' };
  }
  const expectedKey = getRwForegroundMetricExpectedKey(metric.name);
  metricTestBusy.value = true;
  activeMetricTestName.value = metric.name;
  latestMineMetricResult.value = null;
  rwDiagnosticActionText.value = `${metric.label}\u6d4b\u91cf\u4e2d`;
  userStore.updateIsSending(true);
  appendMineDiagnosticLog('manual-metric-start', {
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    metric: metric.name,
    label: metric.label,
    expectedKey,
    snapshot: getMineConnectionSnapshot()
  });
  try {
    if (!hasMineCommunicationReady()) {
      const restored = await restoreMineDeviceSnapshot({ refreshAfterRestore: false });
      if (!restored || !hasMineCommunicationReady()) {
        throw new Error('\u8bbe\u5907\u901a\u4fe1\u672a\u5c31\u7eea\uff0c\u8bf7\u91cd\u8fde\u540e\u518d\u6d4b');
      }
    }

    const parsed = await runRwForegroundMeasurement(metric.name, {
      source: 'RW MINE',
      measureStatus: () => rwDiagnosticActionText.value
    });
    const value = getRwForegroundMetricValue(metric.name, parsed);
    const displayText = value != null ? formatRwForegroundMetricResult(metric.name, value) : '\u7b49\u5f85\u8bbe\u5907\u8fd4\u56de';
    latestMineMetricResult.value = {
      metric: metric.name,
      label: metric.label,
      expectedKey,
      value,
      displayText,
      parsed: summarizeMineParsedData(parsed)
    };
    appendMineDiagnosticLog('manual-metric-result', {
      ...latestMineMetricResult.value,
      snapshot: getMineConnectionSnapshot()
    });
    rwDiagnosticActionText.value = value != null ? `${metric.label}: ${displayText}` : `${metric.label}\u672a\u8fd4\u56de`;
    if (!options.silentToast) {
      uni.showToast({
        title: rwDiagnosticActionText.value,
        icon: 'none',
        duration: 2500
      });
    }
    return { ok: value != null, metric: metric.name, label: metric.label, expectedKey, value, displayText };
  } catch (error) {
    const message = formatBleErrorMessage(error, `${metric.label}\u6d4b\u91cf\u5931\u8d25\uff0c\u8bf7\u91cd\u8fde\u540e\u518d\u8bd5`);
    appendMineDiagnosticLog('manual-metric-failed', {
      metric: metric.name,
      label: metric.label,
      expectedKey,
      message,
      snapshot: getMineConnectionSnapshot()
    });
    rwDiagnosticActionText.value = message;
    if (!options.silentToast) {
      uni.showToast({
        title: message,
        icon: 'none',
        duration: 3000
      });
    }
    return { ok: false, metric: metric.name, label: metric.label, expectedKey, message };
  } finally {
    await stopActiveRwMeasurement('RW MINE').catch(() => undefined);
    userStore.updateIsSending(false);
    metricTestBusy.value = false;
    activeMetricTestName.value = '';
  }
};
const handleMineHistorySync = async (historyType: MineHistorySyncItem = mineHistorySummaryItem, options: MineRwDiagnosticActionOptions = {}) => {
  if (!options.fromAcceptance && (isMineRwActionBusy.value || mineRwAcceptanceBusy.value)) {
    showMineRwBusyToast(`history:${historyType.key}`);
    return { ok: false, skipped: true, historyKey: historyType.key, message: '\u8bbe\u5907\u547d\u4ee4\u6267\u884c\u4e2d' };
  }
  const dataTypes = Array.isArray(historyType.dataTypes) ? historyType.dataTypes : [];
  const historyDetails = {
    historyKey: historyType.key,
    historyLabel: historyType.label,
    ...(historyType.dataType ? { dataType: historyType.dataType } : {}),
    ...(dataTypes.length > 0 ? { dataTypes } : {})
  };
  const historyOptions = {
    ...(historyType.dataType ? { dataType: historyType.dataType } : {}),
    ...(dataTypes.length > 0 ? { dataTypes } : {})
  };
  historySyncBusy.value = true;
  activeHistorySyncKey.value = historyType.key;
  rwDiagnosticActionText.value = `${historyType.label}\u540c\u6b65\u4e2d`;
  userStore.updateIsSending(true);
  appendMineDiagnosticLog('manual-history-sync-start', {
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    ...historyDetails,
    snapshot: getMineConnectionSnapshot()
  });
  try {
    const result = await controller.syncBusinessHistory(false, historyOptions);
    const summary = summarizeMineHistoryResult(result as Record<string, any>);
    const recordCount = Number(summary?.recordCount || 0);
    appendMineDiagnosticLog('manual-history-sync-result', {
      ...historyDetails,
      summary,
      snapshot: getMineConnectionSnapshot()
    });
    rwDiagnosticActionText.value = recordCount > 0
      ? `${historyType.label}\u540c\u6b65\u5b8c\u6210 ${recordCount}\u6761`
      : `${historyType.label}\u540c\u6b65\u5b8c\u6210\uff0c\u6682\u65e0\u8bb0\u5f55`;
    if (!options.silentToast) {
      uni.showToast({
        title: rwDiagnosticActionText.value,
        icon: 'none',
        duration: 2500
      });
    }
    return { ok: recordCount > 0, historyKey: historyType.key, label: historyType.label, recordCount, summary };
  } catch (error) {
    const message = formatBleErrorMessage(error, '\u8bbe\u5907\u6682\u672a\u6062\u590d');
    appendMineDiagnosticLog('manual-history-sync-failed', {
      ...historyDetails,
      message,
      snapshot: getMineConnectionSnapshot()
    });
    rwDiagnosticActionText.value = message;
    if (!options.silentToast) {
      uni.showToast({
        title: message,
        icon: 'none',
        duration: 3000
      });
    }
    return { ok: false, historyKey: historyType.key, label: historyType.label, message };
  } finally {
    userStore.updateIsSending(false);
    historySyncBusy.value = false;
    activeHistorySyncKey.value = '';
  }
};

const compactMineRwL19AcceptanceResult = (item: Record<string, any>) => {
  const result = item.result || {};
  const summary = result.summary || {};
  const compact: Record<string, any> = {
    key: item.key,
    label: item.label,
    ok: item.ok === true,
    elapsedMs: item.elapsedMs,
    metric: result.metric,
    historyKey: result.historyKey,
    value: result.value,
    recordCount: result.recordCount ?? summary.recordCount,
    rawRecordCount: summary.rawRecordCount,
    submitRecordCount: summary.submitRecordCount,
    uploaded: summary.uploaded ?? result.uploaded,
    requiredOkCount: result.requiredOkCount,
    requiredCommandCount: result.requiredCommandCount,
    requiredFailedCount: result.requiredFailedCount,
    optionalFailedCount: result.optionalFailedCount,
    message: result.message || item.message
  };
  return Object.fromEntries(Object.entries(compact).filter(([, value]) => value !== undefined && value !== null && value !== ''));
};

const handleMineRwL19Acceptance = async () => {
  if (mineRwAcceptanceBusy.value || isMineRwActionBusy.value) {
    showMineRwBusyToast('rw-l19-acceptance');
    return;
  }
  const startedAt = Date.now();
  const metricSteps = mineMetricTestItems;
  const historySteps = mineHistorySyncItems.filter((item) => ['sleep', 'activity', 'stress', 'vital'].includes(item.key));
  const steps = [
    { key: 'core-protocol', label: '\u6838\u5fc3\u81ea\u68c0' },
    ...metricSteps.map((item) => ({ key: `metric:${item.name}`, label: `${item.label}\u6d4b\u91cf` })),
    ...historySteps.map((item) => ({ key: `history:${item.key}`, label: `${item.label}\u5386\u53f2` }))
  ];
  const results: Array<Record<string, any>> = [];
  mineRwAcceptanceBusy.value = true;
  activeMineRwAcceptanceStep.value = 'RW/L19\u9a8c\u6536\u4e2d';
  rwDiagnosticActionText.value = activeMineRwAcceptanceStep.value;
  appendMineDiagnosticLog('rw-l19-acceptance-start', {
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    stepCount: steps.length,
    steps,
    snapshot: getMineConnectionSnapshot()
  });

  const runAcceptanceStep = async (key: string, label: string, action: () => Promise<Record<string, any> | undefined>) => {
    const stepStartedAt = Date.now();
    activeMineRwAcceptanceStep.value = label;
    rwDiagnosticActionText.value = label;
    appendMineDiagnosticLog('rw-l19-acceptance-step-start', {
      key,
      label,
      snapshot: getMineConnectionSnapshot()
    });
    try {
      const result = (await action()) || { ok: false, message: '\u672a\u8fd4\u56de\u6267\u884c\u7ed3\u679c' };
      const row = {
        key,
        label,
        ok: result.ok === true,
        elapsedMs: Date.now() - stepStartedAt,
        result
      };
      results.push(row);
      appendMineDiagnosticLog('rw-l19-acceptance-step-result', {
        ...row,
        snapshot: getMineConnectionSnapshot()
      });
      return row;
    } catch (error) {
      const row = {
        key,
        label,
        ok: false,
        elapsedMs: Date.now() - stepStartedAt,
        message: formatBleErrorMessage(error, '\u9a8c\u6536\u6b65\u9aa4\u5931\u8d25'),
        rawMessage: mineErrorToString(error)
      };
      results.push(row);
      appendMineDiagnosticLog('rw-l19-acceptance-step-failed', {
        ...row,
        snapshot: getMineConnectionSnapshot()
      });
      return row;
    }
  };

  try {
    await runAcceptanceStep('core-protocol', '\u6838\u5fc3\u81ea\u68c0', () => handleMineProtocolProbe('core', { fromAcceptance: true, silentToast: true }));
    for (const metric of metricSteps) {
      await runAcceptanceStep(`metric:${metric.name}`, `${metric.label}\u6d4b\u91cf`, () => handleMineMetricTest(metric, { fromAcceptance: true, silentToast: true }));
    }
    for (const historyType of historySteps) {
      await runAcceptanceStep(`history:${historyType.key}`, `${historyType.label}\u5386\u53f2`, () => handleMineHistorySync(historyType, { fromAcceptance: true, silentToast: true }));
    }
    const okCount = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => !item.ok);
    const compactResults = results.map(compactMineRwL19AcceptanceResult);
    appendMineDiagnosticLog('rw-l19-acceptance-summary', {
      buildTag: RW_DIAGNOSTIC_BUILD_TAG,
      okCount,
      failedCount: failed.length,
      stepCount: steps.length,
      elapsedMs: Date.now() - startedAt,
      results: compactResults,
      failed: compactResults.filter((item) => item.ok !== true),
      snapshot: getMineConnectionSnapshot()
    });
    rwDiagnosticActionText.value = failed.length > 0
      ? `RW/L19\u9a8c\u6536\u5b8c\u6210 ${okCount}/${steps.length}\uff0c${failed.length}\u9879\u672a\u901a\u8fc7`
      : `RW/L19\u9a8c\u6536\u901a\u8fc7 ${okCount}/${steps.length}`;
    uni.showToast({
      title: rwDiagnosticActionText.value,
      icon: 'none',
      duration: 3000
    });
  } finally {
    mineRwAcceptanceBusy.value = false;
    activeMineRwAcceptanceStep.value = '';
  }
};</script>

<template>
  <view style="position: relative">
    <uv-navbar placeholder leftIcon="" :title="'\u6211\u7684'" :bgColor="scrollTop > 0 ? '#f1f3f6' : 'rgba(255, 255, 255, 0)'"></uv-navbar>
    <view style="position: absolute; top: 0; left: 0; width: 100%">
      <image class="mine-bg-image" src="/static/images/bg05.png" mode="widthFix"></image>
    </view>

    <view class="p-30 pb-100 relative mine-content" style="z-index: 1; box-sizing: border-box">
      <view class="pl-30 pr-30">
        <view class="user-section mb-50">
          <view v-if="userStore.userInfo.id" @click="$uv.route('/pagesA/mines/profile')" class="user-card user-card--logged flex ai-center">
            <image class="user-avatar-image" :src="getFullUrl(userStore.userInfo.avatar) || '/static/images/mine/avatar.png' " mode="aspectFill"></image>
            <view class="user-info flex-1 flex ai-center jc-between ml-30">
              <view class="user-nickname fs-48">{{ userStore.userInfo.nickName }}</view>
              <view class="mine-arrow"></view>
            </view>
          </view>
          <view v-else class="user-card user-card--guest flex ai-center" @click="$uv.route('/pages/login/login')">
            <image class="user-avatar-image" src="/static/images/mine/avatar.png" mode="aspectFill"></image>
            <view class="user-login-prompt ml-30 fs-48">{{ '\u767b\u5f55/\u6ce8\u518c' }}</view>
          </view>
        </view>

        <view class="device-section flex ai-center jc-between relative">
          <view class="device-status flex fd-c ai-center mr-30" style="min-height: 150rpx">
            <image
              class="device-status-icon"
              :src="mineBluetoothStatus.iconPath"
              mode="aspectFit"
            ></image>
            <view class="device-text mt-10" :style="{ color: mineBluetoothStatus.textColor }">
              {{ mineBluetoothStatus.text }}
            </view>
          </view>
          <view>
            <image src="/static/images/mine/logo3.png" mode="widthFix" class="banner-logo"></image>
          </view>
          <view class="device-banner relative flex">
            <view class="banner-actions flex jc-between" style="margin-bottom: 50rpx">
              <view v-if="shouldShowBatteryInfo" class="device-battery-info flex fd-c ai-center">
                <view class="battery-icon mb-10" :class="{ charging: isMineBatteryCharging }">
                  <view class="battery-body">
                    <view class="battery-fill" :style="{ width: batteryPercent + '%' }"></view>
                  </view>
                  <view class="battery-cap"></view>
                </view>
                <view class="battery-level fs-40">{{ displayBatteryValue }}</view>
              </view>
              <view v-else class="action-buttons">
                <template v-if="shouldShowReconnectButton">
                  <uv-button
                    :text="'\u70b9\u51fb\u91cd\u8fde'"
                    shape="circle"
                    color="#2E70FC"
                    loadingMode="circle"
                    :loading="isLoading"
                    :loadingText="isLoading ? '\u91cd\u8fde\u4e2d...' : '\u70b9\u51fb\u91cd\u8fde'"
                    :customTextStyle="{ 'font-size': '28rpx' }"
                    :customStyle="{
                      padding: '38rpx 0',
                      width: '190rpx',
                      'margin-bottom': '30rpx'
                    }"
                    @click="connectAgain"
                  ></uv-button>
                  <uv-button
                    text="\u89e3\u9664\u7ed1\u5b9a"
                    shape="circle"
                    color="#FFFFFF"
                    :customTextStyle="{ color: '#010101', 'font-size': '28rpx' }"
                    :customStyle="{
                      padding: '38rpx 0',
                      width: '190rpx'
                    }"
                    @click="unbindDevice"
                  ></uv-button>
                </template>
                <template v-else>
                  <uv-button
                    :text="'\u626b\u4e00\u626b'"
                    shape="circle"
                    color="#FFFFFF"
                    :customTextStyle="{ color: '#010101', 'font-size': '28rpx' }"
                    :customStyle="{ padding: '38rpx 0', width: '190rpx', 'margin-bottom': '30rpx' }"
                    @click="scanDevice"
                  ></uv-button>
                  <uv-button
                    :text="'\u53bb\u914d\u5bf9'"
                    shape="circle"
                    color="#2E70FC"
                    :customTextStyle="{ 'font-size': '28rpx' }"
                    :customStyle="{ padding: '38rpx 0', width: '190rpx', 'margin-bottom': '30rpx' }"
                    @click="jumpDetail"
                  ></uv-button>
                </template>
              </view>
            </view>
          </view>
        </view>
      </view>

      <view class="rw-diagnostic-panel bg-white r-50 mb-30 pt-30 pr-40 pb-30 pl-40">
        <view class="rw-diagnostic-header flex jc-between ai-center">
          <view>
            <view class="rw-diagnostic-title">RW{{ '\u8bca\u65ad' }}</view>
            <view class="rw-diagnostic-subtitle">{{ '\u7248\u672c' }} {{ RW_DIAGNOSTIC_BUILD_TAG }}</view>
          </view>
          <view class="rw-diagnostic-status">{{ rwDiagnosticStatusText }}</view>
        </view>
        <view class="rw-diagnostic-actions">
          <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineHistoryButtonLoading('summary')" :loading="isMineHistoryButtonLoading('summary')" @tap="handleMineHistorySync()">{{ historySyncButtonText }}</button>
          <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineCoreProtocolProbeRunning" :loading="isMineCoreProtocolProbeRunning" @tap="handleMineProtocolProbe('core')">{{ protocolProbeButtonText }}</button>
          <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineBloodOxygenRealtimeProtocolProbeRunning" :loading="isMineBloodOxygenRealtimeProtocolProbeRunning" @tap="handleMineProtocolProbe('bloodOxygenRealtime')">{{ bloodOxygenRealtimeProtocolProbeButtonText }}</button>
          <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineHeartRateRealtimeProtocolProbeRunning" :loading="isMineHeartRateRealtimeProtocolProbeRunning" @tap="handleMineProtocolProbe('heartRateRealtime')">{{ heartRateRealtimeProtocolProbeButtonText }}</button>
          <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineHrvRealtimeProtocolProbeRunning" :loading="isMineHrvRealtimeProtocolProbeRunning" @tap="handleMineProtocolProbe('hrvRealtime')">{{ hrvRealtimeProtocolProbeButtonText }}</button>
          <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineStressMonitoringProtocolProbeRunning" :loading="isMineStressMonitoringProtocolProbeRunning" @tap="handleMineProtocolProbe('stressMonitoring')">{{ stressMonitoringProtocolProbeButtonText }}</button>
          <template v-if="MINE_SHOW_TEMPERATURE_PROTOCOL_PROBES">
            <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineTemperatureProtocolProbeRunning" :loading="isMineTemperatureProtocolProbeRunning" @tap="handleMineProtocolProbe('temperature')">{{ temperatureProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineTemperatureMonitoringProtocolProbeRunning" :loading="isMineTemperatureMonitoringProtocolProbeRunning" @tap="handleMineProtocolProbe('temperatureMonitoring')">{{ temperatureMonitoringProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineTemperatureDetectingProtocolProbeRunning" :loading="isMineTemperatureDetectingProtocolProbeRunning" @tap="handleMineProtocolProbe('temperatureDetecting')">{{ temperatureDetectingProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineTemperatureDetectingPlainProtocolProbeRunning" :loading="isMineTemperatureDetectingPlainProtocolProbeRunning" @tap="handleMineProtocolProbe('temperatureDetectingPlain')">{{ temperatureDetectingPlainProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineTemperatureDetectingShortProtocolProbeRunning" :loading="isMineTemperatureDetectingShortProtocolProbeRunning" @tap="handleMineProtocolProbe('temperatureDetectingShort')">{{ temperatureDetectingShortProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineTemperatureDetectingNoCrcProtocolProbeRunning" :loading="isMineTemperatureDetectingNoCrcProtocolProbeRunning" @tap="handleMineProtocolProbe('temperatureDetectingNoCrc')">{{ temperatureDetectingNoCrcProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineTemperatureRealtimeReadProtocolProbeRunning" :loading="isMineTemperatureRealtimeReadProtocolProbeRunning" @tap="handleMineProtocolProbe('temperatureRealtimeRead')">{{ temperatureRealtimeReadProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineTemperatureRealtimeControlEnableProtocolProbeRunning" :loading="isMineTemperatureRealtimeControlEnableProtocolProbeRunning" @tap="handleMineProtocolProbe('temperatureRealtimeControlEnable')">{{ temperatureRealtimeControlEnableProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineTemperatureRealtimeControlDisableProtocolProbeRunning" :loading="isMineTemperatureRealtimeControlDisableProtocolProbeRunning" @tap="handleMineProtocolProbe('temperatureRealtimeControlDisable')">{{ temperatureRealtimeControlDisableProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineTemperatureHistoryProtocolProbeRunning" :loading="isMineTemperatureHistoryProtocolProbeRunning" @tap="handleMineProtocolProbe('temperatureHistory')">{{ temperatureHistoryProtocolProbeButtonText }}</button>
          </template>
          <template v-if="MINE_SHOW_STEP_PROTOCOL_PROBES">
            <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineStepCurrentDayProtocolProbeRunning" :loading="isMineStepCurrentDayProtocolProbeRunning" @tap="handleMineProtocolProbe('stepCurrentDay')">{{ stepCurrentDayProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineStepCurrentDayC6ProtocolProbeRunning" :loading="isMineStepCurrentDayC6ProtocolProbeRunning" @tap="handleMineProtocolProbe('stepCurrentDayC6')">{{ stepCurrentDayC6ProtocolProbeButtonText }}</button>
            <button v-if="false" class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineActivityHistoryProtocolProbeRunning" :loading="isMineActivityHistoryProtocolProbeRunning" @tap="handleMineProtocolProbe('activityHistory')">{{ activityHistoryProtocolProbeButtonText }}</button>
            <button v-if="false" class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineStepSleepProtocolProbeRunning" :loading="isMineStepSleepProtocolProbeRunning" @tap="handleMineProtocolProbe('stepSleep')">{{ stepSleepProtocolProbeButtonText }}</button>
          </template>
          <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !isMineFullProtocolProbeRunning" :loading="isMineFullProtocolProbeRunning" @tap="handleMineProtocolProbe('full')">{{ fullProtocolProbeButtonText }}</button>
          <button class="rw-diagnostic-button" :disabled="isMineRwAnyActionBusy && !mineRwAcceptanceBusy" :loading="mineRwAcceptanceBusy" @tap="handleMineRwL19Acceptance">{{ rwAcceptanceButtonText }}</button>
          <button class="rw-diagnostic-button danger-text" @tap="clearMineRwDiagnosticLogs">{{ '\u6e05\u7a7a\u65e5\u5fd7' }}</button>
        </view>
        <view class="rw-history-status">{{ mineHistoryStatusText }}</view>
        <view class="rw-diagnostic-section-label">{{ '\u5b9e\u65f6\u6d4b\u91cf' }}</view>
        <view class="rw-metric-test-actions">
          <button
            v-for="item in mineMetricTestItems"
            :key="item.name"
            class="rw-diagnostic-button rw-metric-test-button"
            :disabled="isMineRwAnyActionBusy && !isMineMetricButtonLoading(item.name)"
            :loading="isMineMetricButtonLoading(item.name)"
            @tap="handleMineMetricTest(item)"
          >
            {{ getMineMetricButtonText(item) }}
          </button>
        </view>
        <view class="rw-diagnostic-section-label">{{ '\u5386\u53f2\u540c\u6b65' }}</view>
        <view class="rw-history-type-actions">
          <button
            v-for="item in mineHistorySyncItems"
            :key="item.key"
            class="rw-diagnostic-button rw-history-type-button"
            :disabled="isMineRwAnyActionBusy && !isMineHistoryButtonLoading(item.key)"
            :loading="isMineHistoryButtonLoading(item.key)"
            @tap="handleMineHistorySync(item)"
          >
            {{ getMineHistoryButtonText(item) }}
          </button>
        </view>
        <template v-if="MINE_SHOW_SLEEP_PROTOCOL_PROBE">
          <view class="rw-diagnostic-section-label rw-sleep-protocol-label">{{ '\u7761\u7720\u534f\u8bae\u6d4b\u8bd5\uff08\u4f9b\u5e94\u5546PDF\uff09' }}</view>
          <view class="rw-sleep-protocol-note">{{ '\u4e3b\u9a8c\u8bc1\u547d\u4ee4\uff1a050510\uff1bSleepItem = 4\u5b57\u8282\u65f6\u95f4\u6233 + 1\u5b57\u8282\u72b6\u6001 + 2\u5b57\u8282\u4fdd\u7559\u3002' }}</view>
          <view class="rw-sleep-protocol-actions">
            <button class="rw-diagnostic-button rw-sleep-protocol-button primary" :disabled="isMineRwAnyActionBusy && !isMineSleepHistoryProtocolProbeRunning" :loading="isMineSleepHistoryProtocolProbeRunning" @tap="handleMineProtocolProbe('sleepHistory')">{{ sleepHistoryProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button rw-sleep-protocol-button" :disabled="isMineRwAnyActionBusy && !isMineSleepSdkHistoryProtocolProbeRunning" :loading="isMineSleepSdkHistoryProtocolProbeRunning" @tap="handleMineProtocolProbe('sleepSdkHistory')">{{ sleepSdkHistoryProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button rw-sleep-protocol-button" :disabled="isMineRwAnyActionBusy && !isMineSleepContinueHistoryProtocolProbeRunning" :loading="isMineSleepContinueHistoryProtocolProbeRunning" @tap="handleMineProtocolProbe('sleepContinueHistory')">{{ sleepContinueHistoryProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button rw-sleep-protocol-button" :disabled="isMineRwAnyActionBusy && !isMineSleepNativeDetailProtocolProbeRunning" :loading="isMineSleepNativeDetailProtocolProbeRunning" @tap="handleMineProtocolProbe('sleepNativeDetail')">{{ sleepNativeDetailProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button rw-sleep-protocol-button" :disabled="isMineRwAnyActionBusy && !isMineSleepNativeListProtocolProbeRunning" :loading="isMineSleepNativeListProtocolProbeRunning" @tap="handleMineProtocolProbe('sleepNativeList')">{{ sleepNativeListProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button rw-sleep-protocol-button" :disabled="isMineRwAnyActionBusy && !isMineSleepEnhanceReadProtocolProbeRunning" :loading="isMineSleepEnhanceReadProtocolProbeRunning" @tap="handleMineProtocolProbe('sleepEnhanceRead')">{{ sleepEnhanceReadProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button rw-sleep-protocol-button" :disabled="isMineRwAnyActionBusy && !isMineRawSleepHistoryProtocolProbeRunning" :loading="isMineRawSleepHistoryProtocolProbeRunning" @tap="handleMineProtocolProbe('rawSleepHistory')">{{ rawSleepHistoryProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button rw-sleep-protocol-button" :disabled="isMineRwAnyActionBusy && !isMineStepSleepProtocolProbeRunning" :loading="isMineStepSleepProtocolProbeRunning" @tap="handleMineProtocolProbe('stepSleep')">{{ stepSleepProtocolProbeButtonText }}</button>
            <button class="rw-diagnostic-button rw-sleep-protocol-button danger-text" :disabled="isMineRwAnyActionBusy && !isMineSleepDeleteProtocolProbeRunning" :loading="isMineSleepDeleteProtocolProbeRunning" @tap="handleMineSleepDeleteProbe">{{ sleepDeleteProtocolProbeButtonText }}</button>
          </view>
        </template>
      </view>

      <view class="menu-section">
        <view class="menu-item flex jc-between ai-center bg-white r-50 mb-30 pt-30 pr-40 pb-30 pl-40" v-for="(item, index) in menuList" :key="index" @tap.stop="handleMineMenuTap(item)">
          <view class="menu-item__content flex ai-center">
            <image class="menu-icon" :src="item.icon" mode="aspectFit"></image>
            <view class="menu-title fs-36 ml-30">{{ item.title }}</view>
          </view>
          <view class="mine-arrow"></view>
        </view>
      </view>
    </view>
  </view>
</template>
<style lang="scss" scoped>
.menu-item {
  &:last-child {
    margin-bottom: 0;
  }
}
.mine-content {
  display: flex;
  flex-direction: column;
}
.menu-section {
  order: 10;
}
.mine-bg-image {
  display: block;
  width: 100%;
}
.user-avatar-image {
  border-radius: 50%;
  display: block;
  flex: 0 0 148rpx;
  height: 148rpx;
  overflow: hidden;
  width: 148rpx;
}
.device-status-icon {
  display: block;
  height: 48rpx;
  width: 48rpx;
}
.banner-logo {
  display: block;
  width: 300rpx;
}
.menu-icon {
  display: block;
  flex: 0 0 64rpx;
  height: 64rpx;
  width: 64rpx;
}
.mine-arrow {
  border-right: 3rpx solid #010101;
  border-top: 3rpx solid #010101;
  flex: 0 0 auto;
  height: 18rpx;
  transform: rotate(45deg);
  width: 18rpx;
}
.rw-diagnostic-panel {
  box-sizing: border-box;
  order: 99;
}
.rw-diagnostic-title {
  color: #111827;
  font-size: 32rpx;
  font-weight: 600;
}
.rw-diagnostic-subtitle {
  color: #8a8f99;
  font-size: 22rpx;
  margin-top: 8rpx;
}
.rw-diagnostic-status {
  color: #4c76f1;
  font-size: 24rpx;
  max-width: 220rpx;
  text-align: right;
}
.rw-diagnostic-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16rpx;
  margin-top: 24rpx;
}
.rw-history-status {
  color: #6b7280;
  font-size: 22rpx;
  margin-top: 16rpx;
}
.rw-diagnostic-section-label {
  color: #6b7280;
  font-size: 22rpx;
  margin-top: 18rpx;
}
.rw-metric-test-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 12rpx;
}
.rw-history-type-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 16rpx;
}
.rw-sleep-protocol-label {
  color: #111827;
  font-weight: 600;
  margin-top: 28rpx;
}
.rw-sleep-protocol-note {
  background: #f6f8ff;
  border: 1rpx solid #dfe7ff;
  border-radius: 14rpx;
  color: #647089;
  font-size: 22rpx;
  line-height: 1.45;
  margin-top: 12rpx;
  padding: 14rpx 16rpx;
}
.rw-sleep-protocol-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 16rpx;
}
.rw-sleep-protocol-button {
  font-size: 22rpx;
  min-height: 76rpx;
}
.rw-sleep-protocol-button.primary {
  background: #edf4ff;
  border-color: #bcd4ff;
  color: #2e70fc;
  font-weight: 600;
}
.rw-diagnostic-button {
  align-items: center;
  background: #f5f7fb;
  border: 1rpx solid #e5e7ef;
  border-radius: 12rpx;
  box-sizing: border-box;
  color: #111827;
  display: flex;
  font-size: 24rpx;
  justify-content: center;
  line-height: 1.25;
  margin: 0;
  min-height: 82rpx;
  padding: 12rpx 10rpx;
  text-align: center;
  white-space: normal;
  word-break: break-all;
}
.rw-history-type-button {
  color: #4c76f1;
  font-size: 22rpx;
  min-height: 74rpx;
}
.rw-metric-test-button {
  color: #111827;
  font-size: 22rpx;
  min-height: 74rpx;
}
.rw-diagnostic-button[disabled] {
  color: #a8b0bd;
}
.rw-diagnostic-button::after {
  border: 0;
}
.danger-text {
  color: #e34d59;
}
.custom-reconnect-btn {
  width: 190rpx;
  height: 76rpx;
  background: #2e70fc;
  border-radius: 38rpx;
  opacity: 1;
  transition: opacity 0.3s;
}

.custom-reconnect-btn.loading {
  opacity: 0.7;
}

.custom-reconnect-btn:active {
  opacity: 0.8;
}

.btn-content {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.btn-text {
  color: #ffffff;
  font-size: 28rpx;
}
.battery-icon {
  display: flex;
  align-items: center;
  width: 56rpx;
  height: 28rpx;
}

.battery-body {
  position: relative;
  flex: 1;
  height: 100%;
  border: 3rpx solid #4c76f1;
  border-radius: 6rpx;
  padding: 3rpx;
  box-sizing: border-box;
  overflow: hidden;
}

.battery-fill {
  height: 100%;
  background: #4c76f1;
  border-radius: 3rpx;
  transition: width 0.3s ease;
}

.battery-icon.charging .battery-fill {
  animation: battery-charging 2.4s linear infinite;
}

@keyframes battery-charging {
  0%,
  5% {
    width: 0%;
  }
  25%,
  30% {
    width: 25%;
  }
  50%,
  55% {
    width: 50%;
  }
  75%,
  80% {
    width: 75%;
  }
  100% {
    width: 100%;
  }
}

.battery-cap {
  width: 5rpx;
  height: 12rpx;
  background: #4c76f1;
  border-radius: 0 3rpx 3rpx 0;
  margin-left: 2rpx;
}

.wave-progress-wrapper {
  padding: 0; /* Remove vertical padding so the wave stays inside the filled area. */
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2rpx;
  overflow: hidden; /* Keep the wave from overflowing the container. */
}
</style>
