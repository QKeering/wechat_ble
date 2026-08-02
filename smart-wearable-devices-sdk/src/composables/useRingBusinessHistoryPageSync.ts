import { useRingBLE } from '@/composables/useRingBLE';
import { submitData, submitRingHistoryRawFrames } from '@/common/api/homeDetail';
import { buildRingRawHistoryFrames, type RingRawHistoryFrame } from '@/api/ringDevice';
import { useRingStore } from '@/stores';
import { useUserStore } from '@/stores/user';
import { formatBleErrorMessage, isExpectedBleRuntimeError } from '@/utils/bleError';
import { hasAnyRingCommunicationReady } from '@/utils/ringConnectionStatus';
import { getRwDiagnosticCommandLock } from '@/utils/rwDiagnosticCommandLock';
import { clearFrontendRingBindingState } from '@/utils/ringBinding';
import {
  assertBackendUploadBinding,
  buildUploadSyncMeta,
  createUploadSessionId,
  markPendingUploadDataDone,
  markPendingUploadDataFailed,
  stagePendingUploadSession,
  uploadPendingRawFramesInBackground
} from '@/utils/dataUploadCompensation';
import { appendRingDiagnosticLog } from './useRwForegroundMeasurement';
import {
  buildRingHistorySubmitRecords,
  getRingHistoryRecordSyncUnixTime,
  getRingSubmitDeviceMac,
  type RingHistorySubmitRecord
} from './useRingHistoryUpload';
import { resolveRingProtocol, type RingDeviceInfo, type RwHistoryDataName } from '@/sdk/ring-ble';

export interface SyncRingBusinessHistoryPageOptions {
  page: string;
  date: string;
  dataTypes: RwHistoryDataName[];
  readAll?: boolean;
  allowRwDeviceSync?: boolean;
  timeoutMs?: number;
}

export interface LogHistoryPageQueryOptions {
  page: string;
  date: string;
  endpoint: string;
  response?: unknown;
  error?: unknown;
}

export interface HistoryPageSilentRequestConfig {
  timeout: number;
  custom: {
    toast: false;
    catch: true;
  };
}

export interface QueryHistoryPageOptions<T> {
  page: string;
  date: string;
  endpoint: string;
  query: (requestConfig: HistoryPageSilentRequestConfig) => Promise<T>;
}

const getIsIOS = () => {
  try {
    return `${uni.getSystemInfoSync().platform || ''}`.toLowerCase().includes('ios');
  } catch {
    return false;
  }
};

const RW_BUSINESS_HISTORY_PAGE_TIMEOUT_MS = 18000;
const SLEEP_HISTORY_LOOKBACK_DAYS = 1;
const EMPTY_HISTORY_FALLBACK_TIMEOUT_MS = 30000;
const MISSING_VITAL_HISTORY_FALLBACK_TIMEOUT_MS = 30000;
const HISTORY_PAGE_LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const HISTORY_PAGE_UPLOAD_ENDPOINT = '/app/data/sync';
const HISTORY_PAGE_UPLOAD_TIMEOUT_MS = 90000;
const HISTORY_PAGE_PENDING_UPLOAD_STORAGE_KEY = 'qkeer:rw-history-page-pending-upload:v1';
const HISTORY_PAGE_PENDING_UPLOAD_MAX_COUNT = 300;
const HISTORY_PAGE_UPLOADED_RECORD_KEYS_STORAGE_KEY = 'qkeer:rw-history-page-uploaded-record-keys:v1';
const HISTORY_PAGE_UPLOADED_RECORD_KEYS_MAX_COUNT = 2000;
const HISTORY_PAGE_SLEEP_BACKFILL_SECONDS = 24 * 60 * 60;
const HISTORY_PAGE_SUBMIT_FAILED_MESSAGE = '历史数据提交失败';
const HISTORY_PAGE_FALLBACK_READ_FAILED_MESSAGE = '历史数据兜底读取失败';
const HISTORY_PAGE_EMPTY_FALLBACK_EVENTS = {
  start: 'history-page-empty-fallback-start',
  result: 'history-page-empty-fallback-result',
  uploadFailed: 'history-page-empty-fallback-upload-failed',
  failed: 'history-page-empty-fallback-failed'
};
const HISTORY_PAGE_MISSING_STEP_SLEEP_FALLBACK_EVENTS = {
  start: 'history-page-missing-step-sleep-fallback-start',
  result: 'history-page-missing-step-sleep-fallback-result',
  uploadFailed: 'history-page-missing-step-sleep-fallback-upload-failed',
  failed: 'history-page-missing-step-sleep-fallback-failed'
};
const HISTORY_PAGE_MISSING_VITAL_FALLBACK_EVENTS = {
  start: 'history-page-missing-vital-fallback-start',
  result: 'history-page-missing-vital-fallback-result',
  uploadFailed: 'history-page-missing-vital-fallback-upload-failed',
  failed: 'history-page-missing-vital-fallback-failed'
};
type HistoryPageVitalMetric = 'heartRate' | 'spo2' | 'hrv' | 'stress' | 'temperature' | 'bloodSugar' | 'bloodPressure';
const HISTORY_PAGE_VITAL_METRIC_DATA_TYPES: Record<HistoryPageVitalMetric, RwHistoryDataName[]> = {
  heartRate: ['heartRate'],
  spo2: ['bloodOxygen'],
  hrv: ['hrv'],
  stress: ['stress'],
  temperature: ['temperature'],
  bloodSugar: ['bloodSugar'],
  bloodPressure: ['bloodPressure']
};
const getHistoryPageSilentRequestConfig = (): HistoryPageSilentRequestConfig => ({
  timeout: HISTORY_PAGE_UPLOAD_TIMEOUT_MS,
  custom: { toast: false, catch: true }
});
const getHistoryPageRawError = (error: unknown) => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return '';
  const record = error as Record<string, any>;
  return record.rawMsg || record.rawError || record.errMsg || record.message || record.msg || '';
};

const formatHistoryPageLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const shiftHistoryPageLocalDate = (date: string, deltaDays: number) => {
  const trimmed = `${date || ''}`.trim();
  const match = trimmed.match(HISTORY_PAGE_LOCAL_DATE_PATTERN);
  if (!match) return trimmed;
  const localDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  localDate.setDate(localDate.getDate() + deltaDays);
  return formatHistoryPageLocalDate(localDate);
};

const hasSleepHistoryDataType = (dataTypes: RwHistoryDataName[]) =>
  dataTypes.some((type) => `${type || ''}`.toLowerCase().replace(/[\s_-]/g, '').includes('sleep'));

const hasStepOrSleepHistoryDataType = (dataTypes: RwHistoryDataName[]) =>
  dataTypes.some((type) => {
    const compact = `${type || ''}`.toLowerCase().replace(/[\s_-]/g, '');
    return compact.includes('sleep') || compact.includes('activity') || compact.includes('step') || compact.includes('sport');
  });

const hasActivityHistoryDataType = (dataTypes: RwHistoryDataName[]) =>
  dataTypes.some((type) => {
    const compact = `${type || ''}`.toLowerCase().replace(/[\s_-]/g, '');
    return compact.includes('activity') || compact.includes('step') || compact.includes('sport');
  });

const getMissingStepSleepHistoryMetrics = (dataTypes: RwHistoryDataName[], metricCounts: Record<string, number>) => {
  const missing: string[] = [];
  if (hasActivityHistoryDataType(dataTypes) && !metricCounts.stepCount) missing.push('stepCount');
  if (hasSleepHistoryDataType(dataTypes) && !metricCounts.sleep) missing.push('sleep');
  return missing;
};

const getFocusedStepSleepFallbackDataTypes = (missingMetrics: string[]): RwHistoryDataName[] => {
  if (missingMetrics.includes('stepCount')) return ['activity'];
  if (missingMetrics.includes('sleep')) return ['sleepData'];
  return [];
};

