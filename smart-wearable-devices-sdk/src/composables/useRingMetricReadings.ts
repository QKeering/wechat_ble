import { resolveRingProtocol, type RingDeviceInfo } from '@/sdk/ring-ble';

type RingStoreLike = {
  receivedData?: any[];
  healthData?: Record<string, any>;
  latestMetrics?: Record<string, any>;
  lastMetricUpdateAt?: number;
  normalMac?: string;
  iosMacId?: string;
  deviceInfo?: Record<string, any>;
};

type RefreshMetricTask = (params?: Record<string, any>) => Promise<unknown>;
type RequestMetricRefreshOptions = {
  expectedSteps?: string | string[];
  timeoutMs?: number;
};

type RwMetricKind = 'heart_rate' | 'blood_oxygen' | 'temperature' | 'hrv' | 'stress' | 'blood_sugar' | 'blood_pressure';

const REALTIME_MEASURE_TIMEOUT_MS = 35_000;
const RW_STATUS_ONLY_BYTES = new Set([0x11, 0x31]);
const RW_PRIMARY_REALTIME_METRIC_KEYS: Record<RwMetricKind, number> = {
  heart_rate: 0x0224,
  blood_oxygen: 0x024e,
  temperature: 0x0508,
  hrv: 0x050a,
  stress: 0x050d,
  blood_sugar: 0x0510,
  blood_pressure: 0x0504
};
const RW_COMPAT_REALTIME_METRIC_KEYS: Record<RwMetricKind, number[]> = {
  heart_rate: [0x0503],
  blood_oxygen: [0x0509],
  temperature: [0x0230],
  hrv: [0x0269],
  stress: [0x024f],
  blood_sugar: [0x026c],
  blood_pressure: [0x0231]
};
const TEMPERATURE_VALUE_KEYS = [
  'value',
  'temperature',
  'temperatureValue',
  'temperature_value',
  'bodyTemperature',
  'body_temperature',
  'bodyTemperatureValue',
  'body_temperature_value',
  'bodyTemp',
  'body_temp',
  'bodyTempValue',
  'body_temp_value',
  'skinTemperature',
  'skin_temperature',
  'skinTemperatureValue',
  'skin_temperature_value'
];

export const requestMetricRefresh = async (
  refreshHealthData: RefreshMetricTask,
  fallbackCommand: () => Promise<unknown>,
  options: RequestMetricRefreshOptions = {}
) => {
  const realtimeMetricNames = normalizeExpectedRefreshSteps(options.expectedSteps)
    .map((step) => step.replace(/_pending$/, ''))
    .filter(Boolean);
  try {
    const result = await refreshHealthData({
      includeDeviceTime: false,
      includeCollectPeriod: false,
      includeDeviceInfo: false,
      includeRealtimeMetrics: realtimeMetricNames.length > 0 ? true : undefined,
      includeHistorySnapshot: false,
      realtimeMetricNames,
      timeoutMs: options.timeoutMs ?? REALTIME_MEASURE_TIMEOUT_MS
    });
    if (shouldFallbackMetricRefresh(result, options.expectedSteps)) {
      await fallbackCommand();
    }
  } catch {
    await fallbackCommand();
  }
};

const normalizeExpectedRefreshSteps = (expectedSteps?: string | string[]) =>
  (Array.isArray(expectedSteps) ? expectedSteps : expectedSteps ? [expectedSteps] : []).filter(Boolean);

const shouldFallbackMetricRefresh = (result: unknown, expectedSteps?: string | string[]) => {
  const expected = normalizeExpectedRefreshSteps(expectedSteps);
  if (expected.length === 0) return isRefreshResultFailed(result);
  if (!result || typeof result !== 'object') return false;

  const record = result as Record<string, any>;
  const ok = Array.isArray(record.ok) ? record.ok.map((step) => String(step)) : [];
  if (expected.some((step) => ok.includes(step) || ok.includes(`${step}_pending`))) return false;

  const failed = Array.isArray(record.failed) ? record.failed : [];
  const failedExpected = failed.some((item: any) => expected.includes(String(item?.step || '')));
  if (failedExpected) return true;
  return Array.isArray(record.ok) || Array.isArray(record.failed) || typeof record.status === 'string';
};

