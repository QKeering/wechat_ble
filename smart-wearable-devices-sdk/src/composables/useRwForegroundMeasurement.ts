import { useRingBLE } from '@/composables/useRingBLE';
import {
  getLatestBloodPressureReading,
  getLatestBloodSugarReading,
  getLatestHeartRateReading,
  getLatestHrvReading,
  getLatestSpo2Reading,
  getLatestStressReading,
  getLatestTemperatureReading
} from '@/composables/useRingMetricReadings';
import { useRingStore } from '@/stores';
import { useUserStore } from '@/stores/user';
import { enqueueRwDiagnosticUpload } from '@/utils/rwDiagnosticUpload';

export type RwForegroundMetric =
  | 'heart_rate'
  | 'blood_oxygen'
  | 'temperature'
  | 'hrv'
  | 'stress'
  | 'blood_pressure'
  | 'blood_sugar';

export const RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS = 45000;
export const RW_FOREGROUND_METRIC_READ_AT_MS = [1500, 8000, 18000, 28000] as const;
export const RW_DIAGNOSTIC_BUILD_TAG = 'rw-visible-build-tag-20260723-detail-settings-01';
const RW_FOREGROUND_METRIC_READ_AT_MS_BY_METRIC: Partial<Record<RwForegroundMetric, readonly number[]>> = {
  temperature: [12000, 24000, 38000, 52000],
  hrv: [1500, 8000, 18000, 28000, 40000, 52000]
};
const RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS_BY_METRIC: Partial<Record<RwForegroundMetric, number>> = {
  temperature: 65000,
  hrv: 65000
};

const RING_DIAGNOSTIC_LOG_STORAGE_KEY = 'qkeer:ring-diagnostic-logs';
const RING_DIAGNOSTIC_LOG_MAX_COUNT = 500;
const RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH = 4000;
const RW_REALTIME_METRIC_KEYS: Record<RwForegroundMetric, number> = {
  heart_rate: 0x0224,
  blood_oxygen: 0x024e,
  temperature: 0x0508,
  hrv: 0x0269,
  stress: 0x050d,
  blood_pressure: 0x0504,
  blood_sugar: 0x0510
};
const RW_REALTIME_METRIC_ACCEPTED_KEYS: Record<RwForegroundMetric, number[]> = {
  heart_rate: [0x0224, 0x0503],
  blood_oxygen: [0x024e, 0x0509],
  temperature: [0x0508, 0x0230],
  hrv: [0x0269, 0x050a],
  stress: [0x050d, 0x024f],
  blood_pressure: [0x0504, 0x0231],
  blood_sugar: [0x0510, 0x026c]
};
const RW_FOREGROUND_METRIC_LABELS: Record<RwForegroundMetric, string> = {
  heart_rate: '\u5fc3\u7387',
  blood_oxygen: '\u8840\u6c27',
  temperature: '\u4f53\u6e29',
  hrv: 'HRV',
  stress: '\u538b\u529b',
  blood_pressure: '\u8840\u538b',
  blood_sugar: '\u8840\u7cd6'
};
const RW_FOREGROUND_METRIC_NAMES: RwForegroundMetric[] = [
  'heart_rate',
  'blood_oxygen',
  'temperature',
  'hrv',
  'stress',
  'blood_pressure',
  'blood_sugar'
];

export const getRwForegroundMetricExpectedKey = (name: RwForegroundMetric) => RW_REALTIME_METRIC_KEYS[name];

type RunRwForegroundMeasurementOptions = {
  startedAt?: number;
  timeoutMs?: number;
  minActiveMs?: number;
  readAtMs?: readonly number[];
  measureStatus?: () => string;
  source?: string;
};

type RingDiagnosticLogEntry = {
  id?: number;
  time?: string;
  source?: string;
  event?: string;
  details?: unknown;
};

let rwMetricReadToken = 0;
let activeRwMetric: RwForegroundMetric | null = null;

const isNodeRuntime = () => Boolean((globalThis as any).process?.versions?.node);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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

export const appendRingDiagnosticLog = (source: string, event: string, details?: unknown) => {
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
    // Diagnostic logging must never affect measurement.
  }
};

const readRingDiagnosticLogs = (): RingDiagnosticLogEntry[] => {
  if (isNodeRuntime()) return [];
  try {
    const raw = uni.getStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY);
    return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
};

const parseDiagnosticDetails = (details: unknown): Record<string, any> | null => {
  if (!details) return null;
  if (typeof details === 'object') return details as Record<string, any>;
  if (typeof details !== 'string') return null;
  const text = details.trim();
  if (!text || text.includes('...<truncated>')) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : null;
  } catch {
    return null;
  }
};