const normalizeHistoryPageDataType = (type: RwHistoryDataName) => `${type || ''}`.toLowerCase().replace(/[\s_-]/g, '');

const addHistoryPageVitalMetric = (metrics: Set<HistoryPageVitalMetric>, metric: HistoryPageVitalMetric) => {
  metrics.add(metric);
};

const getExpectedVitalHistoryMetrics = (dataTypes: RwHistoryDataName[]) => {
  const expected = new Set<HistoryPageVitalMetric>();
  dataTypes.forEach((type) => {
    const compact = normalizeHistoryPageDataType(type);
    if (!compact) return;
    if (['lastdata', 'lastsnapshot', 'snapshot', 'vital', 'vitals', 'vitalsigns', 'dailyhealth', 'summary'].includes(compact)) {
      addHistoryPageVitalMetric(expected, 'heartRate');
      addHistoryPageVitalMetric(expected, 'spo2');
      addHistoryPageVitalMetric(expected, 'hrv');
      // 首页压力由后端根据已入库指标计算，摘要类历史同步不再主动补读设备 stress。
      addHistoryPageVitalMetric(expected, 'temperature');
      return;
    }
    if (compact.includes('heart') || compact === 'hr' || compact === 'heartrate') addHistoryPageVitalMetric(expected, 'heartRate');
    if (compact.includes('oxygen') || compact === 'spo2' || compact === 'sp02') addHistoryPageVitalMetric(expected, 'spo2');
    if (compact.includes('hrv')) addHistoryPageVitalMetric(expected, 'hrv');
    if (compact.includes('stress')) addHistoryPageVitalMetric(expected, 'stress');
    if (compact.includes('temperature') || compact.includes('temp')) addHistoryPageVitalMetric(expected, 'temperature');
    if (compact.includes('bloodsugar') || compact.includes('glucose')) addHistoryPageVitalMetric(expected, 'bloodSugar');
    if (compact.includes('bloodpressure') || compact === 'bp') addHistoryPageVitalMetric(expected, 'bloodPressure');
  });
  return Array.from(expected);
};

const getMissingVitalHistoryMetrics = (dataTypes: RwHistoryDataName[], metricCounts: Record<string, number>) =>
  getExpectedVitalHistoryMetrics(dataTypes).filter((metric) => !metricCounts[metric]);

const getVitalFallbackDataTypes = (metrics: HistoryPageVitalMetric[]) =>
  Array.from(new Set(metrics.flatMap((metric) => HISTORY_PAGE_VITAL_METRIC_DATA_TYPES[metric] || [])));

const getHistoryPageStartDate = (date: string, dataTypes: RwHistoryDataName[], readAll = false) => {
  const trimmed = `${date || ''}`.trim();
  if (readAll || !hasSleepHistoryDataType(dataTypes)) return trimmed;
  return shiftHistoryPageLocalDate(trimmed, -SLEEP_HISTORY_LOOKBACK_DAYS);
};

const getHistoryPageSinceTimestamp = (date: string, readAll = false) => {
  if (readAll) return 0;
  const timestamp = Date.parse(`${date || ''}`.trim().replace(/-/g, '/'));
  if (!Number.isFinite(timestamp)) return 0;
  return Math.floor(timestamp / 1000);
};