const isRefreshResultFailed = (result: unknown) => {
  if (!result || typeof result !== 'object') return false;
  const record = result as Record<string, any>;
  return record.status === 'failed' && (!Array.isArray(record.ok) || record.ok.length === 0);
};

export const toMetricNumber = (value: any) => {
  if (value === undefined || value === null || value === '' || value === '-') return null;
  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) return numericValue;
  if (typeof value === 'string') {
    const matched = value.trim().match(/^(-?\d+(?:\.\d+)?)(?:\s*[^\d]*)$/);
    if (matched) {
      const parsed = Number(matched[1]);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
};

export const isValidBloodOxygenValue = (value: number | null) => value !== null && value >= 70 && value <= 100;

const normalizeBloodOxygenMetricValue = (value: unknown) => {
  const numeric = toMetricNumber(value);
  return isValidBloodOxygenValue(numeric) ? numeric : null;
};

const normalizeHeartRateMetricValue = (value: unknown) => {
  const numeric = toMetricNumber(value);
  return numeric !== null && numeric >= 25 && numeric <= 240 && !RW_STATUS_ONLY_BYTES.has(numeric) ? numeric : null;
};

const normalizeHrvMetricValue = (value: unknown) => {
  const numeric = toMetricNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
};

const normalizeStressMetricValue = (value: unknown) => {
  const numeric = toMetricNumber(value);
  return numeric !== null && numeric >= 0 && numeric <= 100 ? numeric : null;
};

const toMetricTimestamp = (...values: any[]) => {
  for (const value of values) {
    if (value === undefined || value === null || value === '' || value === '-') continue;
    if (value instanceof Date) {
      const timestamp = value.getTime();
      if (Number.isFinite(timestamp)) return timestamp;
      continue;
    }
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) return normalizeMetricTimestamp(numericValue);
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

const normalizeMetricTimestamp = (timestamp: number) =>
  timestamp > 0 && timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp;

export const getMetricRecordTime = (record: any, fallback?: number) => {
  const timestamp = toMetricTimestamp(
    record?.timestamp,
    record?.time,
    record?.unixTime,
    record?.startTimestamp,
    record?.recordTimestamp,
    record?.recordTime,
    record?.createdAt,
    record?.receivedAt,
    record?.received_at,
    record?.parsedAt,
    record?.metrics?.timestamp,
    record?.metrics?.time,
    record?.metrics?.unixTime,
    record?.metrics?.startTimestamp,
    record?.metrics?.recordTimestamp,
    record?.metrics?.recordTime,
    record?.metrics?.createdAt,
    record?.metrics?.receivedAt,
    record?.metrics?.received_at,
    record?.metrics?.parsedAt,
    record?.raw?.timestamp,
    record?.raw?.time,
    record?.raw?.unixTime,
    record?.raw?.startTimestamp,
    record?.raw?.recordTimestamp,
    record?.raw?.recordTime,
    record?.raw?.createdAt,
    record?.raw?.receivedAt,
    record?.raw?.received_at,
    record?.raw?.parsedAt
  );
  return timestamp || fallback || Date.now();
};

export const formatMetricRecordTime = (timestamp: number) => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

export const getSubmitDeviceMac = (store: RingStoreLike, isIOS: boolean) => {
  const currentStableMac = store.deviceInfo?.mac || store.deviceInfo?.advertis?.macInfo;
  const rwStableMac =
    currentStableMac ||
    (isColonSeparatedBleMac(store.deviceInfo?.uniMacId) ? store.deviceInfo?.uniMacId : '');
  const stableMac = currentStableMac || store.normalMac;
  if (resolveRingProtocol(store.deviceInfo as RingDeviceInfo) === 'rw') return rwStableMac || '';
  if (isIOS) return stableMac || store.iosMacId || store.deviceInfo?.uniMacId || '';
  return store.deviceInfo?.deviceId || stableMac || store.iosMacId || '';
};

const isColonSeparatedBleMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());

const getMetricName = (record: any) => record?.name || record?.metricName || record?.metrics?.name || '';

const getComparableMetricTime = (record: any, fallback = 0) => {
  const timestamp = toMetricTimestamp(
    record?.timestamp,
    record?.time,
    record?.unixTime,
    record?.startTimestamp,
    record?.recordTimestamp,
    record?.recordTime,
    record?.createdAt,
    record?.receivedAt,
    record?.received_at,
    record?.parsedAt,
    record?.metrics?.timestamp,
    record?.metrics?.time,
    record?.metrics?.unixTime,
    record?.metrics?.startTimestamp,
    record?.metrics?.recordTimestamp,
    record?.metrics?.recordTime,
    record?.metrics?.createdAt,
    record?.metrics?.receivedAt,
    record?.metrics?.received_at,
    record?.metrics?.parsedAt,
    record?.raw?.timestamp,
    record?.raw?.time,
    record?.raw?.unixTime,
    record?.raw?.startTimestamp,
    record?.raw?.recordTimestamp,
    record?.raw?.recordTime,
    record?.raw?.createdAt,
    record?.raw?.receivedAt,
    record?.raw?.received_at,
    record?.raw?.parsedAt
  );
  return timestamp || fallback || 0;
};

const getMetricValue = (record: any, keys: string[]) => {
  for (const key of keys) {
    const value = toMetricNumber(record?.[key] ?? record?.metrics?.[key] ?? record?.data?.[key]);
    if (value !== null) return value;
  }
  return null;
};

const getRawMetricValue = (record: any, keys: string[]) => {
  for (const key of keys) {
    const value = record?.[key] ?? record?.metrics?.[key] ?? record?.data?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const getRawMetricDeviceIds = (record: Record<string, any> = {}) =>
  [record.deviceId, record.uniMacId, record.mac, record.advertis?.macInfo].filter(Boolean).map((value) => String(value).trim());

const getMetricDeviceIds = (record: Record<string, any> = {}, protocolHint = '') => {
  const protocol = record.protocol || protocolHint;
  if (protocol === 'rw') {
    return [
      record.mac,
      record.advertis?.macInfo,
      isColonSeparatedBleMac(record.uniMacId) ? record.uniMacId : ''
    ]
      .filter(Boolean)
      .map((value) => String(value).trim());
  }
  return getRawMetricDeviceIds(record);
};

const getMetricIdentityScope = (record: Record<string, any> = {}, protocolHint = '') => ({
  ids: getMetricDeviceIds(record, protocolHint),
  hadIdentity: getRawMetricDeviceIds(record).length > 0
});

const normalizeMetricIdentity = (value: unknown) =>
  String(value || '')
    .replace(/[^a-fA-F0-9]/g, '')
    .toUpperCase();

const hasMatchingMetricIdentityTail = (leftIds: string[], rightIds: string[]) => {
  const leftNormalized = leftIds.map(normalizeMetricIdentity).filter((value) => value.length >= 6);
  const rightNormalized = rightIds.map(normalizeMetricIdentity).filter((value) => value.length >= 6);
  return leftNormalized.some((leftId) =>
    rightNormalized.some((rightId) => leftId.endsWith(rightId.slice(-6)) || rightId.endsWith(leftId.slice(-6)))
  );
};

const isMetricRecordForCurrentDevice = (store: RingStoreLike, record: Record<string, any>) => {
  const currentDevice = store.deviceInfo || {};
  const currentProtocol = currentDevice.protocol ? resolveRingProtocol(currentDevice as RingDeviceInfo) : '';
  if (record.protocol && currentProtocol && record.protocol !== currentProtocol) return false;

  const recordScope = getMetricIdentityScope(record, currentProtocol);
  const currentScope = getMetricIdentityScope(currentDevice, record.protocol);
  const isRwScope = record.protocol === 'rw' || currentProtocol === 'rw';
  if (isRwScope) {
    if (recordScope.hadIdentity && recordScope.ids.length === 0) return false;
    if (currentScope.hadIdentity && currentScope.ids.length === 0 && recordScope.ids.length > 0) return false;
  }

  const recordIds = recordScope.ids;
  const currentIds = currentScope.ids;
  if (recordIds.length === 0 || currentIds.length === 0) return true;

  return recordIds.some((id) => currentIds.includes(id)) || hasMatchingMetricIdentityTail(recordIds, currentIds);
};

const findLatestReceived = (store: RingStoreLike, predicate: (record: any) => boolean, since = 0) =>
  [...(store.receivedData || [])]
    .filter((record) => isMetricRecordForCurrentDevice(store, record) && predicate(record) && getComparableMetricTime(record) >= since)
    .sort((a: any, b: any) => getComparableMetricTime(b) - getComparableMetricTime(a))[0];

const getRwMetricKey = (record: any) => {
  const value = record?.key ?? record?.metrics?.key ?? record?.raw?.key;
  const key = Number(value);
  return Number.isFinite(key) ? key : null;
};

const getRwMetricFlag = (record: any) => {
  const value = record?.flag ?? record?.metrics?.flag ?? record?.raw?.flag;
  const flag = Number(value);
  return Number.isFinite(flag) ? flag : null;
};

const isRwRealtimeReadFlag = (flag: number | null) => flag === 0x10 || flag === 0x11;

const getRwMetricAcceptedKeys = (kind: RwMetricKind) => [
  RW_PRIMARY_REALTIME_METRIC_KEYS[kind],
  ...(RW_COMPAT_REALTIME_METRIC_KEYS[kind] || [])
];

const isRwCompatRealtimeMetricKey = (kind: RwMetricKind, key: number) =>
  (RW_COMPAT_REALTIME_METRIC_KEYS[kind] || []).includes(key);

const requiresRwCompatReadFlag = (_kind: RwMetricKind) => true;

const isRwAppRealtimeStatusKey = (key: number | null) => key === 0x0224 || key === 0x024e;

const getRwMetricDataArray = (record: any) => {
  const data = record?.data ?? record?.metrics?.data ?? record?.raw?.data;
  return Array.isArray(data) ? data : null;
};

const isPlausibleRwHistoryTimestamp = (value: number) =>
  Number.isFinite(value) && value >= 946_684_800 && value <= 4_102_444_800;

const readUint32LEFromArray = (values: unknown[]) => {
  if (values.length < 4 || values.slice(0, 4).some((value) => typeof value !== 'number')) return null;
  return ((values[0] as number) || 0) |
    (((values[1] as number) || 0) << 8) |
    (((values[2] as number) || 0) << 16) |
    (((values[3] as number) || 0) << 24);
};

const hasRwHistoryRecords = (record: any) => {
  const records = record?.records ?? record?.metrics?.records ?? record?.raw?.records;
  if (Array.isArray(records) && records.length > 0) return true;
  const data = getRwMetricDataArray(record);
  if (!data || data.length < 6 || data.length % 6 !== 0) return false;
  const key = getRwMetricKey(record);
  if (typeof data[0] === 'number' && RW_STATUS_ONLY_BYTES.has(data[0]) && isRwAppRealtimeStatusKey(key)) return false;
  const timestamp = readUint32LEFromArray(data);
  return timestamp != null && isPlausibleRwHistoryTimestamp(timestamp);
};

const isRwHealthRecord = (record: any, names: string[], kind: RwMetricKind, since = 0) => {
  if (record?.type !== 'rw_health_data' && record?.sourceType !== 'rw_health_data') return false;
  if (!names.includes(getMetricName(record))) return false;
  const key = getRwMetricKey(record);
  if (key != null) {
    const flag = getRwMetricFlag(record);
    if (!getRwMetricAcceptedKeys(kind).includes(key)) return false;
    if (isRwCompatRealtimeMetricKey(kind, key) && requiresRwCompatReadFlag(kind) && !isRwRealtimeReadFlag(flag)) return false;
    return !hasRwHistoryRecords(record);
  }
  if (since <= 0) return true;
  const isExplicitRwRecord = record?.protocol === 'rw' || record?.metrics?.protocol === 'rw' || record?.raw?.protocol === 'rw';
  return !isExplicitRwRecord;
};

const getRwScalarDataValue = (data: unknown) => {
  if (!Array.isArray(data)) return null;
  let value: unknown = null;
  if (typeof data[0] === 'number' && RW_STATUS_ONLY_BYTES.has(data[0])) {
    value = data.length >= 5 ? data[4] : data[1];
  } else if (data.length >= 6 && data.length % 6 === 0) {
    value = data[data.length - 2];
  } else if (data.length === 1) {
    value = data[0];
  }
  return typeof value === 'number' ? value : null;
};

const normalizeRwBloodSugarValue = (value: unknown) => {
  const numeric = toMetricNumber(value);
  if (numeric === null || numeric <= 0 || RW_STATUS_ONLY_BYTES.has(numeric)) return null;
  return numeric > 30 && numeric <= 300 ? Number((numeric / 10).toFixed(1)) : numeric;
};

const stripRwStatusPrefix = (data: unknown) => {
  if (!Array.isArray(data)) return data;
  return typeof data[0] === 'number' && RW_STATUS_ONLY_BYTES.has(data[0]) ? data.slice(1) : data;
};

const getRwTemperatureDataValue = (data: unknown) => {
  const values = stripRwStatusPrefix(data);
  if (!Array.isArray(values)) return null;
  if (typeof values[0] !== 'number') return null;

  if (typeof values[1] === 'number') {
    const raw = values[0] | (values[1] << 8);
    const celsiusBy100 = Number((raw / 100).toFixed(2));
    if (isValidBodyTemperature(celsiusBy100)) return celsiusBy100;
    const celsiusBy10 = Number((raw / 10).toFixed(1));
    if (isValidBodyTemperature(celsiusBy10)) return celsiusBy10;
  }

  return isValidBodyTemperature(values[0]) ? values[0] : null;
};

const getRwMetricValue = (record: any, keys: string[], kind: RwMetricKind) => {
  const directValue = getMetricValue(record, keys);
  const data = record?.data ?? record?.metrics?.data;
  if (kind === 'blood_oxygen') {
    const directBloodOxygen = normalizeBloodOxygenMetricValue(directValue);
    if (directBloodOxygen !== null) return directBloodOxygen;
    return normalizeBloodOxygenMetricValue(getRwScalarDataValue(data));
  }
  if (kind === 'blood_sugar') {
    return normalizeRwBloodSugarValue(directValue !== null ? directValue : getRwScalarDataValue(data));
  }
  if (kind === 'heart_rate') {
    const directHeartRate = normalizeHeartRateMetricValue(directValue);
    if (directHeartRate !== null) return directHeartRate;
    return normalizeHeartRateMetricValue(getRwScalarDataValue(data));
  }
  if (kind === 'hrv') {
    const directHrv = normalizeHrvMetricValue(directValue);
    if (directHrv !== null) return directHrv;
    return normalizeHrvMetricValue(getRwScalarDataValue(data));
  }
  if (kind === 'stress') {
    const directStress = normalizeStressMetricValue(directValue);
    if (directStress !== null) return directStress;
    return normalizeStressMetricValue(getRwScalarDataValue(data));
  }
  if (directValue !== null) return directValue;
  if (kind === 'temperature') return getRwTemperatureDataValue(data);
  return getRwScalarDataValue(data);
};

const findLatestRwMetricReceived = (store: RingStoreLike, names: string[], keys: string[], kind: RwMetricKind, since = 0) =>
  findLatestReceived(
    store,
    (record) => isRwHealthRecord(record, names, kind, since) && getRwMetricValue(record, keys, kind) !== null,
    since
  );

const getHealthDataValue = (store: RingStoreLike, keys: string[]) => {
  for (const key of keys) {
    const value = toMetricNumber(store.healthData?.[key] ?? store.latestMetrics?.[key]);
    if (value !== null) return value;
  }
  return null;
};

const shouldUseCachedMetricFallback = (store: RingStoreLike, since = 0) => {
  if (since <= 0) return true;
  return resolveRingProtocol(store.deviceInfo as RingDeviceInfo) !== 'rw';
};

const getFallbackMetricTime = (store: RingStoreLike) => store.healthData?.lastMetricUpdateAt || store.lastMetricUpdateAt || 0;

const getMetricTimestamp = (store: RingStoreLike, rwData: any, useRwData: boolean) =>
  useRwData ? getMetricRecordTime(rwData, getFallbackMetricTime(store)) : getFallbackMetricTime(store);

const normalizeMetricRecordNumbers = (record: Record<string, any>, keys: string[]) => {
  let normalized = record;
  for (const key of keys) {
    const value = toMetricNumber(record?.[key]);
    if (value === null || record?.[key] === value) continue;
    if (normalized === record) normalized = { ...record };
    normalized[key] = value;
  }
  return normalized;
};

const getBloodPressureParts = (...values: unknown[]) => {
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) {
      const values = stripRwStatusPrefix(value);
      if (!Array.isArray(values)) continue;
      const systolic = toMetricNumber(values[0]);
      const diastolic = toMetricNumber(values[1]);
      if (systolic !== null || diastolic !== null) return { systolic, diastolic };
    }
    if (typeof value === 'object') {
      const record = value as Record<string, any>;
      const systolic = toMetricNumber(
        record.systolic ?? record.high ?? record.highPressure ?? record.bloodPressureHigh ?? record.blood_pressure_high ?? record.sbp ?? record.sp
      );
      const diastolic = toMetricNumber(
        record.diastolic ?? record.low ?? record.lowPressure ?? record.bloodPressureLow ?? record.blood_pressure_low ?? record.dbp ?? record.dp
      );
      if (systolic !== null || diastolic !== null) return { systolic, diastolic };
    }
    if (typeof value === 'string') {
      const matched = value.match(/(\d{2,3})\D+(\d{2,3})/);
      if (matched) return { systolic: Number(matched[1]), diastolic: Number(matched[2]) };
    }
  }
  return null;
};

const getRwBloodPressureParts = (record: any) =>
  getBloodPressureParts(getRawMetricValue(record, ['value', 'bloodPressure', 'blood_pressure', 'bp'])) ??
  getBloodPressureParts(record?.data, record?.metrics?.data) ??
  getBloodPressureParts({
    systolic: getMetricValue(record, ['systolic', 'sbp', 'sp', 'high', 'highPressure', 'bloodPressureHigh', 'blood_pressure_high']),
    diastolic: getMetricValue(record, ['diastolic', 'dbp', 'dp', 'low', 'lowPressure', 'bloodPressureLow', 'blood_pressure_low'])
  });

export const getLatestHeartRateReading = (store: RingStoreLike, since = 0) => {
  const legacyData: any = findLatestReceived(
    store,
    (record) => record.type === 'active_measure' && normalizeHeartRateMetricValue(record.heartRate) !== null,
    since
  );
  if (legacyData) {
    return {
      ...normalizeMetricRecordNumbers(legacyData, ['heartRate', 'heartRateVariability', 'stressIndex', 'stress']),
      heartRate: normalizeHeartRateMetricValue(legacyData.heartRate)
    };
  }

  const rwData: any = findLatestRwMetricReceived(store, ['heart_rate', 'heartRate', 'hr'], ['value', 'heartRate', 'heart_rate', 'hr'], 'heart_rate', since);
  const rwValue = getRwMetricValue(rwData, ['value', 'heartRate', 'heart_rate', 'hr'], 'heart_rate');
  const cachedValue = shouldUseCachedMetricFallback(store, since)
    ? normalizeHeartRateMetricValue(getHealthDataValue(store, ['heartRate', 'heart_rate', 'hr']))
    : null;
  const value = rwValue ?? cachedValue;
  if (value === null) return undefined;
  const timestamp = getMetricTimestamp(store, rwData, rwValue !== null);
  if (timestamp < since) return undefined;

  const stressReading = getLatestStressReading(store, since);
  const hrvReading = getLatestHrvReading(store, since);
  const reading: any = {
    timestamp,
    heartRate: value
  };
  if (stressReading?.stressIndex != null) {
    reading.stressIndex = stressReading.stressIndex;
  }
  if (hrvReading?.heartRateVariability != null) {
    reading.heartRateVariability = hrvReading.heartRateVariability;
  }
  return reading;
};

export const getLatestSpo2Reading = (store: RingStoreLike, since = 0) => {
  const legacyData: any = findLatestReceived(
    store,
    (record) => record.type === 'active_OxyGenMeasure' && normalizeBloodOxygenMetricValue(record.bloodOxygen) !== null,
    since
  );
  if (legacyData) {
    const legacyValue = normalizeBloodOxygenMetricValue(legacyData.bloodOxygen);
    if (legacyValue === null) return undefined;
    return {
      ...normalizeMetricRecordNumbers(legacyData, ['bloodOxygen']),
      bloodOxygen: legacyValue
    };
  }

  const rwData: any = findLatestRwMetricReceived(
    store,
    ['blood_oxygen', 'bloodOxygen', 'spo2', 'oxygen'],
    ['value', 'bloodOxygen', 'blood_oxygen', 'spo2', 'oxygen'],
    'blood_oxygen',
    since
  );
  const rwValue = getRwMetricValue(rwData, ['value', 'bloodOxygen', 'blood_oxygen', 'spo2', 'oxygen'], 'blood_oxygen');
  const cachedValue = shouldUseCachedMetricFallback(store, since)
    ? normalizeBloodOxygenMetricValue(getHealthDataValue(store, ['bloodOxygen', 'blood_oxygen', 'spo2', 'oxygen']))
    : null;
  const value = rwValue ?? cachedValue;
  if (!isValidBloodOxygenValue(value)) return undefined;
  const timestamp = getMetricTimestamp(store, rwData, rwValue !== null);
  if (timestamp < since) return undefined;

  return {
    timestamp,
    bloodOxygen: value
  };
};

export const isValidBodyTemperature = (value: number | null) => value !== null && value >= 25 && value <= 45;

export const getLatestTemperatureReading = (store: RingStoreLike, since = 0) => {
  const legacyData: any = findLatestReceived(
    store,
    (record) => record.type === 'active_Temperature' && isValidBodyTemperature(getMetricValue(record, TEMPERATURE_VALUE_KEYS)),
    since
  );
  if (legacyData) {
    const legacyValue = getMetricValue(legacyData, TEMPERATURE_VALUE_KEYS);
    return {
      ...normalizeMetricRecordNumbers(legacyData, TEMPERATURE_VALUE_KEYS),
      temperature: legacyValue
    };
  }

  const rwData: any = findLatestReceived(
    store,
    (record) =>
      isRwHealthRecord(record, ['temperature', 'body_temperature', 'skin_temperature'], 'temperature', since) &&
      isValidBodyTemperature(getRwMetricValue(record, TEMPERATURE_VALUE_KEYS, 'temperature')),
    since
  );
  const rwValue = getRwMetricValue(rwData, TEMPERATURE_VALUE_KEYS, 'temperature');
  const healthDataValue = shouldUseCachedMetricFallback(store, since) ? getHealthDataValue(store, TEMPERATURE_VALUE_KEYS) : null;
  const useRwValue = isValidBodyTemperature(rwValue);
  const value = useRwValue ? rwValue : healthDataValue;
  if (!isValidBodyTemperature(value)) return undefined;
  const timestamp = getMetricTimestamp(store, rwData, useRwValue);
  if (timestamp < since) return undefined;

  return {
    timestamp,
    temperature: value
  };
};

export const getLatestHrvReading = (store: RingStoreLike, since = 0) => {
  const legacyData: any = findLatestReceived(
    store,
    (record) => record.type === 'active_measure' && toMetricNumber(record.heartRateVariability) !== null,
    since
  );
  if (legacyData) return normalizeMetricRecordNumbers(legacyData, ['heartRateVariability']);

  const rwData: any = findLatestRwMetricReceived(
    store,
    ['hrv', 'heartRateVariability', 'heart_rate_variability'],
    ['value', 'hrv', 'heartRateVariability', 'heart_rate_variability'],
    'hrv',
    since
  );
  const rwValue = getRwMetricValue(rwData, ['value', 'hrv', 'heartRateVariability', 'heart_rate_variability'], 'hrv');
  const value =
    rwValue ??
    (shouldUseCachedMetricFallback(store, since)
      ? getHealthDataValue(store, ['heartRateVariability', 'heart_rate_variability', 'hrv'])
      : null);
  if (value === null) return undefined;
  const timestamp = getMetricTimestamp(store, rwData, rwValue !== null);
  if (timestamp < since) return undefined;

  return {
    timestamp,
    heartRateVariability: value
  };
};

export const getLatestStressReading = (store: RingStoreLike, since = 0) => {
  const legacyData: any = findLatestReceived(
    store,
    (record) => record.type === 'active_measure' && toMetricNumber(record.stressIndex ?? record.stress) !== null,
    since
  );
  if (legacyData) return normalizeMetricRecordNumbers(legacyData, ['stressIndex', 'stress']);

  const rwData: any = findLatestRwMetricReceived(
    store,
    ['stress', 'stressIndex', 'stress_index', 'pressure'],
    ['value', 'stress', 'stressIndex', 'stress_index', 'pressure'],
    'stress',
    since
  );
  const rwValue = getRwMetricValue(rwData, ['value', 'stress', 'stressIndex', 'stress_index', 'pressure'], 'stress');
  const value =
    rwValue ??
    (shouldUseCachedMetricFallback(store, since)
      ? getHealthDataValue(store, ['stressIndex', 'stress_index', 'stress', 'pressure'])
      : null);
  if (value === null) return undefined;
  const timestamp = getMetricTimestamp(store, rwData, rwValue !== null);
  if (timestamp < since) return undefined;

  return {
    timestamp,
    stressIndex: value,
    stress: value
  };
};

export const getLatestBloodSugarReading = (store: RingStoreLike, since = 0) => {
  const rwData: any = findLatestRwMetricReceived(
    store,
    ['blood_sugar', 'bloodSugar', 'glucose', 'sugar'],
    ['value', 'bloodSugar', 'blood_sugar', 'glucose', 'sugar'],
    'blood_sugar',
    since
  );
  const rwValue = getRwMetricValue(rwData, ['value', 'bloodSugar', 'blood_sugar', 'glucose', 'sugar'], 'blood_sugar');
  const cachedValue = shouldUseCachedMetricFallback(store, since)
    ? normalizeRwBloodSugarValue(getHealthDataValue(store, ['bloodSugar', 'blood_sugar', 'glucose', 'sugar']))
    : null;
  const value =
    rwValue ??
    cachedValue;
  if (value === null) return undefined;
  const timestamp = getMetricTimestamp(store, rwData, rwValue !== null);
  if (timestamp < since) return undefined;

  return {
    timestamp,
    bloodSugar: value,
    glucose: value
  };
};

export const getLatestBloodPressureReading = (store: RingStoreLike, since = 0) => {
  const rwData: any = findLatestReceived(
    store,
    (record) =>
      isRwHealthRecord(record, ['blood_pressure', 'bloodPressure', 'bp'], 'blood_pressure', since) &&
      Boolean(getRwBloodPressureParts(record)),
    since
  );
  const directValue = getRawMetricValue(rwData, ['value', 'bloodPressure', 'blood_pressure', 'bp']);
  const healthDataValue =
    shouldUseCachedMetricFallback(store, since)
      ? getRawMetricValue(store.healthData, ['bloodPressure', 'blood_pressure', 'bp']) ??
        getRawMetricValue(store.latestMetrics, ['bloodPressure', 'blood_pressure', 'bp'])
      : undefined;
  const rwParts = getRwBloodPressureParts(rwData);
  const healthDataParts =
    getBloodPressureParts(healthDataValue) ??
    (shouldUseCachedMetricFallback(store, since)
      ? getBloodPressureParts({
          systolic: getHealthDataValue(store, [
            'bloodPressureSystolic',
            'blood_pressure_systolic',
            'bloodPressureHigh',
            'blood_pressure_high',
            'highPressure',
            'high',
            'systolic',
            'sbp'
          ]),
          diastolic: getHealthDataValue(store, [
            'bloodPressureDiastolic',
            'blood_pressure_diastolic',
            'bloodPressureLow',
            'blood_pressure_low',
            'lowPressure',
            'low',
            'diastolic',
            'dbp'
          ])
        })
      : null);
  const parts = rwParts ?? healthDataParts;
  if (!parts || (parts.systolic === null && parts.diastolic === null)) return undefined;
  const timestamp = getMetricTimestamp(store, rwData, Boolean(rwParts));
  if (timestamp < since) return undefined;

  return {
    timestamp,
    bloodPressure: parts,
    systolic: parts.systolic,
    diastolic: parts.diastolic
  };
};