const getDiagnosticLogTimestamp = (entry: RingDiagnosticLogEntry) => {
  const idTimestamp = typeof entry.id === 'number' ? Math.floor(entry.id / 1000) : 0;
  return Number.isFinite(idTimestamp) && idTimestamp > 0 ? idTimestamp : 0;
};

export const isRwForegroundMetric = (name: string): name is RwForegroundMetric =>
  RW_FOREGROUND_METRIC_NAMES.includes(name as RwForegroundMetric);

const pickFirstMetricValue = (...values: any[]) => values.find((value) => value != null && value !== '');
const RW_FOREGROUND_STATUS_ONLY_BYTES = new Set([0x11, 0x31]);

const normalizeRwForegroundNumber = (value: unknown) => {
  if (value == null || value === '' || value === '-') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const matched = value.trim().match(/-?\d+(?:\.\d+)?/);
    if (!matched) return null;
    const parsed = Number(matched[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeRwForegroundHeartRateValue = (value: unknown) => {
  const numeric = normalizeRwForegroundNumber(value);
  if (numeric == null || numeric < 25 || numeric > 240 || RW_FOREGROUND_STATUS_ONLY_BYTES.has(numeric)) return null;
  return numeric;
};

const normalizeRwForegroundBloodOxygenValue = (value: unknown) => {
  const numeric = normalizeRwForegroundNumber(value);
  if (numeric == null || numeric < 70 || numeric > 100) return null;
  return numeric;
};

const normalizeRwForegroundHrvValue = (value: unknown) => {
  const numeric = normalizeRwForegroundNumber(value);
  return numeric != null && numeric > 0 ? numeric : null;
};

const normalizeRwForegroundStressValue = (value: unknown) => {
  const numeric = normalizeRwForegroundNumber(value);
  return numeric != null && numeric >= 0 && numeric <= 100 ? numeric : null;
};

const normalizeRwForegroundBloodSugarValue = (value: unknown) => {
  const numeric = normalizeRwForegroundNumber(value);
  if (numeric == null || numeric <= 0 || RW_FOREGROUND_STATUS_ONLY_BYTES.has(numeric)) return null;
  const normalized = numeric > 30 && numeric <= 300 ? Number((numeric / 10).toFixed(1)) : numeric;
  return normalized > 0 && normalized <= 30 ? normalized : null;
};

const normalizeRwForegroundTemperatureValue = (value: unknown) => {
  const numeric = normalizeRwForegroundNumber(value);
  return numeric != null && numeric >= 25 && numeric <= 45 ? numeric : null;
};

const stripRwForegroundStatusPrefix = (data: unknown) => {
  if (!Array.isArray(data)) return data;
  return typeof data[0] === 'number' && RW_FOREGROUND_STATUS_ONLY_BYTES.has(data[0]) ? data.slice(1) : data;
};

const getRwForegroundScalarDataValue = (data: unknown) => {
  if (!Array.isArray(data)) return null;
  let value: unknown = null;
  if (typeof data[0] === 'number' && RW_FOREGROUND_STATUS_ONLY_BYTES.has(data[0])) {
    value = data.length >= 5 ? data[4] : data[1];
  } else if (data.length >= 6 && data.length % 6 === 0) {
    value = data[data.length - 2];
  } else if (data.length === 1) {
    value = data[0];
  }
  return typeof value === 'number' ? value : null;
};

const getRwForegroundDataArray = (item: Record<string, any>) => {
  const data = item.data ?? item.metrics?.data ?? item.raw?.data;
  return Array.isArray(data) ? data : null;
};

const getRwForegroundMetricKey = (item: Record<string, any>) => {
  const key = Number(pickFirstMetricValue(item.metrics?.key, item.key, item.raw?.key));
  return Number.isFinite(key) ? key : null;
};

const isRwForegroundCompatMetricKey = (name: RwForegroundMetric, key: number) =>
  (RW_REALTIME_METRIC_ACCEPTED_KEYS[name] || []).includes(key) && key !== RW_REALTIME_METRIC_KEYS[name];

const requiresRwForegroundCompatReadFlag = (_name: RwForegroundMetric) => true;

const isRwForegroundAppRealtimeStatusKey = (key: number | null) => key === 0x0224 || key === 0x024e;

const readUint32LEFromArray = (values: unknown[]) => {
  if (values.length < 4 || values.slice(0, 4).some((value) => typeof value !== 'number')) return null;
  return ((values[0] as number) || 0) |
    (((values[1] as number) || 0) << 8) |
    (((values[2] as number) || 0) << 16) |
    (((values[3] as number) || 0) << 24);
};

const isPlausibleRwForegroundHistoryTimestamp = (value: number) =>
  Number.isFinite(value) && value >= 946_684_800 && value <= 4_102_444_800;

const hasRwForegroundHistoryRecords = (item: Record<string, any>) => {
  const records = item.records ?? item.metrics?.records ?? item.raw?.records;
  if (Array.isArray(records) && records.length > 0) return true;
  const data = getRwForegroundDataArray(item);
  if (!data || data.length < 6 || data.length % 6 !== 0) return false;
  const key = getRwForegroundMetricKey(item);
  if (typeof data[0] === 'number' && RW_FOREGROUND_STATUS_ONLY_BYTES.has(data[0]) && isRwForegroundAppRealtimeStatusKey(key)) return false;
  const timestamp = readUint32LEFromArray(data);
  return timestamp != null && isPlausibleRwForegroundHistoryTimestamp(timestamp);
};

const getRwForegroundFlag = (item: Record<string, any>) => {
  const value = pickFirstMetricValue(item.metrics?.flag, item.flag, item.raw?.flag);
  const flag = Number(value);
  return Number.isFinite(flag) ? flag : null;
};

const isRwForegroundReadFlag = (flag: number | null) => flag === 0x10 || flag === 0x11;
const getRwForegroundTemperatureDataValue = (data: unknown) => {
  const values = stripRwForegroundStatusPrefix(data);
  if (!Array.isArray(values) || typeof values[0] !== 'number') return null;
  if (typeof values[1] === 'number') {
    const raw = values[0] | (values[1] << 8);
    const celsiusBy100 = Number((raw / 100).toFixed(2));
    if (celsiusBy100 >= 25 && celsiusBy100 <= 45) return celsiusBy100;
    const celsiusBy10 = Number((raw / 10).toFixed(1));
    if (celsiusBy10 >= 25 && celsiusBy10 <= 45) return celsiusBy10;
  }
  return values[0] >= 25 && values[0] <= 45 ? values[0] : null;
};
const normalizeRwForegroundMetricName = (value: unknown) => {
  const compact = String(value || '').trim().replace(/[-_\s]/g, '').toLowerCase();
  if (compact === 'heartrate' || compact === 'hr') return 'heart_rate';
  if (compact === 'bloodoxygen' || compact === 'spo2' || compact === 'oxygen') return 'blood_oxygen';
  if (compact === 'temperature' || compact === 'bodytemperature' || compact === 'temp') return 'temperature';
  if (compact === 'hrv' || compact === 'heartratevariability') return 'hrv';
  if (compact === 'bloodpressure' || compact === 'bp' || compact === 'systolic' || compact === 'diastolic') return 'blood_pressure';
  if (compact === 'bloodsugar' || compact === 'glucose' || compact === 'sugar') return 'blood_sugar';
  if (compact === 'stress' || compact === 'stressindex' || compact === 'pressure') return 'stress';
  return compact;
};

const normalizeRealtimeTimestamp = (value: unknown) => {
  if (value == null || value === '' || value === '-') return null;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    return numericValue > 0 && numericValue < 100_000_000_000 ? numericValue * 1000 : numericValue;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const getRealtimeDataTimestamp = (item: Record<string, any>) => {
  const value = pickFirstMetricValue(
    item.collectedAt,
    item.timestamp,
    item.time,
    item.unixTime,
    item.startTimestamp,
    item.recordTimestamp,
    item.recordTime,
    item.createdAt,
    item.metrics?.collectedAt,
    item.metrics?.timestamp,
    item.metrics?.time,
    item.metrics?.unixTime,
    item.metrics?.startTimestamp,
    item.metrics?.recordTimestamp,
    item.metrics?.recordTime,
    item.metrics?.createdAt,
    item.raw?.collectedAt,
    item.raw?.timestamp,
    item.raw?.time,
    item.raw?.unixTime,
    item.raw?.startTimestamp,
    item.raw?.recordTimestamp,
    item.raw?.recordTime,
    item.raw?.createdAt,
    item.receivedAt,
    item.parsedAt,
    item.received_at,
    item.raw?.receivedAt,
    item.raw?.parsedAt,
    item.raw?.received_at,
    item.metrics?.receivedAt,
    item.metrics?.parsedAt
  );
  return normalizeRealtimeTimestamp(value) || 0;
};

const isRealtimeControlAckPacket = (parsed: Record<string, any>, name: RwForegroundMetric) => {
  const sourceType = String(parsed.sourceType || parsed.type || parsed.raw?.type || '');
  if (sourceType !== 'rw_health_data_control_ack') return false;
  const metricName = normalizeRwForegroundMetricName(parsed.metrics?.name || parsed.name || parsed.raw?.name);
  return !metricName || metricName === 'unknown' || metricName === name;
};

const summarizeRealtimeControlAck = (item: Record<string, any> | null) =>
  item
    ? {
        sourceType: item.sourceType || item.type || item.raw?.type,
        metricName: item.metrics?.name || item.name || item.raw?.name,
        key: pickFirstMetricValue(item.metrics?.key, item.key, item.raw?.key),
        status: item.metrics?.status || item.status || item.raw?.status,
        success: pickFirstMetricValue(item.metrics?.success, item.success, item.raw?.success),
        controlAction: pickFirstMetricValue(item.metrics?.controlAction, item.controlAction, item.raw?.controlAction),
        timestamp: getRealtimeDataTimestamp(item)
      }
    : null;

export const getRwForegroundMetricValue = (name: RwForegroundMetric, data: any) => {
  if (!data) return null;
  const directValue = data.value ?? data.metrics?.value ?? data.raw?.value ?? null;
  const sourceData = data.data ?? data.metrics?.data ?? data.raw?.data;
  if (name === 'heart_rate') {
    return normalizeRwForegroundHeartRateValue(
      pickFirstMetricValue(
        data.heartRate,
        data.heart_rate,
        data.hr,
        data.metrics?.heartRate,
        data.metrics?.heart_rate,
        data.metrics?.hr,
        data.raw?.heartRate,
        data.raw?.heart_rate,
        data.raw?.hr,
        directValue
      )
    ) ?? normalizeRwForegroundHeartRateValue(getRwForegroundScalarDataValue(sourceData));
  }
  if (name === 'blood_oxygen') {
    return normalizeRwForegroundBloodOxygenValue(
      data.bloodOxygen ??
        data.blood_oxygen ??
        data.spo2 ??
        data.oxygen ??
        data.metrics?.bloodOxygen ??
        data.metrics?.blood_oxygen ??
        data.metrics?.spo2 ??
        data.metrics?.oxygen ??
        data.raw?.bloodOxygen ??
        data.raw?.blood_oxygen ??
        data.raw?.spo2 ??
        data.raw?.oxygen ??
        directValue
    ) ?? normalizeRwForegroundBloodOxygenValue(getRwForegroundScalarDataValue(sourceData));
  }
  if (name === 'hrv') {
    return normalizeRwForegroundHrvValue(
      pickFirstMetricValue(
        data.heartRateVariability,
        data.heart_rate_variability,
        data.hrv,
        data.metrics?.heartRateVariability,
        data.metrics?.heart_rate_variability,
        data.metrics?.hrv,
        data.raw?.heartRateVariability,
        data.raw?.heart_rate_variability,
        data.raw?.hrv,
        directValue
      )
    ) ?? normalizeRwForegroundHrvValue(getRwForegroundScalarDataValue(sourceData));
  }
  if (name === 'stress') {
    return normalizeRwForegroundStressValue(
      pickFirstMetricValue(
        data.stressIndex,
        data.stress_index,
        data.stress,
        data.pressure,
        data.metrics?.stressIndex,
        data.metrics?.stress_index,
        data.metrics?.stress,
        data.metrics?.pressure,
        data.raw?.stressIndex,
        data.raw?.stress_index,
        data.raw?.stress,
        data.raw?.pressure,
        directValue
      )
    ) ?? normalizeRwForegroundStressValue(getRwForegroundScalarDataValue(sourceData));
  }
  if (name === 'blood_sugar') {
    return normalizeRwForegroundBloodSugarValue(
      pickFirstMetricValue(
        data.bloodSugar,
        data.blood_sugar,
        data.glucose,
        data.sugar,
        data.metrics?.bloodSugar,
        data.metrics?.blood_sugar,
        data.metrics?.glucose,
        data.metrics?.sugar,
        data.raw?.bloodSugar,
        data.raw?.blood_sugar,
        data.raw?.glucose,
        data.raw?.sugar,
        directValue
      )
    ) ?? normalizeRwForegroundBloodSugarValue(getRwForegroundScalarDataValue(sourceData));
  }
  if (name === 'blood_pressure') {
    const bloodPressure = data.bloodPressure ?? data.blood_pressure ?? data.bp;
    if (bloodPressure != null) return bloodPressure;
    const systolic = data.systolic ?? data.high ?? data.highPressure ?? data.sbp;
    const diastolic = data.diastolic ?? data.low ?? data.lowPressure ?? data.dbp;
    if (systolic != null || diastolic != null) return { systolic: systolic ?? null, diastolic: diastolic ?? null };
    return directValue;
  }
  return normalizeRwForegroundTemperatureValue(
    pickFirstMetricValue(
      data.temperature,
      data.bodyTemperature,
      data.body_temperature,
      data.bodyTemp,
      data.metrics?.temperature,
      data.metrics?.bodyTemperature,
      data.metrics?.body_temperature,
      data.metrics?.bodyTemp,
      data.raw?.temperature,
      data.raw?.bodyTemperature,
      data.raw?.body_temperature,
      data.raw?.bodyTemp,
      directValue
    )
  ) ?? getRwForegroundTemperatureDataValue(sourceData);
};

const getBloodPressureDisplayParts = (value: any) => {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) {
    const values = typeof value[0] === 'number' && (value[0] === 0x11 || value[0] === 0x31) ? value.slice(1) : value;
    const systolic = values[0] ?? null;
    const diastolic = values[1] ?? null;
    return systolic != null || diastolic != null ? { systolic, diastolic } : null;
  }
  if (typeof value === 'string') {
    const matched = value.match(/(\d{2,3})\D+(\d{2,3})/);
    if (matched) {
      return {
        systolic: Number(matched[1]),
        diastolic: Number(matched[2])
      };
    }
    return null;
  }
  if (typeof value === 'object') {
    const systolic = value.systolic ?? value.high ?? value.highPressure ?? value.bloodPressureHigh ?? value.sbp ?? value.sp ?? null;
    const diastolic = value.diastolic ?? value.low ?? value.lowPressure ?? value.bloodPressureLow ?? value.dbp ?? value.dp ?? null;
    return systolic != null || diastolic != null ? { systolic, diastolic } : null;
  }
  return null;
};

export const formatRwForegroundMetricResult = (name: RwForegroundMetric, value: any) => {
  if (name === 'heart_rate') return `${value} bpm`;
  if (name === 'blood_oxygen') return `${value}%`;
  if (name === 'temperature') return `${value}\u00b0C`;
  if (name === 'blood_pressure') {
    const parts = getBloodPressureDisplayParts(value);
    if (!parts) return `${value}`;
    return `${parts.systolic ?? '-'}/${parts.diastolic ?? '-'} mmHg`;
  }
  if (name === 'blood_sugar') return `${value} mmol/L`;
  return String(value);
};

export const useRwForegroundMeasurement = () => {
  const userStore = useUserStore();
  const ringStore = useRingStore();
  const ringBle = useRingBLE();
  const { controlRwHealthData, readRwHealthData } = ringBle;

  const getStoreSources = () => [ringStore, userStore];
  const getSharedDataSources = () => [
    ringStore.normalizedData || [],
    ringStore.receivedData || [],
    userStore.normalizedData || [],
    userStore.receivedData || []
  ];

  const findLatestRealtimeControlAck = (name: RwForegroundMetric, since = 0) => {
    for (const source of getSharedDataSources()) {
      if (!Array.isArray(source)) continue;
      for (let index = source.length - 1; index >= 0; index -= 1) {
        const item = source[index] as Record<string, any>;
        if (!isRealtimeControlAckPacket(item, name)) continue;
        if (getRealtimeDataTimestamp(item) < since) continue;
        return item;
      }
    }
    return null;
  };

  const getLatestRwForegroundMetricData = (name: RwForegroundMetric, startedAt: number) => {
    const readings = getStoreSources()
      .map((store) => {
        if (name === 'heart_rate') return getLatestHeartRateReading(store, startedAt);
        if (name === 'blood_oxygen') return getLatestSpo2Reading(store, startedAt);
        if (name === 'hrv') return getLatestHrvReading(store, startedAt);
        if (name === 'stress') return getLatestStressReading(store, startedAt);
        if (name === 'blood_pressure') return getLatestBloodPressureReading(store, startedAt);
        if (name === 'blood_sugar') return getLatestBloodSugarReading(store, startedAt);
        return getLatestTemperatureReading(store, startedAt);
      })
      .filter((item) => getRwForegroundMetricValue(name, item) != null);
    return readings.sort((left: any, right: any) => getRealtimeDataTimestamp(right) - getRealtimeDataTimestamp(left))[0];
  };

  const summarizeRwForegroundMetric = (name: RwForegroundMetric, startedAt: number, data: any) => ({
    target: name,
    expectedKey: RW_REALTIME_METRIC_KEYS[name],
    value: getRwForegroundMetricValue(name, data),
    data,
    startedAt
  });

  const isDirectRealtimeMetricPacket = (parsed: Record<string, any>, name: RwForegroundMetric) => {
    const sourceType = String(parsed.sourceType || parsed.type || parsed.raw?.type || '');
    if (sourceType !== 'rw_health_data') return false;
    const metricName = normalizeRwForegroundMetricName(parsed.metrics?.name || parsed.name || parsed.raw?.name || parsed.metricName);
    const key = getRwForegroundMetricKey(parsed);
    const expectedKeys = RW_REALTIME_METRIC_ACCEPTED_KEYS[name] || [RW_REALTIME_METRIC_KEYS[name]];
    if (metricName && metricName !== 'unknown' && metricName !== name) return false;
    if (key != null && key > 0 && !expectedKeys.includes(key)) return false;
    const flag = getRwForegroundFlag(parsed);
    if (
      key != null &&
      key > 0 &&
      isRwForegroundCompatMetricKey(name, key) &&
      requiresRwForegroundCompatReadFlag(name) &&
      !isRwForegroundReadFlag(flag)
    ) {
      return false;
    }
    if (key != null && key > 0 && hasRwForegroundHistoryRecords(parsed)) {
      return false;
    }
    return getRwForegroundMetricValue(name, parsed) != null;
  };

  const getLatestMetricFromDiagnosticLogs = (name: RwForegroundMetric, startedAt: number) => {
    const logs = readRingDiagnosticLogs();
    for (let index = logs.length - 1; index >= 0; index -= 1) {
      const entry = logs[index];
      if (entry.source !== 'RW BLE' || entry.event !== 'rx-parsed') continue;
      const logTimestamp = getDiagnosticLogTimestamp(entry);
      if (logTimestamp > 0 && logTimestamp < startedAt) continue;
      const details = parseDiagnosticDetails(entry.details);
      const parsedItems = Array.isArray(details?.parsed) ? details.parsed : details?.parsed ? [details.parsed] : [];
      const matched = parsedItems.find((item) => item && typeof item === 'object' && isDirectRealtimeMetricPacket(item, name));
      if (!matched) continue;

      return {
        ...(matched as Record<string, any>),
        protocol: 'rw',
        deviceId: details?.deviceId || userStore.deviceInfo?.deviceId || ringStore.deviceInfo?.deviceId,
        uniMacId: userStore.deviceInfo?.uniMacId || ringStore.deviceInfo?.uniMacId,
        mac: userStore.deviceInfo?.mac || ringStore.deviceInfo?.mac || ringStore.deviceInfo?.advertis?.macInfo,
        serviceId: details?.serviceId,
        characteristicId: details?.characteristicId,
        receivedAt: logTimestamp || Date.now(),
        parsedAt: logTimestamp || Date.now(),
        diagnosticFallback: true
      };
    }
    return null;
  };

  const writeDirectMetricToStore = (source: string, name: RwForegroundMetric, startedAt: number, parsed: Record<string, any>) => {
    try {
      ringStore.handleParsedData?.(parsed as any);
      appendRingDiagnosticLog(source, 'single-metric-direct-store-write', {
        ...getRwForegroundMeasurementSnapshot(name, startedAt),
        parsed: summarizeRwForegroundMetric(name, startedAt, parsed)
      });
    } catch (error) {
      appendRingDiagnosticLog(source, 'single-metric-direct-store-failed', {
        target: name,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const waitForDirectRealtimeMetric = async (
    name: RwForegroundMetric,
    startedAt: number,
    timeoutMs: number,
    token: number,
    source: string,
    measureStatus?: () => string
  ) => {
    const parsed = await ringBle.waitForParsedData(
      (item: Record<string, any>) => token === rwMetricReadToken && activeRwMetric === name && isDirectRealtimeMetricPacket(item, name),
      timeoutMs,
      { replayRecent: true }
    );
    if (token !== rwMetricReadToken || activeRwMetric !== name) return null;
    writeDirectMetricToStore(source, name, startedAt, parsed as Record<string, any>);
    appendRingDiagnosticLog(source, 'single-metric-direct-hit', {
      ...getRwForegroundMeasurementSnapshot(name, startedAt, measureStatus),
      parsed: summarizeRwForegroundMetric(name, startedAt, parsed)
    });
    return parsed;
  };

  const getRwForegroundMeasurementSnapshot = (
    name: RwForegroundMetric,
    startedAt: number,
    measureStatus?: () => string
  ) => ({
    target: name,
    label: RW_FOREGROUND_METRIC_LABELS[name],
    startedAt,
    elapsedMs: startedAt > 0 ? Date.now() - startedAt : 0,
    expectedKey: RW_REALTIME_METRIC_KEYS[name],
    activeRwMetric,
    measureStatus: measureStatus?.(),
    connected: Boolean(userStore.isConnected),
    deviceId: userStore.deviceInfo?.deviceId,
    protocol: userStore.deviceInfo?.protocol,
    receivedCount: Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0,
    normalizedCount: Array.isArray(userStore.normalizedData) ? userStore.normalizedData.length : 0,
    ringReceivedCount: Array.isArray(ringStore.receivedData) ? ringStore.receivedData.length : 0,
    ringNormalizedCount: Array.isArray(ringStore.normalizedData) ? ringStore.normalizedData.length : 0,
    latestHeartRate: getLatestHeartRateReading(userStore, startedAt)?.heartRate ?? null,
    latestSpo2: getLatestSpo2Reading(userStore, startedAt)?.bloodOxygen ?? null,
    latestTemperature: getLatestTemperatureReading(userStore, startedAt)?.temperature ?? null,
    latestHrv: getLatestHrvReading(userStore, startedAt)?.heartRateVariability ?? null,
    latestStress: getLatestStressReading(userStore, startedAt)?.stressIndex ?? null,
    latestBloodSugar: getLatestBloodSugarReading(userStore, startedAt)?.bloodSugar ?? null,
    latestBloodPressure: (() => {
      const latest = getLatestBloodPressureReading(userStore, startedAt);
      if (!latest) return null;
      return {
        systolic: latest.systolic ?? null,
        diastolic: latest.diastolic ?? null
      };
    })(),
    latestAck: summarizeRealtimeControlAck(findLatestRealtimeControlAck(name, startedAt))
  });

  const waitForSharedRealtimeMetric = async (
    name: RwForegroundMetric,
    startedAt: number,
    timeoutMs: number,
    token: number,
    source: string,
    measureStatus?: () => string
  ) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (token !== rwMetricReadToken || activeRwMetric !== name) return null;
      if (!userStore.isConnected) {
        appendRingDiagnosticLog(source, 'single-metric-disconnected', getRwForegroundMeasurementSnapshot(name, startedAt, measureStatus));
        throw new Error('\u8bbe\u5907\u8fde\u63a5\u5df2\u65ad\u5f00\uff0c\u8bf7\u91cd\u65b0\u8fde\u63a5\u540e\u518d\u6d4b\u91cf');
      }
      const latest = getLatestRwForegroundMetricData(name, startedAt);
      const value = getRwForegroundMetricValue(name, latest);
      if (value != null) {
        appendRingDiagnosticLog(source, 'single-metric-wait-hit', {
          ...getRwForegroundMeasurementSnapshot(name, startedAt, measureStatus),
          parsed: summarizeRwForegroundMetric(name, startedAt, latest)
        });
        return latest;
      }

      const diagnosticMetric = getLatestMetricFromDiagnosticLogs(name, startedAt);
      const diagnosticValue = getRwForegroundMetricValue(name, diagnosticMetric);
      if (diagnosticMetric && diagnosticValue != null) {
        writeDirectMetricToStore(source, name, startedAt, diagnosticMetric);
        appendRingDiagnosticLog(source, 'single-metric-diagnostic-log-hit', {
          ...getRwForegroundMeasurementSnapshot(name, startedAt, measureStatus),
          parsed: summarizeRwForegroundMetric(name, startedAt, diagnosticMetric)
        });
        return diagnosticMetric;
      }
      await sleep(200);
    }

    const latestAck = findLatestRealtimeControlAck(name, startedAt);
    appendRingDiagnosticLog(source, 'single-metric-wait-timeout', {
      ...getRwForegroundMeasurementSnapshot(name, startedAt, measureStatus),
      timeoutMs,
      controlAckPreview: summarizeRealtimeControlAck(latestAck)
    });
    throw new Error(`${RW_FOREGROUND_METRIC_LABELS[name]}\u54cd\u5e94\u8d85\u65f6\uff0c\u8bf7\u9760\u8fd1\u6212\u6307\u91cd\u8bd5`);
  };

  const stopActiveRwMeasurement = async (source = 'RW PAGE') => {
    rwMetricReadToken += 1;
    const metric = activeRwMetric;
    activeRwMetric = null;
    if (!metric) return;
    if (!userStore.isConnected) {
      appendRingDiagnosticLog(source, 'single-metric-skip-disable', {
        target: metric,
        reason: 'disconnected'
      });
      return;
    }
    await controlRwHealthData(metric, false).catch(() => undefined);
  };

  const runRwForegroundMeasurement = async (metric: RwForegroundMetric, options: RunRwForegroundMeasurementOptions = {}) => {
    const source = options.source || 'RW PAGE';
    await stopActiveRwMeasurement(source);
    const token = (rwMetricReadToken += 1);
    activeRwMetric = metric;
    const startedAt = options.startedAt || Date.now();
    const timeoutMs =
      options.timeoutMs ??
      RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS_BY_METRIC[metric] ??
      RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS;
    const minActiveMs = Math.max(0, options.minActiveMs || 0);
    const readAtMs = options.readAtMs || RW_FOREGROUND_METRIC_READ_AT_MS_BY_METRIC[metric] || RW_FOREGROUND_METRIC_READ_AT_MS;
    let controlAckPreview: Record<string, any> | null = null;
    appendRingDiagnosticLog(source, 'single-metric-start', {
      target: metric,
      label: RW_FOREGROUND_METRIC_LABELS[metric],
      startedAt,
      buildTag: RW_DIAGNOSTIC_BUILD_TAG,
      expectedKey: RW_REALTIME_METRIC_KEYS[metric],
      pollAtMs: readAtMs,
      resultTimeoutMs: timeoutMs,
      minActiveMs
    });
    const sharedMetricWaiter = waitForSharedRealtimeMetric(metric, startedAt, timeoutMs, token, source, options.measureStatus);
    sharedMetricWaiter.catch(() => undefined);
    let directMetricWaiter: Promise<Record<string, any> | null> | null = null;
    const getDirectMetricWaiter = () => {
      if (!directMetricWaiter) {
        directMetricWaiter = waitForDirectRealtimeMetric(metric, startedAt, timeoutMs, token, source, options.measureStatus).catch(() => null);
      }
      return directMetricWaiter;
    };

    let elapsed = 0;
    let controlEnableAttempted = false;
    try {
      const waitForMetricOrDelay = async (delayMs: number) => {
        const result = await Promise.race([
          sleep(Math.max(0, delayMs)).then(() => null),
          getDirectMetricWaiter(),
          sharedMetricWaiter
        ]);
        return result;
      };
      const waitForMinActiveDuration = async () => {
        const remainingMs = minActiveMs - (Date.now() - startedAt);
        if (remainingMs > 0) await sleep(remainingMs);
      };
      const finishWithMinActiveDuration = async (result: Record<string, any> | null) => {
        if (result) await waitForMinActiveDuration();
        return result;
      };

      controlEnableAttempted = true;
      await controlRwHealthData(metric, true);
      const earlyResult = await waitForMetricOrDelay(200);
      if (earlyResult) return await finishWithMinActiveDuration(earlyResult);
      controlAckPreview = findLatestRealtimeControlAck(metric, startedAt);
      appendRingDiagnosticLog(source, 'single-metric-control-enabled', {
        ...getRwForegroundMeasurementSnapshot(metric, startedAt, options.measureStatus),
        ack: summarizeRealtimeControlAck(controlAckPreview)
      });

      for (const currentMs of readAtMs) {
        const resultBeforeRead = await waitForMetricOrDelay(currentMs - elapsed);
        if (resultBeforeRead) return await finishWithMinActiveDuration(resultBeforeRead);
        elapsed = currentMs;
        if (token !== rwMetricReadToken || activeRwMetric !== metric) return null;
        if (!userStore.isConnected) {
          appendRingDiagnosticLog(source, 'single-metric-disconnected', getRwForegroundMeasurementSnapshot(metric, startedAt, options.measureStatus));
          throw new Error('\u8bbe\u5907\u8fde\u63a5\u5df2\u65ad\u5f00\uff0c\u8bf7\u91cd\u65b0\u8fde\u63a5\u540e\u518d\u6d4b\u91cf');
        }
        appendRingDiagnosticLog(source, 'single-metric-poll-read', {
          ...getRwForegroundMeasurementSnapshot(metric, startedAt, options.measureStatus),
          elapsedMs: currentMs
        });
        await readRwHealthData(metric).catch(() => undefined);
        const resultAfterRead = await waitForMetricOrDelay(250);
        if (resultAfterRead) return await finishWithMinActiveDuration(resultAfterRead);
      }
      const finalResult = (await getDirectMetricWaiter()) || (await sharedMetricWaiter);
      return await finishWithMinActiveDuration(finalResult);
    } catch (error) {
      const latestAck = findLatestRealtimeControlAck(metric, startedAt) || controlAckPreview;
      appendRingDiagnosticLog(source, 'single-metric-failed', {
        ...getRwForegroundMeasurementSnapshot(metric, startedAt, options.measureStatus),
        errorMessage: error instanceof Error ? error.message : String(error),
        ack: summarizeRealtimeControlAck(latestAck)
      });
      throw error;
    } finally {
      if (token === rwMetricReadToken && activeRwMetric === metric) {
        activeRwMetric = null;
        if (userStore.isConnected && controlEnableAttempted) {
          await controlRwHealthData(metric, false).catch(() => undefined);
        } else {
          appendRingDiagnosticLog(source, 'single-metric-skip-disable', {
            target: metric,
            reason: userStore.isConnected ? 'control-not-attempted' : 'disconnected'
          });
        }
      } else {
        appendRingDiagnosticLog(source, 'single-metric-skip-disable', {
          target: metric,
          reason: 'superseded'
        });
      }
    }
  };

  return {
    runRwForegroundMeasurement,
    stopActiveRwMeasurement
  };
};