const pickHistoryPageRecordValue = (record: Record<string, any>, aliases: string[]) => {
  for (const alias of aliases) {
    const value = record?.[alias];
    if (value !== undefined && value !== null && value !== '') return value;
  }

  const lowerCaseEntries = Object.entries(record || {}).reduce<Record<string, any>>((result, [key, value]) => {
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

const formatHistoryPageRecordHex = (value: unknown, maxBytes = 32) => {
  if (!Array.isArray(value)) return undefined;
  const bytes = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => item & 0xff)
    .slice(0, maxBytes);
  return bytes.length > 0 ? bytes.map((item) => item.toString(16).padStart(2, '0')).join('') : undefined;
};

const summarizeHistoryPageRecord = (record: Record<string, any>) => ({
  dataType: pickHistoryPageRecordValue(record, ['dataType', 'rawDataType', 'fileType', 'type']),
  rawDataType: pickHistoryPageRecordValue(record, ['rawDataType', 'fileType', 'sourceType']),
  key: pickHistoryPageRecordValue(record, ['key', 'dataKey']),
  flag: pickHistoryPageRecordValue(record, ['flag']),
  status: pickHistoryPageRecordValue(record, ['status', 'statusText']),
  recordTime: pickHistoryPageRecordValue(record, ['recordTime', 'timestampText', 'time']),
  unixTime: pickHistoryPageRecordValue(record, ['unixTime', 'timestamp', 'startTimestamp', 'recordTimestamp']),
  startTime: pickHistoryPageRecordValue(record, ['startTime', 'start_time', 'startTimestamp', 'start_timestamp', 'beginTime', 'begin_time']),
  endTime: pickHistoryPageRecordValue(record, ['endTime', 'end_time', 'endTimestamp', 'end_timestamp', 'stopTime', 'stop_time', 'finishTime', 'finish_time']),
  dateRef: pickHistoryPageRecordValue(record, ['dateRef', 'date_ref', 'recordDate', 'record_date', 'day', 'date']),
  metrics: {
    stepCount: pickHistoryPageRecordValue(record, ['stepCount', 'step_count', 'step', 'steps', 'totalSteps']),
    rawStepCount: pickHistoryPageRecordValue(record, ['rawStepCount', 'raw_step_count', 'cumulativeStepCount', 'cumulative_step_count']),
    heartRate: pickHistoryPageRecordValue(record, ['heartRate', 'heart_rate', 'heartrate', 'hr']),
    bloodOxygen: pickHistoryPageRecordValue(record, ['bloodOxygen', 'blood_oxygen', 'bloodOxygenSaturation', 'bloodOxy', 'spo2', 'oxygen', 'bo']),
    hrv: pickHistoryPageRecordValue(record, ['hrv', 'heartRateVariability', 'heart_rate_variability']),
    stress: pickHistoryPageRecordValue(record, ['stress', 'stressIndex', 'stress_index', 'pressure', 'fatigue']),
    bloodSugar: pickHistoryPageRecordValue(record, ['bloodSugar', 'blood_sugar', 'bloodSugarValue', 'blood_sugar_value', 'glucose', 'sugar']),
    bloodPressure: pickHistoryPageRecordValue(record, ['bloodPressure', 'blood_pressure', 'bloodPressureValue', 'blood_pressure_value', 'bp', 'bpValue', 'bp_value']),
    systolic: pickHistoryPageRecordValue(record, [
      'systolic',
      'systolicValue',
      'systolic_value',
      'sbp',
      'sp',
      'high',
      'highPressure',
      'high_pressure',
      'bloodPressureHigh',
      'blood_pressure_high'
    ]),
    diastolic: pickHistoryPageRecordValue(record, [
      'diastolic',
      'diastolicValue',
      'diastolic_value',
      'dbp',
      'dp',
      'low',
      'lowPressure',
      'low_pressure',
      'bloodPressureLow',
      'blood_pressure_low'
    ]),
    temperature: pickHistoryPageRecordValue(record, [
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
    sleepState: pickHistoryPageRecordValue(record, ['sleepState', 'sleep_state', 'sleepStage', 'sleep_stage', 'sleepType', 'sleep_type', 'stage']),
    sleepDuration: pickHistoryPageRecordValue(record, [
      'sleepDuration',
      'sleep_duration',
      'durationMinutes',
      'duration_minutes',
      'sleepMinutes',
      'sleep_minutes',
      'totalSleepTime',
      'total_sleep_time',
      'len'
    ])
  },
  rawHex: formatHistoryPageRecordHex(record.raw),
  dataHex: formatHistoryPageRecordHex(record.data),
  keys: Object.keys(record || {}).slice(0, 20)
});

const countHistoryPageRecordMetrics = (records: Array<Record<string, any>> = []) => {
  const counters: Record<string, number> = {};
  const bump = (key: string) => {
    counters[key] = (counters[key] || 0) + 1;
  };
  const toFiniteNumber = (value: unknown) => {
    const numeric = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  };
  const isPositiveMetric = (value: unknown) => {
    const numeric = toFiniteNumber(value);
    return numeric != null && numeric > 0;
  };
  const isValidSleepState = (value: unknown) => {
    const numeric = toFiniteNumber(value);
    return numeric != null && numeric >= 1 && numeric <= 5;
  };
  const isPlausibleTemperature = (value: unknown) => {
    const numeric = toFiniteNumber(value);
    return numeric != null && numeric >= 25 && numeric <= 45;
  };

  records.forEach((record) => {
    const metrics = summarizeHistoryPageRecord(record).metrics;
    const typeText = `${pickHistoryPageRecordValue(record, ['dataType', 'rawDataType', 'fileType', 'type']) || ''}`.toLowerCase();
    const typedValue = pickHistoryPageRecordValue(record, ['value', 'val', 'measurement', 'measureValue', 'avg', 'average']);
    if (isPositiveMetric(metrics.stepCount) || isPositiveMetric(metrics.rawStepCount) || (/step|sport|activity/.test(typeText) && isPositiveMetric(typedValue))) bump('stepCount');
    if (metrics.heartRate != null || (/heart[_-]?rate|(^|[_\-.])hr($|[_\-.])/.test(typeText) && typedValue != null)) bump('heartRate');
    if (metrics.bloodOxygen != null || (/blood[_-]?oxygen|spo2|oxygen/.test(typeText) && typedValue != null)) bump('spo2');
    if (metrics.hrv != null || (/hrv/.test(typeText) && typedValue != null)) bump('hrv');
    if (metrics.stress != null || (/stress|fatigue/.test(typeText) && typedValue != null)) bump('stress');
    if (metrics.bloodSugar != null || (/blood[_-]?sugar|glucose|sugar/.test(typeText) && typedValue != null)) bump('bloodSugar');
    if (
      metrics.bloodPressure != null ||
      metrics.systolic != null ||
      metrics.diastolic != null ||
      (/blood[_-]?pressure|(^|[_\-.])bp($|[_\-.])/.test(typeText) && typedValue != null)
    ) {
      bump('bloodPressure');
    }
    if (isPlausibleTemperature(metrics.temperature) || (/temperature|temp/.test(typeText) && isPlausibleTemperature(typedValue))) bump('temperature');
    if (
      isValidSleepState(metrics.sleepState) ||
      isPositiveMetric(metrics.sleepDuration) ||
      (/sleep/.test(typeText) && isValidSleepState(typedValue))
    ) {
      bump('sleep');
    }
  });

  return counters;
};

const countHistoryPageSubmitMetrics = (records: Array<Record<string, any>> = [], sinceTimestamp = 0) =>
  countHistoryPageRecordMetrics(buildRingHistorySubmitRecords(records as any, sinceTimestamp) as any);

interface HistoryPagePendingUpload {
  deviceMac: string;
  dataList: RingHistorySubmitRecord[];
  updatedAt: number;
  attemptCount: number;
}

interface HistoryPageUploadedRecordKeys {
  deviceMac: string;
  keys: string[];
  updatedAt: number;
}

const readHistoryPagePendingUpload = (): HistoryPagePendingUpload | null => {
  try {
    const stored = uni.getStorageSync(HISTORY_PAGE_PENDING_UPLOAD_STORAGE_KEY);
    if (!stored || typeof stored !== 'object') return null;
    const record = stored as Partial<HistoryPagePendingUpload>;
    const dataList = Array.isArray(record.dataList)
      ? record.dataList.filter((item): item is RingHistorySubmitRecord => Boolean(item && typeof item === 'object' && item.recordTime))
      : [];
    if (!record.deviceMac || dataList.length === 0) return null;
    return {
      deviceMac: String(record.deviceMac),
      dataList,
      updatedAt: Number(record.updatedAt || 0),
      attemptCount: Number(record.attemptCount || 0)
    };
  } catch {
    return null;
  }
};

const getHistoryPageSubmitRecordKey = (record: RingHistorySubmitRecord) =>
  JSON.stringify({
    t: record.recordTime,
    step: record.stepCount,
    rawStep: (record as any).rawStepCount,
    hr: record.heartRate,
    hrv: record.hrv,
    spo2: record.spo2,
    stress: record.stress,
    temp: record.temperature,
    sugar: record.bloodSugar,
    sbp: record.systolic,
    dbp: record.diastolic,
    sleep: record.sleepState,
    dur: record.sleepDuration,
    start: record.startTime,
    end: record.endTime,
    dateRef: record.dateRef
  });

const mergeHistoryPageSubmitRecords = (...groups: RingHistorySubmitRecord[][]) => {
  const merged = new Map<string, RingHistorySubmitRecord>();
  groups.flat().forEach((record) => {
    if (!record?.recordTime) return;
    merged.set(getHistoryPageSubmitRecordKey(record), record);
  });
  return Array.from(merged.values()).slice(-HISTORY_PAGE_PENDING_UPLOAD_MAX_COUNT);
};

const writeHistoryPagePendingUpload = (
  deviceMac: string,
  dataList: RingHistorySubmitRecord[],
  attemptCount: number
): HistoryPagePendingUpload | null => {
  const pending: HistoryPagePendingUpload = {
    deviceMac,
    dataList: mergeHistoryPageSubmitRecords(dataList),
    updatedAt: Date.now(),
    attemptCount
  };
  if (pending.dataList.length === 0) return null;
  try {
    uni.setStorageSync(HISTORY_PAGE_PENDING_UPLOAD_STORAGE_KEY, pending);
    return pending;
  } catch {
    return null;
  }
};

const clearHistoryPagePendingUpload = (deviceMac: string) => {
  try {
    const pending = readHistoryPagePendingUpload();
    if (!pending || pending.deviceMac === deviceMac) {
      uni.removeStorageSync(HISTORY_PAGE_PENDING_UPLOAD_STORAGE_KEY);
    }
  } catch {
    // Ignore local storage cleanup failures.
  }
};

const readHistoryPageUploadedRecordKeys = (deviceMac: string) => {
  try {
    const stored = uni.getStorageSync(HISTORY_PAGE_UPLOADED_RECORD_KEYS_STORAGE_KEY);
    if (!stored || typeof stored !== 'object') return new Set<string>();
    const record = stored as Partial<HistoryPageUploadedRecordKeys>;
    if (!record.deviceMac || String(record.deviceMac) !== deviceMac) return new Set<string>();
    if (!Array.isArray(record.keys)) return new Set<string>();
    return new Set(record.keys.filter(Boolean).map((item) => String(item)));
  } catch {
    return new Set<string>();
  }
};

const writeHistoryPageUploadedRecordKeys = (deviceMac: string, keys: string[]) => {
  const previous = readHistoryPageUploadedRecordKeys(deviceMac);
  keys.filter(Boolean).forEach((key) => previous.add(String(key)));
  const payload: HistoryPageUploadedRecordKeys = {
    deviceMac,
    keys: Array.from(previous).slice(-HISTORY_PAGE_UPLOADED_RECORD_KEYS_MAX_COUNT),
    updatedAt: Date.now()
  };
  try {
    uni.setStorageSync(HISTORY_PAGE_UPLOADED_RECORD_KEYS_STORAGE_KEY, payload);
    return payload.keys.length;
  } catch {
    return previous.size;
  }
};

const filterAlreadyUploadedHistoryPageRecords = (
  records: RingHistorySubmitRecord[],
  uploadedKeys: Set<string>
) => {
  const submitRecords: RingHistorySubmitRecord[] = [];
  const alreadyUploadedRecords: RingHistorySubmitRecord[] = [];
  records.forEach((record) => {
    if (!record?.recordTime) return;
    if (uploadedKeys.has(getHistoryPageSubmitRecordKey(record))) {
      alreadyUploadedRecords.push(record);
      return;
    }
    submitRecords.push(record);
  });
  return { submitRecords, alreadyUploadedRecords };
};

const isHistoryPageSleepSubmitRecord = (record: RingHistorySubmitRecord) => {
  const sourceType = String((record as Record<string, any>)?.sourceType || '').toLowerCase();
  if (sourceType === 'l19_sleep_segment' || sourceType.startsWith('rw_sleep')) return true;
  return Boolean(
    record.sleepState != null ||
      record.sleepType != null ||
      record.sleepDuration != null ||
      (record as Record<string, any>).sleepTime != null ||
      record.startTime ||
      record.endTime
  );
};

const isHistoryPageRecordAfterLastReadWindow = (record: RingHistorySubmitRecord, lastReadTimestamp: number) => {
  if (!lastReadTimestamp) return true;
  const unixTime = getRingHistoryRecordSyncUnixTime(record);
  if (!unixTime) return true;
  if (!isHistoryPageSleepSubmitRecord(record)) return unixTime > lastReadTimestamp;
  return unixTime > Math.max(0, lastReadTimestamp - HISTORY_PAGE_SLEEP_BACKFILL_SECONDS);
};

const summarizeHistoryPageSubmitResponse = (response: unknown) => {
  const root = getHistoryPageResponseObject(response);
  const payload = root?.data ?? root?.result ?? response;
  const payloadObject = getHistoryPageResponseObject(payload);
  const summarySource: Record<string, any> = payloadObject || root || {};
  return {
    hasResponse: response !== null && response !== undefined,
    rootKeys: root ? Object.keys(root).slice(0, 12) : [],
    code: root?.code ?? root?.status ?? payloadObject?.code ?? payloadObject?.status,
    message: root?.message ?? root?.msg ?? payloadObject?.message ?? payloadObject?.msg,
    success: summarySource.success,
    count: summarySource.count,
    inputCount: summarySource.inputCount,
    elapsedMs: summarySource.elapsedMs,
    syncElapsedMs: summarySource.syncElapsedMs,
    healthCount: summarySource.healthCount,
    sleepCount: summarySource.sleepCount,
    failCount: summarySource.failCount,
    healthWriteMs: summarySource.healthWriteMs,
    sleepWriteMs: summarySource.sleepWriteMs,
    deviceUpdateMs: summarySource.deviceUpdateMs,
    summaryMs: summarySource.summaryMs,
    summarySkipped: summarySource.summarySkipped,
    summaryScheduled: summarySource.summaryScheduled,
    touchedDates: Array.isArray(summarySource.touchedDates) ? summarySource.touchedDates.slice(0, 4) : summarySource.touchedDates,
    summaryDates: Array.isArray(summarySource.summaryDates) ? summarySource.summaryDates.slice(0, 4) : summarySource.summaryDates
  };
};

const getHistoryPageResponseObject = (response: unknown): Record<string, any> | null => {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  return response as Record<string, any>;
};

const summarizeHistoryPageQueryResponse = (response: unknown) => {
  const root = getHistoryPageResponseObject(response);
  const payload = root?.data ?? root?.result ?? root?.list ?? response;
  const payloadObject = getHistoryPageResponseObject(payload);
  const payloadArray = Array.isArray(payload)
    ? payload
    : Array.isArray(payloadObject?.list)
      ? payloadObject.list
      : Array.isArray(payloadObject?.records)
        ? payloadObject.records
        : Array.isArray(payloadObject?.data)
          ? payloadObject.data
          : null;

  const valueHints = payloadObject
    ? {
        score: pickHistoryPageRecordValue(payloadObject, ['score', 'sleepScore', 'healthScore']),
        total: pickHistoryPageRecordValue(payloadObject, ['total', 'totalCount', 'count']),
        duration: pickHistoryPageRecordValue(payloadObject, ['duration', 'sleepDuration', 'activeMinutes', 'activityMinutes']),
        heartRate: pickHistoryPageRecordValue(payloadObject, ['heartRate', 'heart_rate', 'avgHeartRate', 'averageHeartRate']),
        bloodOxygen: pickHistoryPageRecordValue(payloadObject, ['bloodOxygen', 'spo2', 'avgSpo2', 'oxygen']),
        hrv: pickHistoryPageRecordValue(payloadObject, [
          'hrv',
          'hrvAvg',
          'avgHrv',
          'avgHrvValue',
          'latestHrvValue',
          'dailyAvgHrvValue',
          'heartRateVariability',
          'heartRateVariabilityAvg'
        ]),
        stress: pickHistoryPageRecordValue(payloadObject, [
          'stress',
          'stressValue',
          'stressIndex',
          'avgStress',
          'avgStressValue',
          'stressAvg',
          'todayStressScore',
          'weekAvgStressScore'
        ]),
        temperature: pickHistoryPageRecordValue(payloadObject, [
          'temperature',
          'temperatureAvg',
          'avgTemperature',
          'bodyTemperature',
          'bodyTemperatureAvg',
          'skinTemperature',
          'skinTemperatureAvg',
          'newValue',
          'avgValue'
        ]),
        bloodSugar: pickHistoryPageRecordValue(payloadObject, [
          'bloodSugar',
          'blood_sugar',
          'bloodSugarValue',
          'blood_sugar_value',
          'bloodSugarAvg',
          'avgBloodSugar',
          'glucose',
          'sugar'
        ]),
        bloodPressure: pickHistoryPageRecordValue(payloadObject, [
          'bloodPressure',
          'blood_pressure',
          'bloodPressureValue',
          'blood_pressure_value',
          'bp',
          'bpValue',
          'bp_value'
        ]),
        systolic: pickHistoryPageRecordValue(payloadObject, ['systolic', 'systolicValue', 'systolicAvg', 'sbp', 'sp', 'highPressure', 'bloodPressureHigh']),
        diastolic: pickHistoryPageRecordValue(payloadObject, ['diastolic', 'diastolicValue', 'diastolicAvg', 'dbp', 'dp', 'lowPressure', 'bloodPressureLow']),
        stepCount: pickHistoryPageRecordValue(payloadObject, ['stepCount', 'steps', 'totalSteps'])
      }
    : {};

  return {
    hasResponse: response !== null && response !== undefined,
    rootType: Array.isArray(response) ? 'array' : typeof response,
    rootKeys: root ? Object.keys(root).slice(0, 20) : [],
    payloadType: Array.isArray(payload) ? 'array' : typeof payload,
    payloadKeys: payloadObject ? Object.keys(payloadObject).slice(0, 20) : [],
    itemCount: payloadArray ? payloadArray.length : undefined,
    sample: payloadArray?.slice(0, 1).map((item) => (item && typeof item === 'object' ? summarizeHistoryPageRecord(item as Record<string, any>) : item)),
    valueHints
  };
};

export const useRingBusinessHistoryPageSync = () => {
  const ringBle = useRingBLE();
  const ringStore = useRingStore();
  const userStore = useUserStore();

  const hasProtocolCandidate = (device?: Record<string, unknown> | null) =>
    Boolean(device?.protocol || device?.deviceId || device?.mac || device?.name || device?.deviceName);
  const getProtocolCandidate = () => {
    const candidates = [
      ringBle.deviceInfo.value,
      ringStore.deviceInfo,
      userStore.deviceInfo,
      ringStore.boundDevice
    ];
    const candidate = candidates.find((device) => hasProtocolCandidate(device as Record<string, unknown>)) as RingDeviceInfo | undefined;
    if (!candidate) return {};
    return {
      ...candidate,
      name: candidate.name || candidate.deviceName
    };
  };
  const getCurrentProtocol = () => resolveRingProtocol(getProtocolCandidate() as RingDeviceInfo);
  const isCurrentRwRing = () => getCurrentProtocol() === 'rw';
  const hasCurrentCommunicationReady = () => hasAnyRingCommunicationReady(ringBle.deviceInfo.value, ringStore.deviceInfo, userStore.deviceInfo);

  const ensureHistoryPageReady = async (details: Record<string, unknown>) => {
    if (hasCurrentCommunicationReady()) return true;

    appendRingDiagnosticLog('RW PAGE', 'history-page-restore-start', details);
    try {
      const restored = await ringBle.autoConnectLastDevice();
      appendRingDiagnosticLog('RW PAGE', 'history-page-restore-result', {
        ...details,
        restored,
        ready: hasCurrentCommunicationReady()
      });
      return Boolean(restored || hasCurrentCommunicationReady());
    } catch (error) {
      appendRingDiagnosticLog('RW PAGE', 'history-page-restore-failed', {
        ...details,
        error: formatBleErrorMessage(error, '设备恢复失败')
      });
      return false;
    }
  };

  const getHistoryPageResultRecords = (result: Awaited<ReturnType<typeof ringBle.readLocalData>>) =>
    Array.isArray((result as any)?.records) ? ((result as any).records as Array<Record<string, any>>) : [];

  const getHistoryPageRawUploadFrames = (results: Array<unknown>, deviceMac: string): RingRawHistoryFrame[] => {
    const keyedFrames = new Map<string, RingRawHistoryFrame>();
    for (const result of results) {
      if (!result || typeof result !== 'object') continue;
      const parsed = ((result as any).parsed && typeof (result as any).parsed === 'object' ? (result as any).parsed : result) as Record<string, any>;
      const records = getHistoryPageResultRecords(result as Awaited<ReturnType<typeof ringBle.readLocalData>>);
      const frames = buildRingRawHistoryFrames(records, parsed, deviceMac);
      frames.forEach((frame) => {
        if (frame.rawHash) keyedFrames.set(frame.rawHash, frame);
      });
    }
    return Array.from(keyedFrames.values());
  };

  const uploadHistoryPageRecords = async (
    records: Array<Record<string, any>>,
    details: Record<string, unknown>,
    sinceTimestamp: number,
    rawResults: Array<unknown> = []
  ) => {
    const deviceMac = getRingSubmitDeviceMac(
      userStore,
      getIsIOS(),
      ringBle.deviceInfo.value,
      ringStore.deviceInfo,
      ringStore.boundDevice,
      getProtocolCandidate()
    );
    if (!deviceMac) {
      appendRingDiagnosticLog('RW PAGE', 'history-page-upload-skip', {
        ...details,
        reason: 'missing-device-mac',
        rawRecordCount: records.length,
        rawRecordSample: records.slice(0, 2).map(summarizeHistoryPageRecord)
      });
      return null;
    }

    const backendBinding = await assertBackendUploadBinding(deviceMac, getHistoryPageSilentRequestConfig() as any);
    if (!backendBinding.ok) {
      appendRingDiagnosticLog('RW PAGE', 'history-page-upload-skip', {
        ...details,
        reason: 'backend-current-binding-invalid',
        reasonCode: backendBinding.reasonCode,
        message: backendBinding.reason,
        deviceMac,
        backendDeviceMac: backendBinding.deviceMac,
        backendDevice: backendBinding.device,
        rawRecordCount: records.length,
        rawRecordSample: records.slice(0, 2).map(summarizeHistoryPageRecord)
      });
      if (backendBinding.reasonCode === 'NO_ACTIVE_BINDING' || backendBinding.reasonCode === 'BOUND_DEVICE_MISMATCH') {
        await clearFrontendRingBindingState(userStore, ringStore);
      }
      return null;
    }

    const rawFrames = getHistoryPageRawUploadFrames(rawResults, deviceMac);
    let rawSubmitResponse: unknown = rawFrames.length > 0
      ? { rawStatus: 'pending', rawFrameCount: rawFrames.length }
      : { rawStatus: 'none', rawFrameCount: 0 };
    if (false && rawFrames.length > 0) {
      try {
        rawSubmitResponse = await submitRingHistoryRawFrames({ deviceMac, frames: rawFrames }, getHistoryPageSilentRequestConfig());
      } catch (rawUploadError) {
        appendRingDiagnosticLog('RW PAGE', 'history-page-raw-upload-failed', {
          ...details,
          deviceMac,
          rawFrameCount: rawFrames.length,
          error: formatBleErrorMessage(rawUploadError, '原始历史数据保存失败'),
          rawError: getHistoryPageRawError(rawUploadError)
        });
        return null;
      }
    }

    const maxVisibleTimestamp = Math.floor(Date.now() / 1000) + 10 * 60;
    const futureFilteredRecords = records.filter((record) => {
      const unixTime = getRingHistoryRecordSyncUnixTime(record);
      return Boolean(unixTime && unixTime > maxVisibleTimestamp);
    });
    const visibleRecords = records.filter((record) => {
      const unixTime = getRingHistoryRecordSyncUnixTime(record);
      return !unixTime || unixTime <= maxVisibleTimestamp;
    });
    const filteredRecords = visibleRecords.filter((record) => {
      const unixTime = getRingHistoryRecordSyncUnixTime(record);
      const recordSubmitPreview = buildRingHistorySubmitRecords([record] as any, sinceTimestamp);
      const isSleepRecord = recordSubmitPreview.some((item) => isHistoryPageSleepSubmitRecord(item));
      const recordSinceTimestamp =
        sinceTimestamp && isSleepRecord ? Math.max(0, sinceTimestamp - HISTORY_PAGE_SLEEP_BACKFILL_SECONDS) : sinceTimestamp;
      if (recordSinceTimestamp && unixTime && unixTime < recordSinceTimestamp) return true;
      return recordSubmitPreview.length === 0;
    });
    const currentSubmitRecords = buildRingHistorySubmitRecords(visibleRecords as any, sinceTimestamp);
    const uploadLastReadTimestamp = Number(userStore.lastReadTimestamp || 0);
    const lastReadFilteredRecords = uploadLastReadTimestamp > 0
      ? currentSubmitRecords.filter((record) => {
          return !isHistoryPageRecordAfterLastReadWindow(record, uploadLastReadTimestamp);
        })
      : [];
    const currentCandidateRecords = uploadLastReadTimestamp > 0
      ? currentSubmitRecords.filter((record) => {
          return isHistoryPageRecordAfterLastReadWindow(record, uploadLastReadTimestamp);
        })
      : currentSubmitRecords;
    const uploadedRecordKeys = readHistoryPageUploadedRecordKeys(deviceMac);
    const currentUploadSplit = filterAlreadyUploadedHistoryPageRecords(currentCandidateRecords, uploadedRecordKeys);
    const pendingUpload = readHistoryPagePendingUpload();
    const pendingRecords: RingHistorySubmitRecord[] = pendingUpload && pendingUpload.deviceMac === deviceMac
      ? pendingUpload.dataList.filter((record) => !uploadedRecordKeys.has(getHistoryPageSubmitRecordKey(record)))
      : [];
    const pendingDroppedForOtherDevice = Boolean(pendingUpload && pendingUpload.deviceMac !== deviceMac);
    if (pendingDroppedForOtherDevice) clearHistoryPagePendingUpload(pendingUpload?.deviceMac || '');
    const submitPreviewRecords = mergeHistoryPageSubmitRecords(pendingRecords, currentUploadSplit.submitRecords);

    if (submitPreviewRecords.length === 0) {
      appendRingDiagnosticLog('RW PAGE', 'history-page-upload-skip', {
        ...details,
        reason: records.length === 0 ? 'no-records' : 'no-submittable-records',
        deviceMac,
        rawFrameCount: rawFrames.length,
        rawFrameStored: rawFrames.length > 0,
        rawSubmitResponse,
        rawRecordCount: records.length,
        currentSubmitRecordCount: currentSubmitRecords.length,
        currentCandidateRecordCount: currentCandidateRecords.length,
        lastReadFilteredRecordCount: lastReadFilteredRecords.length,
        uploadLastReadTimestamp,
        newSubmitRecordCount: currentUploadSplit.submitRecords.length,
        alreadyUploadedCount: currentUploadSplit.alreadyUploadedRecords.length,
        uploadedRecordKeyCount: uploadedRecordKeys.size,
        filteredOutCount: filteredRecords.length,
        futureFilteredOutCount: futureFilteredRecords.length,
        pendingUploadCount: pendingRecords.length,
        pendingDroppedForOtherDevice,
        rawMetricCounts: countHistoryPageRecordMetrics(records),
        submitMetricCounts: countHistoryPageRecordMetrics(submitPreviewRecords as any),
        rawRecordSample: records.slice(0, 2).map(summarizeHistoryPageRecord),
        filteredRecordSample: filteredRecords.slice(0, 2).map(summarizeHistoryPageRecord),
        futureFilteredRecordSample: futureFilteredRecords.slice(0, 2).map(summarizeHistoryPageRecord)
      });
      if (rawFrames.length > 0) {
        const rawOnlySession = stagePendingUploadSession({
          uploadSessionId: createUploadSessionId(`${String(getProtocolCandidate() || 'history')}_raw`),
          deviceMac: String(deviceMac),
          protocol: String(getProtocolCandidate() || ''),
          bindingId: backendBinding.bindingId == null ? undefined : String(backendBinding.bindingId),
          bindingVersion: backendBinding.bindingVersion == null ? undefined : String(backendBinding.bindingVersion),
          dataUserId: backendBinding.dataUserId == null ? undefined : String(backendBinding.dataUserId),
          dataList: [],
          rawFrames
        });
        void uploadPendingRawFramesInBackground(rawOnlySession, (params) =>
          submitRingHistoryRawFrames(params, getHistoryPageSilentRequestConfig())
        ).catch((rawUploadError) => {
          appendRingDiagnosticLog('RW PAGE', 'history-page-raw-upload-failed', {
            ...details,
            reason: 'no-submittable-records',
            uploadSessionId: rawOnlySession.uploadSessionId,
            deviceMac,
            rawFrameCount: rawFrames.length,
            error: formatBleErrorMessage(rawUploadError, 'raw history upload failed'),
            rawError: getHistoryPageRawError(rawUploadError)
          });
        });
      }
      return null;
    }
    const uploadSession = stagePendingUploadSession({
      uploadSessionId: createUploadSessionId(String(getProtocolCandidate() || 'history')),
      deviceMac: String(deviceMac),
      protocol: String(getProtocolCandidate() || ''),
      bindingId: backendBinding.bindingId == null ? undefined : String(backendBinding.bindingId),
      bindingVersion: backendBinding.bindingVersion == null ? undefined : String(backendBinding.bindingVersion),
      dataUserId: backendBinding.dataUserId == null ? undefined : String(backendBinding.dataUserId),
      dataList: submitPreviewRecords,
      rawFrames
    });
    const uploadDetails = {
      ...details,
      endpoint: HISTORY_PAGE_UPLOAD_ENDPOINT,
      uploadSessionId: uploadSession.uploadSessionId,
      uploadTimeoutMs: HISTORY_PAGE_UPLOAD_TIMEOUT_MS,
      backendUploadStarted: true,
      deviceMac,
      rawRecordCount: records.length,
      currentSubmitRecordCount: currentSubmitRecords.length,
      currentCandidateRecordCount: currentCandidateRecords.length,
      lastReadFilteredRecordCount: lastReadFilteredRecords.length,
      uploadLastReadTimestamp,
      newSubmitRecordCount: currentUploadSplit.submitRecords.length,
      alreadyUploadedCount: currentUploadSplit.alreadyUploadedRecords.length,
      uploadedRecordKeyCount: uploadedRecordKeys.size,
      pendingUploadCount: pendingRecords.length,
      pendingAttemptCount: pendingUpload?.attemptCount || 0,
      pendingDroppedForOtherDevice,
      submitRecordCount: submitPreviewRecords.length,
      rawMetricCounts: countHistoryPageRecordMetrics(records),
      submitMetricCounts: countHistoryPageRecordMetrics(submitPreviewRecords as any),
      rawFrameCount: rawFrames.length,
      rawSubmitResponse,
      rawRecordSample: records.slice(0, 2).map(summarizeHistoryPageRecord),
      submitRecordSample: submitPreviewRecords.slice(0, 2)
    };
    appendRingDiagnosticLog('RW PAGE', 'history-page-upload-start', uploadDetails);

    let submitResponse: unknown;
    try {
      submitResponse = await submitData({
        deviceMac,
        dataList: submitPreviewRecords,
        ...buildUploadSyncMeta(uploadSession)
      }, getHistoryPageSilentRequestConfig());
      markPendingUploadDataDone(uploadSession.uploadSessionId, submitResponse);
    } catch (uploadError) {
      markPendingUploadDataFailed(uploadSession.uploadSessionId, uploadError);
      const savedPending = writeHistoryPagePendingUpload(
        deviceMac,
        submitPreviewRecords,
        (pendingUpload?.attemptCount || 0) + 1
      );
      appendRingDiagnosticLog('RW PAGE', 'history-page-upload-failed', {
        ...uploadDetails,
        backendUploaded: false,
        backendSubmitted: false,
        pendingUploadSaved: Boolean(savedPending),
        pendingUploadCount: savedPending?.dataList.length || submitPreviewRecords.length,
        pendingAttemptCount: savedPending?.attemptCount || (pendingUpload?.attemptCount || 0) + 1,
        error: formatBleErrorMessage(uploadError, HISTORY_PAGE_SUBMIT_FAILED_MESSAGE),
        rawError: getHistoryPageRawError(uploadError)
      });
      if (!isExpectedBleRuntimeError(uploadError)) {
        formatBleErrorMessage(uploadError);
      }
      return null;
    }
    if (rawFrames.length > 0) {
      rawSubmitResponse = { rawStatus: 'scheduled', uploadSessionId: uploadSession.uploadSessionId, rawFrameCount: rawFrames.length };
      void uploadPendingRawFramesInBackground(uploadSession, (params) =>
        submitRingHistoryRawFrames(params, getHistoryPageSilentRequestConfig())
      ).catch((rawUploadError) => {
        appendRingDiagnosticLog('RW PAGE', 'history-page-raw-upload-failed', {
          ...details,
          uploadSessionId: uploadSession.uploadSessionId,
          deviceMac,
          rawFrameCount: rawFrames.length,
          error: formatBleErrorMessage(rawUploadError, 'raw history upload failed'),
          rawError: getHistoryPageRawError(rawUploadError)
        });
      });
    }
    clearHistoryPagePendingUpload(deviceMac);
    const uploadedRecordKeyCount = writeHistoryPageUploadedRecordKeys(
      deviceMac,
      submitPreviewRecords.map((record) => getHistoryPageSubmitRecordKey(record))
    );
    const maxTimestamp = submitPreviewRecords.reduce((latest, record) => {
      return Math.max(latest, getRingHistoryRecordSyncUnixTime(record) || 0);
    }, 0);
    const previousLastReadTimestamp = Number(userStore.lastReadTimestamp || 0);
    if (maxTimestamp > 0 && maxTimestamp > previousLastReadTimestamp) {
      userStore.updateLastReadTimestamp(maxTimestamp);
    }
    appendRingDiagnosticLog('RW PAGE', 'history-page-upload-result', {
      ...details,
      endpoint: HISTORY_PAGE_UPLOAD_ENDPOINT,
      uploadTimeoutMs: HISTORY_PAGE_UPLOAD_TIMEOUT_MS,
      deviceMac,
      submitted: true,
      uploaded: true,
      backendSubmitted: true,
      backendUploaded: true,
      count: submitPreviewRecords.length,
      recordCount: submitPreviewRecords.length,
      rawRecordCount: records.length,
      currentSubmitRecordCount: currentSubmitRecords.length,
      currentCandidateRecordCount: currentCandidateRecords.length,
      lastReadFilteredRecordCount: lastReadFilteredRecords.length,
      newSubmitRecordCount: currentUploadSplit.submitRecords.length,
      alreadyUploadedCount: currentUploadSplit.alreadyUploadedRecords.length,
      pendingUploadCount: pendingRecords.length,
      pendingAttemptCount: pendingUpload?.attemptCount || 0,
      submitRecordCount: submitPreviewRecords.length,
      uploadedRecordKeyCount,
      filteredOutCount: filteredRecords.length,
      futureTimestampFilterEnabled: true,
      futureFilteredOutCount: futureFilteredRecords.length,
      maxVisibleTimestamp,
      maxTimestamp,
      previousLastReadTimestamp,
      lastReadTimestamp: userStore.lastReadTimestamp,
      rawMetricCounts: countHistoryPageRecordMetrics(records),
      uploadRawMetricCounts: countHistoryPageRecordMetrics(records),
      submitMetricCounts: countHistoryPageRecordMetrics(submitPreviewRecords as any),
      rawRecordSample: records.slice(0, 2).map(summarizeHistoryPageRecord),
      filteredRecordSample: filteredRecords.slice(0, 2).map(summarizeHistoryPageRecord),
      futureFilteredRecordSample: futureFilteredRecords.slice(0, 2).map(summarizeHistoryPageRecord),
      submitResponse: summarizeHistoryPageSubmitResponse(submitResponse),
      submitRecordSample: submitPreviewRecords.slice(0, 2)
    });
    return {
      submitted: true,
      count: submitPreviewRecords.length,
      maxTimestamp,
      uploadedRecordKeyCount,
      submitResponse,
      records: submitPreviewRecords
    };
  };

  const syncBusinessHistoryPage = async (options: SyncRingBusinessHistoryPageOptions) => {
    const dataTypes = Array.from(new Set((options.dataTypes || []).filter(Boolean)));
    if (dataTypes.length === 0) return null;

    if (userStore.reconnectStatus === 'reconnecting' || userStore.isReconnecting === true) {
      appendRingDiagnosticLog('RW PAGE', 'history-page-sync-skip', {
        page: options.page,
        date: options.date,
        dataTypes,
        reason: 'reconnecting'
      });
      return null;
    }

    const protocol = getCurrentProtocol();
    if (protocol !== 'rw') {
      appendRingDiagnosticLog('RW PAGE', 'history-page-sync-skip', {
        page: options.page,
        date: options.date,
        dataTypes,
        protocol,
        reason: 'non-rw'
      });
      return null;
    }

    const readAll = Boolean(options.readAll);
    const historyStartDate = getHistoryPageStartDate(options.date, dataTypes, readAll);
    const sinceTimestamp = getHistoryPageSinceTimestamp(historyStartDate, readAll);
    const configuredTimeoutMs = Number(options.timeoutMs);
    const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
      ? configuredTimeoutMs
      : RW_BUSINESS_HISTORY_PAGE_TIMEOUT_MS;
    const logDetails = {
      page: options.page,
      date: options.date,
      historyStartDate,
      dataTypes,
      readAll,
      sinceTimestamp,
      timeoutMs
    };

    const diagnosticLock = getRwDiagnosticCommandLock();
    if (diagnosticLock) {
      appendRingDiagnosticLog('RW PAGE', 'history-page-sync-skip', {
        ...logDetails,
        reason: 'rw-diagnostic-command-lock',
        lock: diagnosticLock
      });
      return null;
    }

    if (!options.allowRwDeviceSync) {
      appendRingDiagnosticLog('RW PAGE', 'history-page-sync-skip', {
        ...logDetails,
        reason: 'rw-manual-only'
      });
      return null;
    }

    const ready = await ensureHistoryPageReady(logDetails);
    if (!ready) {
      appendRingDiagnosticLog('RW PAGE', 'history-page-sync-skip', {
        ...logDetails,
        reason: 'not-ready'
      });
      return null;
    }

    appendRingDiagnosticLog('RW PAGE', 'history-page-sync-start', logDetails);

    const startedAt = Date.now();
    try {
      const result = await ringBle.readLocalData(readAll, historyStartDate, dataTypes, {
        timeoutMs,
        silentUploadStatus: true
      });
      const records = getHistoryPageResultRecords(result);
      const uploadRecordGroups: Array<Array<Record<string, any>>> = [records];
      const uploadRawResults: Array<unknown> = [result];
      const fallbackUploadSummaries: Array<Record<string, unknown>> = [];
      const primaryRawMetricCounts = countHistoryPageRecordMetrics(records);
      const primarySubmitRecords = buildRingHistorySubmitRecords(records as any, sinceTimestamp);
      const primarySubmitMetricCounts = countHistoryPageSubmitMetrics(records, sinceTimestamp);
      let latestFallbackResult: unknown = null;
      appendRingDiagnosticLog('RW PAGE', 'history-page-sync-result', {
        ...logDetails,
        elapsedMs: Date.now() - startedAt,
        status: (result as any)?.status,
        deviceUploaded: (result as any)?.uploaded,
        recordCount: records.length,
        submitRecordCount: primarySubmitRecords.length,
        backendUploadPending: primarySubmitRecords.length > 0,
        rawMetricCounts: primaryRawMetricCounts,
        submitMetricCounts: primarySubmitMetricCounts,
        rawRecordSample: records.slice(0, 2).map(summarizeHistoryPageRecord)
      });

      const missingStepSleepMetrics = getMissingStepSleepHistoryMetrics(dataTypes, primarySubmitMetricCounts);
      if (!readAll && hasStepOrSleepHistoryDataType(dataTypes) && missingStepSleepMetrics.length > 0) {
        const fallbackDataTypes = getFocusedStepSleepFallbackDataTypes(missingStepSleepMetrics);
        if (fallbackDataTypes.length === 0) {
          appendRingDiagnosticLog('RW PAGE', 'history-page-fallback-skip', {
            ...logDetails,
            reason: 'empty-step-sleep-fallback-types',
            missingMetrics: missingStepSleepMetrics
          });
        } else {
          const fallbackTimeoutMs = Math.max(timeoutMs, EMPTY_HISTORY_FALLBACK_TIMEOUT_MS);
          const fallbackEvents = records.length === 0
            ? HISTORY_PAGE_EMPTY_FALLBACK_EVENTS
            : HISTORY_PAGE_MISSING_STEP_SLEEP_FALLBACK_EVENTS;
          const fallbackDetails = {
            ...logDetails,
            dataTypes: fallbackDataTypes,
            readAll: true,
            timeoutMs: fallbackTimeoutMs,
            fallback: records.length === 0 ? 'empty-primary-step-sleep' : 'missing-primary-step-sleep',
            fallbackFocus: fallbackDataTypes[0],
            primaryDataTypes: dataTypes,
            primarySinceTimestamp: sinceTimestamp,
            primaryRawMetricCounts,
            primarySubmitMetricCounts,
            missingMetrics: missingStepSleepMetrics
          };
          appendRingDiagnosticLog('RW PAGE', fallbackEvents.start, fallbackDetails);
          const fallbackStartedAt = Date.now();
          try {
            const fallbackResult = await ringBle.readLocalData(true, historyStartDate, fallbackDataTypes, {
              timeoutMs: fallbackTimeoutMs,
              silentUploadStatus: true
            });
            const fallbackRecords = getHistoryPageResultRecords(fallbackResult);
            const fallbackSubmitRecords = buildRingHistorySubmitRecords(fallbackRecords as any, sinceTimestamp);
            uploadRecordGroups.push(fallbackRecords);
            uploadRawResults.push(fallbackResult);
            fallbackUploadSummaries.push({
              fallback: fallbackDetails.fallback,
              dataTypes: fallbackDataTypes,
              rawRecordCount: fallbackRecords.length,
              submitRecordCount: fallbackSubmitRecords.length
            });
            appendRingDiagnosticLog('RW PAGE', fallbackEvents.result, {
              ...fallbackDetails,
              elapsedMs: Date.now() - fallbackStartedAt,
              status: (fallbackResult as any)?.status,
              deviceUploaded: (fallbackResult as any)?.uploaded,
              recordCount: fallbackRecords.length,
              submitRecordCount: fallbackSubmitRecords.length,
              backendUploadPending: fallbackSubmitRecords.length > 0,
              rawMetricCounts: countHistoryPageRecordMetrics(fallbackRecords),
              submitMetricCounts: countHistoryPageSubmitMetrics(fallbackRecords, sinceTimestamp),
              rawRecordSample: fallbackRecords.slice(0, 2).map(summarizeHistoryPageRecord)
            });
            if (fallbackRecords.length > 0) latestFallbackResult = fallbackResult;
          } catch (fallbackError) {
            appendRingDiagnosticLog('RW PAGE', fallbackEvents.failed, {
              ...fallbackDetails,
              elapsedMs: Date.now() - fallbackStartedAt,
              error: formatBleErrorMessage(fallbackError, HISTORY_PAGE_FALLBACK_READ_FAILED_MESSAGE),
              rawError: getHistoryPageRawError(fallbackError)
            });
            if (!isExpectedBleRuntimeError(fallbackError)) {
              formatBleErrorMessage(fallbackError);
            }
          }
        }
      }

      const missingVitalMetrics = getMissingVitalHistoryMetrics(dataTypes, primarySubmitMetricCounts);
      if (!readAll && missingVitalMetrics.length > 0) {
        const fallbackDataTypes = getVitalFallbackDataTypes(missingVitalMetrics);
        if (fallbackDataTypes.length > 0) {
          const fallbackTimeoutMs = Math.max(timeoutMs, MISSING_VITAL_HISTORY_FALLBACK_TIMEOUT_MS);
          const fallbackDetails = {
            ...logDetails,
            dataTypes: fallbackDataTypes,
            readAll: true,
            timeoutMs: fallbackTimeoutMs,
            fallback: records.length === 0 ? 'empty-primary-vital' : 'missing-primary-vital',
            primaryDataTypes: dataTypes,
            primarySinceTimestamp: sinceTimestamp,
            primaryRawMetricCounts,
            primarySubmitMetricCounts,
            missingMetrics: missingVitalMetrics
          };
          appendRingDiagnosticLog('RW PAGE', HISTORY_PAGE_MISSING_VITAL_FALLBACK_EVENTS.start, fallbackDetails);
          const fallbackStartedAt = Date.now();
          try {
            const fallbackResult = await ringBle.readLocalData(true, historyStartDate, fallbackDataTypes, {
              timeoutMs: fallbackTimeoutMs,
              silentUploadStatus: true
            });
            const fallbackRecords = getHistoryPageResultRecords(fallbackResult);
            const fallbackSubmitRecords = buildRingHistorySubmitRecords(fallbackRecords as any, sinceTimestamp);
            uploadRecordGroups.push(fallbackRecords);
            uploadRawResults.push(fallbackResult);
            fallbackUploadSummaries.push({
              fallback: fallbackDetails.fallback,
              dataTypes: fallbackDataTypes,
              rawRecordCount: fallbackRecords.length,
              submitRecordCount: fallbackSubmitRecords.length
            });
            appendRingDiagnosticLog('RW PAGE', HISTORY_PAGE_MISSING_VITAL_FALLBACK_EVENTS.result, {
              ...fallbackDetails,
              elapsedMs: Date.now() - fallbackStartedAt,
              status: (fallbackResult as any)?.status,
              deviceUploaded: (fallbackResult as any)?.uploaded,
              recordCount: fallbackRecords.length,
              submitRecordCount: fallbackSubmitRecords.length,
              backendUploadPending: fallbackSubmitRecords.length > 0,
              rawMetricCounts: countHistoryPageRecordMetrics(fallbackRecords),
              submitMetricCounts: countHistoryPageSubmitMetrics(fallbackRecords, sinceTimestamp),
              rawRecordSample: fallbackRecords.slice(0, 2).map(summarizeHistoryPageRecord)
            });
            if (fallbackRecords.length > 0) latestFallbackResult = fallbackResult;
          } catch (fallbackError) {
            appendRingDiagnosticLog('RW PAGE', HISTORY_PAGE_MISSING_VITAL_FALLBACK_EVENTS.failed, {
              ...fallbackDetails,
              elapsedMs: Date.now() - fallbackStartedAt,
              error: formatBleErrorMessage(fallbackError, HISTORY_PAGE_FALLBACK_READ_FAILED_MESSAGE),
              rawError: getHistoryPageRawError(fallbackError)
            });
            if (!isExpectedBleRuntimeError(fallbackError)) {
              formatBleErrorMessage(fallbackError);
            }
          }
        }
      }

      const combinedUploadRecords = uploadRecordGroups.flat();
      const combinedSubmitRecords = buildRingHistorySubmitRecords(combinedUploadRecords as any, sinceTimestamp);
      try {
        await uploadHistoryPageRecords(
          combinedUploadRecords,
          {
            ...logDetails,
            uploadMode: 'merged-after-fallback',
            primaryRawRecordCount: records.length,
            primarySubmitRecordCount: primarySubmitRecords.length,
            fallbackUploadSummaries,
            combinedRawRecordCount: combinedUploadRecords.length,
            combinedSubmitRecordCount: combinedSubmitRecords.length
          },
          sinceTimestamp,
          uploadRawResults
        );
      } catch (uploadError) {
        appendRingDiagnosticLog('RW PAGE', 'history-page-upload-failed', {
          ...logDetails,
          uploadMode: 'merged-after-fallback',
          backendUploaded: false,
          backendSubmitted: false,
          error: formatBleErrorMessage(uploadError, HISTORY_PAGE_SUBMIT_FAILED_MESSAGE),
          rawError: getHistoryPageRawError(uploadError)
        });
        if (!isExpectedBleRuntimeError(uploadError)) {
          formatBleErrorMessage(uploadError);
        }
      }

      return latestFallbackResult || result;
    } catch (error) {
      appendRingDiagnosticLog('RW PAGE', 'history-page-sync-failed', {
        ...logDetails,
        elapsedMs: Date.now() - startedAt,
        error: formatBleErrorMessage(error, '历史数据同步失败'),
        rawError: getHistoryPageRawError(error)
      });
      if (!isExpectedBleRuntimeError(error)) {
        formatBleErrorMessage(error);
      }
      return null;
    }
  };

  const logHistoryPageQueryResult = (options: LogHistoryPageQueryOptions) => {
    if (!isCurrentRwRing()) return;
    appendRingDiagnosticLog('RW PAGE', 'history-page-query-result', {
      page: options.page,
      date: options.date,
      endpoint: options.endpoint,
      response: summarizeHistoryPageQueryResponse(options.response)
    });
  };

  const logHistoryPageQueryFailed = (options: LogHistoryPageQueryOptions) => {
    if (!isCurrentRwRing()) return;
    appendRingDiagnosticLog('RW PAGE', 'history-page-query-failed', {
      page: options.page,
      date: options.date,
      endpoint: options.endpoint,
      error: formatBleErrorMessage(options.error, '详情接口请求失败'),
      rawError: getHistoryPageRawError(options.error)
    });
  };

  const queryHistoryPage = async <T>(options: QueryHistoryPageOptions<T>) => {
    try {
      const response = await options.query(getHistoryPageSilentRequestConfig());
      logHistoryPageQueryResult({
        page: options.page,
        date: options.date,
        endpoint: options.endpoint,
        response
      });
      return response;
    } catch (error) {
      logHistoryPageQueryFailed({
        page: options.page,
        date: options.date,
        endpoint: options.endpoint,
        error
      });
      return null;
    }
  };

  return {
    isCurrentRwRing,
    logHistoryPageQueryFailed,
    logHistoryPageQueryResult,
    queryHistoryPage,
    syncBusinessHistoryPage
  };
};
