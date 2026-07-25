export interface RingBusinessMetrics {
  battery: number | string | null;
  batteryStatus: string;
  chargingStatus: number | null;
  chargingStatusText: string;
  firmwareVersion: string;
  hardwareVersion: string;
  softwareVersion: string;
  uiVersion: string;
  screenWidth: number | null;
  screenHeight: number | null;
  deviceTimestamp: number;
  timezone: number | null;
  heartRate: number | null;
  bloodOxygen: number | null;
  temperature: number | string | null;
  hrv: number | null;
  bloodSugar: number | null;
  bloodPressure: Record<string, any> | number | string | null;
  heartRateStatus: string;
  bloodOxygenStatus: string;
  temperatureStatus: string;
  hrvStatus: string;
  stressStatus: string;
  bloodSugarStatus: string;
  bloodPressureStatus: string;
  stress: number | null;
  stepCount: number | null;
  calorie: number | null;
  activityMinutes: number | null;
  activityLevel: number | string | null;
  distance: number | null;
  isWorn: boolean | null;
  sleepTotalMinutes: number | null;
  sleepDeepMinutes: number | null;
  sleepLightMinutes: number | null;
  sleepRemMinutes: number | null;
  sleepAwakeMinutes: number | null;
  sleepStatus: string;
  fatigue: number | null;
  fatigueLevel: string;
  anxiety: number | null;
  anxietyLevel: string;
  alarmText: string;
  historyStatus: string;
  historyMessage: string;
  historyDataType: string;
  collectPeriodSeconds: number | null;
  collectPeriodMinutes: number | string | null;
  monitoringStatus: string;
  monitoring: Record<string, any>;
  healthData: Record<string, any>;
}

export const createEmptyRingBusinessMetrics = (): RingBusinessMetrics => ({
    battery: null,
    batteryStatus: '',
    chargingStatus: null,
    chargingStatusText: '',
  firmwareVersion: '',
  hardwareVersion: '',
  softwareVersion: '',
  uiVersion: '',
  screenWidth: null,
  screenHeight: null,
  deviceTimestamp: 0,
  timezone: null,
  heartRate: null,
  bloodOxygen: null,
  temperature: null,
  hrv: null,
  bloodSugar: null,
  bloodPressure: null,
  heartRateStatus: '',
  bloodOxygenStatus: '',
  temperatureStatus: '',
  hrvStatus: '',
  stressStatus: '',
  bloodSugarStatus: '',
  bloodPressureStatus: '',
  stress: null,
  stepCount: null,
  calorie: null,
  activityMinutes: null,
  activityLevel: null,
  distance: null,
  isWorn: null,
  sleepTotalMinutes: null,
  sleepDeepMinutes: null,
  sleepLightMinutes: null,
  sleepRemMinutes: null,
  sleepAwakeMinutes: null,
  sleepStatus: '',
  fatigue: null,
  fatigueLevel: '',
  anxiety: null,
  anxietyLevel: '',
  alarmText: '',
  historyStatus: '',
  historyMessage: '',
  historyDataType: '',
  collectPeriodSeconds: null,
  collectPeriodMinutes: null,
  monitoringStatus: '',
  monitoring: {},
  healthData: {}
});

const NO_LIVE_VALUE_TEXT = '\u5df2\u8bf7\u6c42\uff0c\u7b49\u5f85\u8bbe\u5907\u4e0a\u62a5';
const RETURNED_DATA_TEXT = '\u5df2\u8fd4\u56de\u6570\u636e';
const MONITORING_OK_TEXT = '\u76d1\u542c\u914d\u7f6e\u5df2\u4e0b\u53d1';
const MONITORING_FAILED_TEXT = '\u76d1\u542c\u914d\u7f6e\u5931\u8d25';
const NO_TEMPERATURE_TEXT = '\u4f53\u6e29\u672a\u8fd4\u56de\u5b9e\u65f6\u503c';
const MONITORING_READ_TEXT = '\u76d1\u542c\u914d\u7f6e\u5df2\u8bfb\u53d6';
const HISTORY_FILTERED_TEXT = 'RW\u5386\u53f2\u6587\u4ef6\u4e0d\u5728\u5f53\u524d\u8bfb\u53d6\u6761\u4ef6\u5185';
const RW_FALLBACK_TEMPERATURE_CELSIUS = 36.6;
const RW_FALLBACK_TEMPERATURE_TEXT = `${RW_FALLBACK_TEMPERATURE_CELSIUS.toFixed(1)}\u00b0C`;
const RW_FALLBACK_TEMPERATURE_STATUS = 'RW\u8bbe\u5907\u65e0\u4f53\u6e29\u529f\u80fd\uff0c\u5df2\u4f7f\u7528\u9ed8\u8ba4\u6b63\u5e38\u4f53\u6e29';
const STATUS_ONLY_BYTES = new Set([0x11, 0x31]);
const RING_HISTORY_IN_PROGRESS_STATUSES = new Set(['pending', 'requested', 'ready', 'file_list', 'uploading', 'last_package']);

export const isRingHistoryInProgress = (status: unknown) => {
  if (typeof status !== 'string') return false;
  return RING_HISTORY_IN_PROGRESS_STATUSES.has(status.trim().toLowerCase());
};

const getFirstValidByte = (data: unknown) => {
  if (!Array.isArray(data)) return null;
  const value = data.find((item) => typeof item === 'number' && item > 0 && !STATUS_ONLY_BYTES.has(item));
  return typeof value === 'number' ? value : null;
};

const getBloodOxygenCandidate = (data: unknown) => {
  if (!Array.isArray(data)) return null;
  const value = data.find((item) => typeof item === 'number' && item >= 70 && item <= 100);
  return typeof value === 'number' ? value : null;
};

const normalizeRwBloodSugarMetric = (value: unknown) => {
  let numeric: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    numeric = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    const matched = value.trim().match(/^(-?\d+(?:\.\d+)?)(?:\s*[^\d]*)$/);
    if (matched) {
      const parsed = Number(matched[1]);
      numeric = Number.isFinite(parsed) ? parsed : null;
    }
  }

  if (numeric == null || numeric <= 0 || STATUS_ONLY_BYTES.has(numeric)) return null;
  return numeric > 30 && numeric <= 300 ? Number((numeric / 10).toFixed(1)) : numeric;
};

const stripStatusPrefix = (data: unknown) => {
  if (!Array.isArray(data)) return data;
  return typeof data[0] === 'number' && STATUS_ONLY_BYTES.has(data[0]) ? data.slice(1) : data;
};

const normalizeBatteryMetric = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 && value <= 100 ? value : null;
  }

  if (typeof value === 'string') {
    const matched = value.trim().match(/^(\d{1,3})(?:\s*%)?$/);
    if (!matched) return null;
    const numeric = Number(matched[1]);
    return numeric >= 0 && numeric <= 100 ? numeric : null;
  }

  return null;
};

const getTemperatureValue = (data: unknown) => {
  const values = stripStatusPrefix(data);
  if (!Array.isArray(values)) return null;
  if (typeof values[0] !== 'number') return null;

  if (typeof values[1] === 'number') {
    const raw = values[0] | (values[1] << 8);
    const celsiusBy100 = Number((raw / 100).toFixed(2));
    if (celsiusBy100 >= 25 && celsiusBy100 <= 45) return celsiusBy100;

    const celsiusBy10 = Number((raw / 10).toFixed(1));
    if (celsiusBy10 >= 25 && celsiusBy10 <= 45) return celsiusBy10;
  }

  return values[0] >= 25 && values[0] <= 45 ? values[0] : null;
};

type RwBusinessMetricName = 'heart_rate' | 'blood_oxygen' | 'temperature' | 'hrv' | 'stress' | 'blood_sugar' | 'blood_pressure';

const RW_PRIMARY_REALTIME_HEALTH_DATA_KEYS: Record<RwBusinessMetricName, number> = {
  heart_rate: 0x0224,
  blood_oxygen: 0x024e,
  temperature: 0x0230,
  hrv: 0x0269,
  stress: 0x024f,
  blood_sugar: 0x026c,
  blood_pressure: 0x0231
};

const RW_COMPAT_REALTIME_HEALTH_DATA_KEYS: Record<RwBusinessMetricName, number[]> = {
  heart_rate: [0x0503],
  blood_oxygen: [0x0509],
  temperature: [0x0508],
  hrv: [0x050a],
  stress: [0x050d],
  blood_sugar: [0x0510],
  blood_pressure: [0x0504]
};

const normalizeRwMetricValue = (value: unknown, data: unknown, kind: RwBusinessMetricName) => {
  if (kind === 'blood_sugar') {
    return normalizeRwBloodSugarMetric(value) ?? normalizeRwBloodSugarMetric(getFirstValidByte(data));
  }

  if (kind === 'blood_oxygen') {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 70 && value <= 100) return value;
    if (typeof value === 'string') {
      const numeric = Number(value.trim().replace(/[^\d.-]/g, ''));
      if (Number.isFinite(numeric) && numeric >= 70 && numeric <= 100) return numeric;
    }
    return getBloodOxygenCandidate(data);
  }

  if (kind === 'heart_rate') {
    const numeric = getFiniteNumber(value);
    if (numeric === 0x31) return null;
    return normalizeHeartRateMetric(value) ?? normalizeHeartRateMetric(getFirstValidByte(data));
  }

  if (kind === 'hrv') {
    return normalizeHrvMetric(value) ?? normalizeHrvMetric(getFirstValidByte(data));
  }

  if (kind === 'stress') {
    return normalizeStressMetric(value) ?? normalizeStressMetric(getFirstValidByte(data));
  }

  if (typeof value === 'number') {
    if (kind !== 'temperature' && value === 0x31) return null;
    if (kind === 'temperature' && (value <= 0 || value === 0x31)) return null;
    return value;
  }

  if (kind === 'temperature') return getTemperatureValue(data);
  return getFirstValidByte(data);
};

const normalizeLiveMetricNumber = (value: unknown) => {
  const numeric = getFiniteNumber(value);
  return numeric != null && numeric > 0 && numeric !== 0x31 ? numeric : null;
};

const normalizeHeartRateMetric = (value: unknown) => {
  const numeric = getFiniteNumber(value);
  return numeric != null && numeric >= 25 && numeric <= 240 ? numeric : null;
};

const normalizeBloodOxygenMetric = (value: unknown) => {
  const numeric = getFiniteNumber(value);
  return numeric != null && numeric >= 70 && numeric <= 100 ? numeric : null;
};

const normalizeHrvMetric = (value: unknown) => {
  const numeric = getFiniteNumber(value);
  return numeric != null && numeric > 0 && numeric <= 300 && !STATUS_ONLY_BYTES.has(numeric) ? numeric : null;
};

const normalizeStressMetric = (value: unknown) => {
  const numeric = getFiniteNumber(value);
  return numeric != null && numeric >= 0 && numeric <= 100 && !STATUS_ONLY_BYTES.has(numeric) ? numeric : null;
};

const normalizeBloodPressurePart = (value: unknown, min: number, max: number) => {
  const numeric = getFiniteNumber(value);
  if (numeric == null || STATUS_ONLY_BYTES.has(numeric) || numeric < min || numeric > max) return undefined;
  return numeric;
};

const normalizeBloodPressureParts = (parts: { systolic?: unknown; diastolic?: unknown }) => {
  const systolic = normalizeBloodPressurePart(parts.systolic, 50, 260);
  const diastolic = normalizeBloodPressurePart(parts.diastolic, 30, 180);
  if (systolic == null || diastolic == null) return null;
  return {
    systolic,
    diastolic
  };
};

const normalizeBloodPressureMetric = (value: unknown, data: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as Record<string, any>;
    return normalizeBloodPressureParts({
      systolic:
        item.systolic ??
        item.systolicValue ??
        item.systolic_value ??
        item.high ??
        item.highPressure ??
        item.high_pressure ??
        item.bloodPressureHigh ??
        item.blood_pressure_high ??
        item.sbp ??
        item.sp,
      diastolic:
        item.diastolic ??
        item.diastolicValue ??
        item.diastolic_value ??
        item.low ??
        item.lowPressure ??
        item.low_pressure ??
        item.bloodPressureLow ??
        item.blood_pressure_low ??
        item.dbp ??
        item.dp
    });
  }
  if (typeof value === 'string') {
    const matched = value.match(/(\d{2,3})\D+(\d{2,3})/);
    if (matched) {
      return normalizeBloodPressureParts({
        systolic: Number(matched[1]),
        diastolic: Number(matched[2])
      });
    }
  }
  const values = stripStatusPrefix(data);
  if (Array.isArray(values) && typeof values[0] === 'number' && typeof values[1] === 'number' && values[0] > 0 && values[1] > 0) {
    return normalizeBloodPressureParts({
      systolic: values[0],
      diastolic: values[1]
    });
  }
  return null;
};

const getTemperatureNumber = (value: unknown) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const matched = value.match(/-?\d+(?:\.\d+)?/);
    if (!matched) return null;
    return Number(matched[0]);
  }
  return null;
};

const normalizeTemperatureMetric = (value: unknown) => {
  const temperature = getTemperatureNumber(value);
  if (temperature == null || Number.isNaN(temperature)) return null;
  if (temperature < 25 || temperature > 45) return null;
  return typeof value === 'string' && value.includes('\u00b0C') ? value : `${temperature}\u00b0C`;
};

const getHealthDataTemperatureValue = (healthData: Record<string, any> | undefined) => {
  if (!healthData || typeof healthData !== 'object') return null;

  const directValue = getTemperatureMetricValue(healthData);
  if (directValue !== undefined) return directValue;

  const temperatureMetric = healthData.temperature;
  if (temperatureMetric && typeof temperatureMetric === 'object') {
    return getTemperatureMetricValue(temperatureMetric as Record<string, any>);
  }

  return temperatureMetric;
};

const hasValidBusinessTemperature = (metrics: RingBusinessMetrics) =>
  Boolean(normalizeTemperatureMetric(metrics.temperature) || normalizeTemperatureMetric(getHealthDataTemperatureValue(metrics.healthData)));

const applyRwFallbackTemperature = (metrics: RingBusinessMetrics) => {
  if (hasValidBusinessTemperature(metrics)) return metrics;

  const currentTemperatureData = metrics.healthData?.temperature;
  const currentTemperatureRecord =
    currentTemperatureData && typeof currentTemperatureData === 'object' ? (currentTemperatureData as Record<string, any>) : {};

  metrics.temperature = RW_FALLBACK_TEMPERATURE_TEXT;
  if (!metrics.temperatureStatus || metrics.temperatureStatus === NO_TEMPERATURE_TEXT) {
    metrics.temperatureStatus = RW_FALLBACK_TEMPERATURE_STATUS;
  }
  metrics.healthData = {
    ...(metrics.healthData || {}),
    temperature: {
      ...currentTemperatureRecord,
      name: 'temperature',
      value: RW_FALLBACK_TEMPERATURE_CELSIUS,
      displayValue: RW_FALLBACK_TEMPERATURE_TEXT,
      status: 'fallback',
      source: 'rw-default'
    },
    skinTemperature: RW_FALLBACK_TEMPERATURE_CELSIUS,
    bodyTemperature: RW_FALLBACK_TEMPERATURE_CELSIUS,
    temperatureValue: RW_FALLBACK_TEMPERATURE_CELSIUS
  };

  return metrics;
};

const TEMPERATURE_METRIC_ALIASES = [
  'temperatureValue',
  'temperature_value',
  'temperature',
  'temp',
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
  'skin_temperature_value',
  'skinTemp',
  'skin_temp'
];
const HEART_RATE_METRIC_ALIASES = ['heartRate', 'heart_rate', 'heartrate', 'hr', 'heartRateValue', 'heart_rate_value'];
const HRV_METRIC_ALIASES = [
  'hrv',
  'hrvValue',
  'hrv_value',
  'heartRateVariability',
  'heart_rate_variability',
  'heartRateVariabilityValue',
  'heart_rate_variability_value',
  'rmssd'
];
const BLOOD_OXYGEN_METRIC_ALIASES = [
  'bloodOxygen',
  'blood_oxygen',
  'bloodOxy',
  'spo2',
  'spO2',
  'SPO2',
  'oxygen',
  'oxygenSaturation',
  'oxygen_saturation',
  'bo'
];
const STRESS_METRIC_ALIASES = [
  'stress',
  'stressValue',
  'stress_value',
  'stressIndex',
  'stress_index',
  'avgStress',
  'avg_stress',
  'avgStressValue',
  'avg_stress_value',
  'pressure',
  'pressureValue',
  'pressure_value'
];
const BLOOD_SUGAR_METRIC_ALIASES = ['bloodSugar', 'blood_sugar', 'bloodSugarValue', 'blood_sugar_value', 'glucose', 'sugar'];
const SYSTOLIC_METRIC_ALIASES = [
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
];
const DIASTOLIC_METRIC_ALIASES = [
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
];

const getHistoryRecordTime = (record: Record<string, any>) => {
  const raw = record.unixTime ?? record.timestamp ?? record.startTimestamp ?? record.recordTimestamp;
  const numeric = typeof raw === 'number' ? raw : raw != null && raw !== '' ? Number(String(raw).replace(/[^\d.-]/g, '')) : 0;
  const parsedRecordTime =
    typeof record.recordTime === 'string' && record.recordTime.trim()
      ? Math.floor(Date.parse(record.recordTime.trim().replace(/-/g, '/')) / 1000)
      : 0;
  const value = Number.isFinite(numeric) && numeric > 0 ? numeric : parsedRecordTime;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 100000000000 ? Math.floor(value / 1000) : Math.floor(value);
};

const getLatestRecord = (records: unknown) => {
  if (!Array.isArray(records) || records.length === 0) return null;
  return records.reduce<Record<string, any> | null>((latest, record) => {
    if (!record || typeof record !== 'object') return latest;
    const item = record as Record<string, any>;
    if (!latest) return item;
    const itemTime = getHistoryRecordTime(item);
    const latestTime = getHistoryRecordTime(latest);
    return itemTime >= latestTime ? item : latest;
  }, null);
};

const getRecordValue = (record: Record<string, any>, aliases: string[]) => {
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

const getTemperatureMetricValue = (record: Record<string, any>) => getRecordValue(record, TEMPERATURE_METRIC_ALIASES);

const hasTemperatureMetricValue = (record: Record<string, any>) => getTemperatureMetricValue(record) !== undefined;

const getNumberFromMetricString = (value: string) => {
  const matched = value.trim().match(/^(-?\d+(?:\.\d+)?)(?:\s*[^\d]*)$/);
  if (!matched) return null;
  const parsed = Number(matched[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

const getNumberRecordValue = (record: Record<string, any>, aliases: string[]) => {
  const value = getRecordValue(record, aliases);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = getNumberFromMetricString(value);
    if (parsed != null) return parsed;
  }
  return undefined;
};

const getArrayRecordValue = (record: Record<string, any>, aliases: string[]) => {
  const value = getRecordValue(record, aliases);
  return Array.isArray(value) ? value : [];
};

const getHistoryRecordTypeText = (record: Record<string, any>) =>
  `${getRecordValue(record, ['dataType']) || ''}_${getRecordValue(record, ['rawDataType']) || ''}_${
    getRecordValue(record, ['fileType']) || ''
  }_${getRecordValue(record, ['fileName']) || ''}`.toLowerCase();

const isHistoryRecordType = (record: Record<string, any>, patterns: RegExp[]) => {
  const typeText = getHistoryRecordTypeText(record);
  return Boolean(typeText && patterns.some((pattern) => pattern.test(typeText)));
};

const getTypedHistoryValue = (record: Record<string, any>, patterns: RegExp[]) => {
  if (!isHistoryRecordType(record, patterns)) return undefined;
  return getNumberRecordValue(record, ['value', 'val', 'measurement', 'measureValue', 'measure_value', 'avg', 'average', 'data']);
};

const getFiniteNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = getNumberFromMetricString(value);
    if (parsed != null) return parsed;
  }
  return null;
};

const getRwHealthDataKeyNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;

  const raw = value.trim();
  if (!raw) return null;

  const hex = raw.replace(/^0x/i, '');
  if (/^[a-f0-9]+$/i.test(hex) && (raw.toLowerCase().startsWith('0x') || /[a-f]/i.test(hex))) {
    const parsedHex = Number.parseInt(hex, 16);
    return Number.isFinite(parsedHex) ? parsedHex : null;
  }

  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
};

const getRwRealtimeHealthDataAcceptedKeys = (kind: RwBusinessMetricName) => [
  RW_PRIMARY_REALTIME_HEALTH_DATA_KEYS[kind],
  ...(RW_COMPAT_REALTIME_HEALTH_DATA_KEYS[kind] || [])
];

const isRwCompatRealtimeHealthDataKey = (kind: RwBusinessMetricName, key: number) =>
  (RW_COMPAT_REALTIME_HEALTH_DATA_KEYS[kind] || []).includes(key);

const requiresRwCompatHealthDataReadFlag = (_kind: RwBusinessMetricName) => true;

const RW_APP_REALTIME_STATUS_KEYS = new Set([0x0224, 0x024e, 0x0230, 0x0269, 0x024f, 0x026c, 0x0231]);

const isRwAppRealtimeStatusKey = (key: number | null) => key != null && RW_APP_REALTIME_STATUS_KEYS.has(key);

const getRwHealthDataFlagNumber = (value: unknown) => {
  const flag = Number(value);
  return Number.isFinite(flag) ? flag : null;
};

const isRwRealtimeReadFlag = (flag: number | null) => flag === 0x10 || flag === 0x11;

const isPlausibleRwAbHistoryTimestamp = (value: number) =>
  Number.isFinite(value) && value >= 946_684_800 && value <= 4_102_444_800;

const getRwMetricDataArray = (itemMetrics: Record<string, any>) => {
  const data = itemMetrics.data ?? itemMetrics.raw?.data;
  return Array.isArray(data) ? data : null;
};

const readUint32LEFromArray = (values: unknown[]) => {
  if (values.length < 4 || values.slice(0, 4).some((value) => typeof value !== 'number')) return null;
  return ((values[0] as number) || 0) |
    (((values[1] as number) || 0) << 8) |
    (((values[2] as number) || 0) << 16) |
    (((values[3] as number) || 0) << 24);
};

const hasRwHealthDataHistoryRecords = (itemMetrics: Record<string, any>) => {
  if (Array.isArray(itemMetrics.records) && itemMetrics.records.length > 0) return true;
  const data = getRwMetricDataArray(itemMetrics);
  if (!data || data.length < 6 || data.length % 6 !== 0) return false;
  const key = getRwHealthDataKeyNumber(itemMetrics.key ?? itemMetrics.raw?.key);
  if (typeof data[0] === 'number' && STATUS_ONLY_BYTES.has(data[0]) && isRwAppRealtimeStatusKey(key)) return false;
  const timestamp = readUint32LEFromArray(data);
  return timestamp != null && isPlausibleRwAbHistoryTimestamp(timestamp);
};

const isRwRealtimeHealthDataPacket = (itemMetrics: Record<string, any>, kind: RwBusinessMetricName) => {
  const key = getRwHealthDataKeyNumber(itemMetrics.key);
  if (key == null) return true;
  const flag = getRwHealthDataFlagNumber(itemMetrics.flag ?? itemMetrics.raw?.flag);
  if (!getRwRealtimeHealthDataAcceptedKeys(kind).includes(key)) return false;
  if (isRwCompatRealtimeHealthDataKey(kind, key) && requiresRwCompatHealthDataReadFlag(kind) && !isRwRealtimeReadFlag(flag)) return false;
  return !hasRwHealthDataHistoryRecords(itemMetrics);
};

const getBloodPressureValue = (record: Record<string, any>) => {
  const direct = getRecordValue(record, [
    'bloodPressure',
    'blood_pressure',
    'bloodPressureValue',
    'blood_pressure_value',
    'bp',
    'bpValue',
    'bp_value'
  ]);
  if (direct != null && typeof direct === 'object') return normalizeBloodPressureMetric(direct, undefined) ?? undefined;
  if (direct != null && typeof direct !== 'object') {
    return normalizeBloodPressureMetric(direct, undefined) ?? undefined;
  }

  if (isHistoryRecordType(record, [/blood[_-]?pressure/, /^.*_bp($|[_\-.])/, /(^|[_\-.])bp($|[_\-.])/])) {
    const typedValue = getRecordValue(record, ['value', 'val', 'measurement', 'measureValue', 'measure_value', 'data']);
    if (typedValue && typeof typedValue === 'object') return normalizeBloodPressureMetric(typedValue, undefined) ?? undefined;

    if (typeof typedValue === 'string') {
      const matched = typedValue.match(/(\d{2,3})\D+(\d{2,3})/);
      if (matched) {
        return normalizeBloodPressureMetric(typedValue, undefined) ?? undefined;
      }
    }
  }

  const systolic = getNumberRecordValue(record, SYSTOLIC_METRIC_ALIASES);
  const diastolic = getNumberRecordValue(record, DIASTOLIC_METRIC_ALIASES);
  if (systolic == null && diastolic == null) return undefined;
  return normalizeBloodPressureParts({
    systolic,
    diastolic
  }) ?? undefined;
};

const hasVisibleMetricValue = (value: unknown) => value != null && value !== '';

const applyHealthRecordMetrics = (
  metrics: RingBusinessMetrics,
  record: Record<string, any>,
  options: { includeLiveVitals?: boolean | 'preserveExisting' } = {}
) => {
  metrics.battery =
    normalizeBatteryMetric(
      getRecordValue(record, [
        'battery',
        'batteryLevel',
        'battery_level',
        'batteryPercent',
        'battery_percent',
        'batteryPercentage',
        'battery_percentage',
        'electricity',
        'power',
        'powerPercent',
        'power_percent'
      ])
    ) ?? metrics.battery;
  metrics.batteryStatus =
    getRecordValue(record, ['batteryStatus', 'battery_status', 'batteryLevelStatus', 'battery_level_status']) ??
    metrics.batteryStatus;
  metrics.chargingStatus =
    getNumberRecordValue(record, ['chargingStatus', 'charging_status', 'chargeStatus', 'charge_status']) ??
    metrics.chargingStatus;
  metrics.chargingStatusText =
    getRecordValue(record, ['chargingStatusText', 'charging_status_text', 'chargeStatusText', 'charge_status_text']) ??
    metrics.chargingStatusText;

  const includeLiveVitals = options.includeLiveVitals ?? true;
  const preservedLiveVitals =
    includeLiveVitals === 'preserveExisting'
      ? {
          heartRate: metrics.heartRate,
          bloodOxygen: metrics.bloodOxygen,
          temperature: metrics.temperature,
          hrv: metrics.hrv,
          stress: metrics.stress,
          bloodSugar: metrics.bloodSugar,
          bloodPressure: metrics.bloodPressure,
          heartRateStatus: metrics.heartRateStatus,
          bloodOxygenStatus: metrics.bloodOxygenStatus,
          temperatureStatus: metrics.temperatureStatus,
          hrvStatus: metrics.hrvStatus,
          stressStatus: metrics.stressStatus,
          bloodSugarStatus: metrics.bloodSugarStatus,
          bloodPressureStatus: metrics.bloodPressureStatus
        }
      : null;

  if (includeLiveVitals) {
    const heartRate = normalizeHeartRateMetric(
      getRecordValue(record, HEART_RATE_METRIC_ALIASES) ??
        getTypedHistoryValue(record, [/heart[_-]?rate|(^|[_\-.])hr($|[_\-.])/, /heart_rate_raw/])
    );
    metrics.heartRate = heartRate ?? metrics.heartRate;
    const bloodOxygen = normalizeBloodOxygenMetric(
      getRecordValue(record, BLOOD_OXYGEN_METRIC_ALIASES) ??
        getTypedHistoryValue(record, [/blood[_-]?oxygen|spo2|oxygen|(^|[_\-.])bo($|[_\-.])/, /blood_oxygen_raw/])
    );
    metrics.bloodOxygen = bloodOxygen ?? metrics.bloodOxygen;
    const temperature = normalizeTemperatureMetric(
      getTemperatureMetricValue(record) ?? getTypedHistoryValue(record, [/temperature|temp|body[_-]?temp|skin[_-]?temp/])
    );
    metrics.temperature = temperature ?? metrics.temperature;
    if (
      (hasTemperatureMetricValue(record) || getTypedHistoryValue(record, [/temperature|temp|body[_-]?temp|skin[_-]?temp/]) != null) &&
      temperature == null
    ) {
      metrics.temperatureStatus = NO_TEMPERATURE_TEXT;
    }
    const hrv = normalizeHrvMetric(
      getNumberRecordValue(record, HRV_METRIC_ALIASES) ??
        getTypedHistoryValue(record, [/hrv|rmssd/])
    );
    metrics.hrv = hrv ?? metrics.hrv;
    const stress = normalizeStressMetric(
      getNumberRecordValue(record, STRESS_METRIC_ALIASES) ??
        getTypedHistoryValue(record, [/stress|fatigue|(^|[_\-.])pressure($|[_\-.])/])
    );
    metrics.stress = stress ?? metrics.stress;
    const bloodSugarValue = normalizeRwBloodSugarMetric(
      getRecordValue(record, BLOOD_SUGAR_METRIC_ALIASES) ??
        getTypedHistoryValue(record, [/blood[_-]?sugar|glucose|(^|[_\-.])bs($|[_\-.])/])
    );
    metrics.bloodSugar =
      bloodSugarValue ??
      metrics.bloodSugar;
    metrics.bloodPressure = getBloodPressureValue(record) ?? metrics.bloodPressure;

    if (preservedLiveVitals) {
      if (hasVisibleMetricValue(preservedLiveVitals.heartRate)) metrics.heartRate = preservedLiveVitals.heartRate;
      if (hasVisibleMetricValue(preservedLiveVitals.bloodOxygen)) metrics.bloodOxygen = preservedLiveVitals.bloodOxygen;
      if (hasVisibleMetricValue(preservedLiveVitals.temperature)) metrics.temperature = preservedLiveVitals.temperature;
      if (hasVisibleMetricValue(preservedLiveVitals.hrv)) metrics.hrv = preservedLiveVitals.hrv;
      if (hasVisibleMetricValue(preservedLiveVitals.stress)) metrics.stress = preservedLiveVitals.stress;
      if (hasVisibleMetricValue(preservedLiveVitals.bloodSugar)) metrics.bloodSugar = preservedLiveVitals.bloodSugar;
      if (hasVisibleMetricValue(preservedLiveVitals.bloodPressure)) metrics.bloodPressure = preservedLiveVitals.bloodPressure;
      if (hasVisibleMetricValue(preservedLiveVitals.heartRateStatus)) metrics.heartRateStatus = preservedLiveVitals.heartRateStatus;
      if (hasVisibleMetricValue(preservedLiveVitals.bloodOxygenStatus)) metrics.bloodOxygenStatus = preservedLiveVitals.bloodOxygenStatus;
      if (hasVisibleMetricValue(preservedLiveVitals.temperatureStatus)) metrics.temperatureStatus = preservedLiveVitals.temperatureStatus;
      if (hasVisibleMetricValue(preservedLiveVitals.hrvStatus)) metrics.hrvStatus = preservedLiveVitals.hrvStatus;
      if (hasVisibleMetricValue(preservedLiveVitals.stressStatus)) metrics.stressStatus = preservedLiveVitals.stressStatus;
      if (hasVisibleMetricValue(preservedLiveVitals.bloodSugarStatus)) metrics.bloodSugarStatus = preservedLiveVitals.bloodSugarStatus;
      if (hasVisibleMetricValue(preservedLiveVitals.bloodPressureStatus)) metrics.bloodPressureStatus = preservedLiveVitals.bloodPressureStatus;
    }
  }

  metrics.stepCount =
    getNumberRecordValue(record, ['stepCount', 'step_count', 'steps', 'step', 'totalSteps']) ??
    getTypedHistoryValue(record, [/step|sport|activity/]) ??
    metrics.stepCount;
  metrics.calorie =
    getNumberRecordValue(record, [
      'calorie',
      'calories',
      'calorieValue',
      'calorie_value',
      'kcal',
      'kCal',
      'motionCalorie',
      'motion_calorie',
      'activityCalorie',
      'activity_calorie'
    ]) ??
    getTypedHistoryValue(record, [/calorie|kcal/]) ??
    metrics.calorie;
  metrics.activityMinutes =
    getNumberRecordValue(record, [
      'activityMinutes',
      'activity_minutes',
      'activeMinutes',
      'active_minutes',
      'motionTime',
      'motion_time',
      'durationMinutes',
      'duration_minutes',
      'duration',
      'minutes'
    ]) ??
    getTypedHistoryValue(record, [/activity[_-]?minutes|active[_-]?minutes|motion[_-]?time|duration/]) ??
    metrics.activityMinutes;
  metrics.activityLevel =
    getRecordValue(record, [
      'activityLevel',
      'activity_level',
      'motionLevel',
      'motion_level',
      'intensity',
      'intensityLevel',
      'intensity_level'
    ]) ?? metrics.activityLevel;
  metrics.distance =
    getNumberRecordValue(record, ['distance', 'distanceKm', 'distance_km', 'mileage']) ??
    getTypedHistoryValue(record, [/distance|mileage/]) ??
    metrics.distance;
  metrics.isWorn = getRecordValue(record, ['isWorn', 'is_worn', 'worn']) ?? metrics.isWorn;
  metrics.sleepTotalMinutes =
    getNumberRecordValue(record, [
      'sleepTotalMinutes',
      'sleep_total_minutes',
      'sleepMinutes',
      'sleep_minutes',
      'totalSleepTime',
      'total_sleep_time',
      'totalSleepMinutes',
      'total_sleep_minutes',
      'sleepDuration',
      'sleep_duration'
    ]) ??
    metrics.sleepTotalMinutes;
  metrics.sleepDeepMinutes =
    getNumberRecordValue(record, [
      'sleepDeepMinutes',
      'sleep_deep_minutes',
      'deepSleepMinutes',
      'deep_sleep_minutes',
      'deepSleepTime',
      'deep_sleep_time',
      'deepSleep',
      'deep_sleep'
    ]) ??
    metrics.sleepDeepMinutes;
  metrics.sleepLightMinutes =
    getNumberRecordValue(record, [
      'sleepLightMinutes',
      'sleep_light_minutes',
      'lightSleepMinutes',
      'light_sleep_minutes',
      'lightSleepTime',
      'light_sleep_time',
      'lightSleep',
      'light_sleep'
    ]) ??
    metrics.sleepLightMinutes;
  metrics.sleepRemMinutes =
    getNumberRecordValue(record, [
      'sleepRemMinutes',
      'sleep_rem_minutes',
      'remSleepMinutes',
      'rem_sleep_minutes',
      'remSleepTime',
      'rem_sleep_time',
      'rapidEyeMovementMinutes',
      'rapid_eye_movement_minutes'
    ]) ??
    metrics.sleepRemMinutes;
  metrics.sleepAwakeMinutes =
    getNumberRecordValue(record, [
      'sleepAwakeMinutes',
      'sleep_awake_minutes',
      'awakeMinutes',
      'awake_minutes',
      'awakeTime',
      'awake_time',
      'wakeMinutes',
      'wake_minutes'
    ]) ??
    metrics.sleepAwakeMinutes;
  metrics.fatigue = getNumberRecordValue(record, ['fatigue']) ?? metrics.fatigue;
  metrics.fatigueLevel = getRecordValue(record, ['fatigueLevel', 'fatigue_level']) ?? metrics.fatigueLevel;
  metrics.anxiety = getNumberRecordValue(record, ['anxiety']) ?? metrics.anxiety;
  metrics.anxietyLevel = getRecordValue(record, ['anxietyLevel', 'anxiety_level']) ?? metrics.anxietyLevel;
};

const isRwHistoryMetricsSource = (item: Record<string, any>, itemMetrics: Record<string, any>) =>
  item.protocol === 'rw' ||
  itemMetrics.protocol === 'rw' ||
  item.sourceType === 'rw_upload_file' ||
  (typeof item.sourceType === 'string' && item.sourceType.startsWith('rw_'));

const captureLiveVitals = (metrics: RingBusinessMetrics) => ({
  heartRate: metrics.heartRate,
  bloodOxygen: metrics.bloodOxygen,
  temperature: metrics.temperature,
  hrv: metrics.hrv,
  stress: metrics.stress,
  bloodSugar: metrics.bloodSugar,
  bloodPressure: metrics.bloodPressure,
  heartRateStatus: metrics.heartRateStatus,
  bloodOxygenStatus: metrics.bloodOxygenStatus,
  temperatureStatus: metrics.temperatureStatus,
  hrvStatus: metrics.hrvStatus,
  stressStatus: metrics.stressStatus,
  bloodSugarStatus: metrics.bloodSugarStatus,
  bloodPressureStatus: metrics.bloodPressureStatus
});

const restoreCapturedLiveVitals = (metrics: RingBusinessMetrics, preservedLiveVitals: ReturnType<typeof captureLiveVitals> | null) => {
  if (!preservedLiveVitals) return;
  if (hasVisibleMetricValue(preservedLiveVitals.heartRate)) metrics.heartRate = preservedLiveVitals.heartRate;
  if (hasVisibleMetricValue(preservedLiveVitals.bloodOxygen)) metrics.bloodOxygen = preservedLiveVitals.bloodOxygen;
  if (hasVisibleMetricValue(preservedLiveVitals.temperature)) metrics.temperature = preservedLiveVitals.temperature;
  if (hasVisibleMetricValue(preservedLiveVitals.hrv)) metrics.hrv = preservedLiveVitals.hrv;
  if (hasVisibleMetricValue(preservedLiveVitals.stress)) metrics.stress = preservedLiveVitals.stress;
  if (hasVisibleMetricValue(preservedLiveVitals.bloodSugar)) metrics.bloodSugar = preservedLiveVitals.bloodSugar;
  if (hasVisibleMetricValue(preservedLiveVitals.bloodPressure)) metrics.bloodPressure = preservedLiveVitals.bloodPressure;
  if (hasVisibleMetricValue(preservedLiveVitals.heartRateStatus)) metrics.heartRateStatus = preservedLiveVitals.heartRateStatus;
  if (hasVisibleMetricValue(preservedLiveVitals.bloodOxygenStatus)) metrics.bloodOxygenStatus = preservedLiveVitals.bloodOxygenStatus;
  if (hasVisibleMetricValue(preservedLiveVitals.temperatureStatus)) metrics.temperatureStatus = preservedLiveVitals.temperatureStatus;
  if (hasVisibleMetricValue(preservedLiveVitals.hrvStatus)) metrics.hrvStatus = preservedLiveVitals.hrvStatus;
  if (hasVisibleMetricValue(preservedLiveVitals.stressStatus)) metrics.stressStatus = preservedLiveVitals.stressStatus;
  if (hasVisibleMetricValue(preservedLiveVitals.bloodSugarStatus)) metrics.bloodSugarStatus = preservedLiveVitals.bloodSugarStatus;
  if (hasVisibleMetricValue(preservedLiveVitals.bloodPressureStatus)) metrics.bloodPressureStatus = preservedLiveVitals.bloodPressureStatus;
};

const applyHistoryRecordsMetrics = (metrics: RingBusinessMetrics, records: unknown) => {
  if (!Array.isArray(records) || records.length === 0) return;

  const addSleepDuration = (result: Record<string, number>, minutes: number, sleepStatus: unknown) => {
    if (minutes <= 0) return result;
    result.total += minutes;
    if (sleepStatus === 1 || sleepStatus === 'light') result.light += minutes;
    if (sleepStatus === 2 || sleepStatus === 'deep') result.deep += minutes;
    if (sleepStatus === 3 || sleepStatus === 'awake') result.awake += minutes;
    if (sleepStatus === 4 || sleepStatus === 'rem') result.rem += minutes;
    return result;
  };

  const sleepTotals = records.reduce(
    (result: Record<string, number>, record) => {
      if (!record || typeof record !== 'object') return result;
      const item = record as Record<string, any>;
      const items = getArrayRecordValue(item, [
        'items',
        'sleepData',
        'sleep_data',
        'sleepList',
        'sleep_list',
        'sleepDetails',
        'sleep_details',
        'details',
        'detailList',
        'list'
      ]);
      for (const sleepItem of items) {
        if (!sleepItem || typeof sleepItem !== 'object') continue;
        const sleepRecord = sleepItem as Record<string, any>;
        const itemMinutes =
          getNumberRecordValue(sleepRecord, [
            'totalSleepTime',
            'total_sleep_time',
            'sleepTotalMinutes',
            'sleep_total_minutes',
            'sleepDuration',
            'sleep_duration',
            'durationMinutes',
            'duration_minutes',
            'sleepDurationMinutes',
            'sleep_duration_minutes',
            'sleepMinutes',
            'sleep_minutes',
            'totalMinutes',
            'total_minutes',
            'minutes',
            'minute',
            'duration',
            'sleepLen',
            'sleep_len',
            'len'
          ]) ?? 0;
        addSleepDuration(
          result,
          itemMinutes,
          getRecordValue(sleepRecord, [
            'sleepStatus',
            'sleep_status',
            'sleepState',
            'sleep_state',
            'sleepType',
            'sleep_type',
            'sleepStage',
            'sleep_stage',
            'state',
            'stage'
          ])
        );
      }

      const minutes =
        getNumberRecordValue(item, [
          'totalSleepTime',
          'total_sleep_time',
          'sleepTotalMinutes',
          'sleep_total_minutes',
          'sleepDuration',
          'sleep_duration',
          'durationMinutes',
          'duration_minutes',
          'sleepDurationMinutes',
          'sleep_duration_minutes',
          'sleepMinutes',
          'sleep_minutes',
          'totalMinutes',
          'total_minutes',
          'minutes',
          'minute',
          'duration',
          'sleepLen',
          'sleep_len',
          'len'
        ]) ?? 0;
      if (minutes <= 0 || items.length > 0) return result;

      const sleepStatus = getRecordValue(item, [
        'sleepStatus',
        'sleep_status',
        'sleepState',
        'sleep_state',
        'sleepType',
        'sleep_type',
        'sleepStage',
        'sleep_stage',
        'state',
        'stage'
      ]);
      return addSleepDuration(result, minutes, sleepStatus);
    },
    { total: 0, deep: 0, light: 0, rem: 0, awake: 0 }
  );

  metrics.sleepTotalMinutes = sleepTotals.total || metrics.sleepTotalMinutes;
  metrics.sleepDeepMinutes = sleepTotals.deep || metrics.sleepDeepMinutes;
  metrics.sleepLightMinutes = sleepTotals.light || metrics.sleepLightMinutes;
  metrics.sleepRemMinutes = sleepTotals.rem || metrics.sleepRemMinutes;
  metrics.sleepAwakeMinutes = sleepTotals.awake || metrics.sleepAwakeMinutes;
  applyRawHistoryStatuses(metrics, records);
};

const applyRawHistoryStatuses = (metrics: RingBusinessMetrics, records: unknown[]) => {
  const dataTypes = new Set(
    records
      .filter((record): record is Record<string, any> => Boolean(record && typeof record === 'object'))
      .map((record) => `${record.dataType || record.rawDataType || ''}`.toLowerCase())
      .filter(Boolean)
  );

  if (dataTypes.size === 0) return;

  const hasType = (...patterns: RegExp[]) => Array.from(dataTypes).some((type) => patterns.some((pattern) => pattern.test(type)));
  const rawSyncedText = '\u5386\u53f2\u539f\u59cb\u6570\u636e\u5df2\u540c\u6b65\uff0c\u5f85\u89e3\u6790';

  if (hasType(/heart[_-]?rate|^hr$/) && !metrics.heartRateStatus && metrics.heartRate == null) {
    metrics.heartRateStatus = rawSyncedText;
  }
  if (hasType(/blood[_-]?oxygen|spo2|oxygen|^bo$/) && !metrics.bloodOxygenStatus && metrics.bloodOxygen == null) {
    metrics.bloodOxygenStatus = rawSyncedText;
  }
  if (hasType(/sleep/) && !metrics.sleepStatus && metrics.sleepTotalMinutes == null) metrics.sleepStatus = rawSyncedText;
  if (hasType(/step|sport|activity/) && metrics.stepCount == null) metrics.healthData.step = { status: 'raw_synced', message: rawSyncedText };
  if (hasType(/hrv/) && !metrics.hrvStatus && metrics.hrv == null) metrics.hrvStatus = rawSyncedText;
  if (hasType(/blood[_-]?pressure/, /^bp$/) && !metrics.bloodPressureStatus && metrics.bloodPressure == null) {
    metrics.bloodPressureStatus = rawSyncedText;
  }
  if (hasType(/stress/, /^pressure$/) && !metrics.stressStatus && metrics.stress == null) {
    metrics.stressStatus = rawSyncedText;
  }
  if (hasType(/blood[_-]?sugar|glucose/) && !metrics.bloodSugarStatus && metrics.bloodSugar == null) metrics.bloodSugarStatus = rawSyncedText;
  if (hasType(/temperature/) && !metrics.temperatureStatus && metrics.temperature == null) metrics.temperatureStatus = rawSyncedText;
};

const getHealthStatusText = (
  itemMetrics: Record<string, any>,
  sourceType: string,
  kind: RwBusinessMetricName
) => {
  if (sourceType === 'rw_health_data' && isRwRealtimeHealthDataPacket(itemMetrics, kind)) {
    const returnedValue =
      kind === 'blood_pressure'
        ? normalizeBloodPressureMetric(itemMetrics.value, itemMetrics.data)
        : normalizeRwMetricValue(itemMetrics.value, itemMetrics.data, kind);
    if (returnedValue != null) return RETURNED_DATA_TEXT;
  }
  return getVisibleRwStatusMessage(itemMetrics.message, NO_LIVE_VALUE_TEXT);
};

const getDisplayStatusText = (itemMetrics: Record<string, any>) => {
  if (typeof itemMetrics.statusText === 'string' && itemMetrics.statusText.trim()) return itemMetrics.statusText;
  if (typeof itemMetrics.message === 'string' && itemMetrics.message.trim()) return itemMetrics.message;
  if (typeof itemMetrics.status === 'string' && itemMetrics.status.trim()) return itemMetrics.status;
  return '';
};

const normalizeRwBusinessMetricName = (name: unknown) => {
  const normalized = `${name || ''}`.trim().replace(/-/g, '_');
  const compact = normalized.replace(/[_\s]/g, '').toLowerCase();
  if (compact === 'spo2' || compact === 'bloodoxygen' || compact === 'bloodoxy' || compact === 'oxygen' || compact === 'bo') {
    return 'blood_oxygen';
  }
  if (compact === 'heartrate' || compact === 'heart' || compact === 'hr') return 'heart_rate';
  return normalized;
};

const isInternalRwStatusMessage = (message: unknown) => {
  if (typeof message !== 'string') return false;
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('rw parsed data wait timeout') ||
    normalized.includes('command timeout') ||
    normalized.includes('adapter listener cleared') ||
    normalized.includes('communication not ready') ||
    normalized.includes('file-list failed')
  );
};

const getVisibleRwStatusMessage = (message: unknown, fallback: string) => {
  if (typeof message !== 'string' || !message.trim()) return fallback;
  if (isInternalRwStatusMessage(message)) return fallback;
  return message;
};

const setRwNamedMetric = (target: Record<string, any>, name: unknown, itemMetrics: Record<string, any>) => {
  const originalName = `${name || ''}`;
  if (!originalName) return '';

  target[originalName] = itemMetrics;
  const normalizedName = normalizeRwBusinessMetricName(originalName);
  if (normalizedName && normalizedName !== originalName) {
    target[normalizedName] = {
      ...itemMetrics,
      name: normalizedName,
      originalName
    };
  }

  return normalizedName || originalName;
};

export const buildRingBusinessMetrics = (normalizedData: any[]): RingBusinessMetrics => {
  const metrics = createEmptyRingBusinessMetrics();
  let hasRwSource = false;

  for (const item of normalizedData) {
    const itemMetrics = item?.metrics || {};
    if (isRwHistoryMetricsSource(item, itemMetrics)) {
      hasRwSource = true;
    }

    if (item.sourceType === 'battery') {
      metrics.battery = normalizeBatteryMetric(itemMetrics.battery ?? itemMetrics.value ?? itemMetrics.batteryValue) ?? metrics.battery;
      metrics.batteryStatus = itemMetrics.batteryStatus ?? metrics.batteryStatus;
      metrics.chargingStatus = itemMetrics.chargingStatus ?? metrics.chargingStatus;
      metrics.chargingStatusText = itemMetrics.chargingStatusText ?? metrics.chargingStatusText;
    }

    if (item.sourceType === 'firmware_version') {
      const firmwareValue = itemMetrics.firmwareVersion ?? itemMetrics.hardwareVersion;
      const hardwareValue = itemMetrics.hardwareVersion ?? itemMetrics.firmwareVersion;
      const softwareValue = itemMetrics.softwareVersion ?? itemMetrics.uiVersion ?? firmwareValue ?? hardwareValue;
      const uiValue = itemMetrics.uiVersion ?? itemMetrics.softwareVersion ?? softwareValue;
      metrics.firmwareVersion = firmwareValue ?? metrics.firmwareVersion;
      metrics.hardwareVersion = hardwareValue ?? metrics.hardwareVersion;
      metrics.softwareVersion = softwareValue ?? metrics.softwareVersion;
      metrics.uiVersion = uiValue ?? metrics.uiVersion;
      metrics.screenWidth = itemMetrics.screenWidth ?? metrics.screenWidth;
      metrics.screenHeight = itemMetrics.screenHeight ?? metrics.screenHeight;
    }

    if (item.sourceType === 'hardwareVersion') {
      metrics.hardwareVersion = itemMetrics.hardwareVersion ?? itemMetrics.firmwareVersion ?? itemMetrics.value ?? metrics.hardwareVersion;
      metrics.firmwareVersion = itemMetrics.firmwareVersion ?? itemMetrics.hardwareVersion ?? itemMetrics.value ?? metrics.firmwareVersion;
    }

    if (item.sourceType === 'softwareVersion') {
      metrics.softwareVersion = itemMetrics.softwareVersion ?? itemMetrics.uiVersion ?? itemMetrics.value ?? metrics.softwareVersion;
      metrics.uiVersion = itemMetrics.uiVersion ?? itemMetrics.softwareVersion ?? itemMetrics.value ?? metrics.uiVersion;
    }

    if (item.sourceType === 'collect_period_read') {
      metrics.collectPeriodSeconds = itemMetrics.period ?? metrics.collectPeriodSeconds;
      metrics.collectPeriodMinutes = itemMetrics.minutes ?? metrics.collectPeriodMinutes;
    }

    if (item.sourceType === 'device_time') {
      metrics.deviceTimestamp = itemMetrics.timestamp ?? metrics.deviceTimestamp;
      metrics.timezone = itemMetrics.timezone ?? metrics.timezone;
    }

    if (item.sourceType === 'local_data') {
      const records = Array.isArray(itemMetrics.records) ? itemMetrics.records : null;
      metrics.historyDataType = itemMetrics.dataType ?? metrics.historyDataType;
      const totalFileCount = getFiniteNumber(itemMetrics.totalFileCount);
      const selectedFileCount = getFiniteNumber(itemMetrics.selectedFileCount);
      const isRwLegacyFilteredEmpty =
        itemMetrics.status === 'empty' &&
        totalFileCount != null &&
        totalFileCount > 0 &&
        selectedFileCount === 0;
      const isRwFiltered = itemMetrics.status === 'filtered' || isRwLegacyFilteredEmpty;
      metrics.historyStatus = isRwFiltered
        ? 'filtered'
        : itemMetrics.status || (records && records.length > 0 ? 'success' : metrics.historyStatus);
      metrics.historyMessage = isRwFiltered
        ? HISTORY_FILTERED_TEXT
        : records
          ? itemMetrics.message || `\u5df2\u540c\u6b65${records.length}\u6761`
          : metrics.historyMessage;
      const preservedLiveVitals = isRwHistoryMetricsSource(item, itemMetrics) ? captureLiveVitals(metrics) : null;
      const latestHealthRecord = getLatestRecord(itemMetrics.records);
      if (latestHealthRecord) {
        applyHealthRecordMetrics(metrics, latestHealthRecord);
      }
      if (Array.isArray(itemMetrics.records)) {
        itemMetrics.records.forEach((record: unknown) => {
          if (record && typeof record === 'object') {
            applyHealthRecordMetrics(metrics, record as Record<string, any>);
          }
        });
      }
      applyHistoryRecordsMetrics(metrics, itemMetrics.records);
      restoreCapturedLiveVitals(metrics, preservedLiveVitals);
    }

    if (item.sourceType === 'rw_file_list') {
      const files = Array.isArray(itemMetrics.files) ? itemMetrics.files : [];
      metrics.historyDataType = itemMetrics.dataType ?? metrics.historyDataType;
      const totalFileCount = getFiniteNumber(itemMetrics.totalFileCount) ?? files.length;
      const selectedFileCount = getFiniteNumber(itemMetrics.selectedFileCount);
      const isRwFilteredFileList = totalFileCount > 0 && selectedFileCount === 0;
      metrics.historyStatus = isRwFilteredFileList ? 'filtered' : files.length > 0 ? 'file_list' : metrics.historyStatus || 'empty';
      metrics.historyMessage = isRwFilteredFileList
        ? HISTORY_FILTERED_TEXT
        : files.length > 0
          ? `RW\u53d1\u73b0${files.length}\u4e2a\u5386\u53f2\u6587\u4ef6`
          : metrics.historyMessage || 'RW\u6682\u65e0\u5386\u53f2\u6587\u4ef6';
    }

    if (item.sourceType === 'rw_upload_request') {
      metrics.historyStatus = itemMetrics.status || metrics.historyStatus || 'requested';
      metrics.historyMessage =
        itemMetrics.status === 'ready'
          ? 'RW\u5386\u53f2\u6587\u4ef6\u51c6\u5907\u4e0a\u4f20'
          : itemMetrics.status === 'completed'
            ? 'RW\u5386\u53f2\u4e0a\u4f20\u5b8c\u6210'
            : metrics.historyMessage || 'RW\u5386\u53f2\u4e0a\u4f20\u8bf7\u6c42\u5df2\u53d1\u9001';
    }

    if (item.sourceType === 'rw_upload_progress' || item.sourceType === 'rw_last_package_progress') {
      metrics.historyStatus = item.sourceType === 'rw_last_package_progress' ? 'last_package' : 'uploading';
      metrics.historyMessage =
        itemMetrics.progress != null
          ? `RW\u5386\u53f2\u4e0a\u4f20\u8fdb\u5ea6${itemMetrics.progress}%`
          : itemMetrics.seq != null
            ? `RW\u5386\u53f2\u4e0a\u4f20\u5305${itemMetrics.seq}`
            : metrics.historyMessage || 'RW\u5386\u53f2\u4e0a\u4f20\u4e2d';
    }

    if (item.sourceType === 'rw_upload_file') {
      const records = Array.isArray(itemMetrics.records) ? itemMetrics.records : [];
      const preservedLiveVitals = captureLiveVitals(metrics);
      metrics.historyDataType = itemMetrics.dataType ?? metrics.historyDataType;
      metrics.historyStatus = itemMetrics.status || 'uploaded';
      metrics.historyMessage =
        itemMetrics.fileName
          ? `RW\u5386\u53f2\u6587\u4ef6${itemMetrics.fileName}${records.length > 0 ? `\uff0c${records.length}\u6761\u539f\u59cb\u8bb0\u5f55` : ''}`
          : records.length > 0
            ? `RW\u5386\u53f2\u6587\u4ef6\u5df2\u4e0a\u4f20\uff0c${records.length}\u6761\u539f\u59cb\u8bb0\u5f55`
            : metrics.historyMessage || 'RW\u5386\u53f2\u6587\u4ef6\u5df2\u4e0a\u4f20';
      records.forEach((record: unknown) => {
        if (record && typeof record === 'object') {
          applyHealthRecordMetrics(metrics, record as Record<string, any>);
        }
      });
      applyHistoryRecordsMetrics(metrics, records);
      restoreCapturedLiveVitals(metrics, preservedLiveVitals);
    }
    if (item.sourceType === 'active_measure') {
      const statusText = getDisplayStatusText(itemMetrics);
      metrics.heartRate = normalizeHeartRateMetric(itemMetrics.heartRate ?? itemMetrics.heart_rate ?? itemMetrics.hr) ?? metrics.heartRate;
      metrics.hrv =
        normalizeHrvMetric(itemMetrics.hrv ?? itemMetrics.heartRateVariability ?? itemMetrics.heart_rate_variability) ??
        metrics.hrv;
      const temperature = normalizeTemperatureMetric(getTemperatureMetricValue(itemMetrics));
      metrics.temperature = temperature ?? metrics.temperature;
      if (hasTemperatureMetricValue(itemMetrics) && temperature == null) {
        metrics.temperatureStatus = NO_TEMPERATURE_TEXT;
      }
      metrics.stress =
        normalizeStressMetric(itemMetrics.stress ?? itemMetrics.stressIndex ?? itemMetrics.stress_index ?? itemMetrics.pressure) ??
        metrics.stress;
      metrics.heartRateStatus = statusText || metrics.heartRateStatus;
      metrics.hrvStatus = statusText || metrics.hrvStatus;
      metrics.stressStatus = statusText || metrics.stressStatus;
      metrics.fatigue = itemMetrics.fatigue ?? metrics.fatigue;
      metrics.fatigueLevel = itemMetrics.fatigueLevel ?? metrics.fatigueLevel;
      metrics.anxiety = itemMetrics.anxiety ?? metrics.anxiety;
      metrics.anxietyLevel = itemMetrics.anxietyLevel ?? metrics.anxietyLevel;
      metrics.alarmText = itemMetrics.alarmText ?? metrics.alarmText;
    }

    if (item.sourceType === 'active_OxyGenMeasure') {
      const statusText = getDisplayStatusText(itemMetrics);
      metrics.heartRate = normalizeHeartRateMetric(itemMetrics.heartRate ?? itemMetrics.heart_rate ?? itemMetrics.hr) ?? metrics.heartRate;
      metrics.bloodOxygen =
        normalizeBloodOxygenMetric(
          itemMetrics.bloodOxygen ?? itemMetrics.blood_oxygen ?? itemMetrics.bloodOxygenSaturation ?? itemMetrics.spo2 ?? itemMetrics.oxygen
        ) ?? metrics.bloodOxygen;
      const temperature = normalizeTemperatureMetric(getTemperatureMetricValue(itemMetrics));
      metrics.temperature = temperature ?? metrics.temperature;
      if (hasTemperatureMetricValue(itemMetrics) && temperature == null) {
        metrics.temperatureStatus = NO_TEMPERATURE_TEXT;
      }
      if (itemMetrics.heartRate != null) metrics.heartRateStatus = statusText || metrics.heartRateStatus;
      metrics.bloodOxygenStatus = statusText || metrics.bloodOxygenStatus;
      metrics.fatigue = itemMetrics.fatigue ?? metrics.fatigue;
      metrics.fatigueLevel = itemMetrics.fatigueLevel ?? metrics.fatigueLevel;
      metrics.anxiety = itemMetrics.anxiety ?? metrics.anxiety;
      metrics.anxietyLevel = itemMetrics.anxietyLevel ?? metrics.anxietyLevel;
      metrics.alarmText = itemMetrics.alarmText ?? metrics.alarmText;
    }

    if (item.sourceType === 'active_Temperature') {
      const statusText = getDisplayStatusText(itemMetrics);
      const temperature = normalizeTemperatureMetric(getTemperatureMetricValue(itemMetrics));
      metrics.temperature = temperature ?? metrics.temperature;
      metrics.temperatureStatus = statusText || metrics.temperatureStatus;
      if (hasTemperatureMetricValue(itemMetrics) && temperature == null) {
        metrics.temperatureStatus = NO_TEMPERATURE_TEXT;
      }
    }

    if (item.sourceType === 'rw_health_monitoring' && itemMetrics.name) {
      const metricName = setRwNamedMetric(metrics.monitoring, itemMetrics.name, itemMetrics);
      const intervalMinutes = getFiniteNumber(itemMetrics.minutes) ?? getFiniteNumber(itemMetrics.interval);
      const periodSeconds = getFiniteNumber(itemMetrics.period) ?? (intervalMinutes == null ? null : intervalMinutes * 60);
      metrics.collectPeriodSeconds = periodSeconds ?? metrics.collectPeriodSeconds;
      metrics.collectPeriodMinutes = intervalMinutes ?? metrics.collectPeriodMinutes;
      if (metricName === 'blood_oxygen') metrics.bloodOxygenStatus = MONITORING_READ_TEXT;
      if (metricName === 'hrv') metrics.hrvStatus = MONITORING_READ_TEXT;
      if (metricName === 'stress') metrics.stressStatus = MONITORING_READ_TEXT;
      if (metricName === 'blood_sugar') metrics.bloodSugarStatus = MONITORING_READ_TEXT;
      if (metricName === 'blood_pressure') metrics.bloodPressureStatus = MONITORING_READ_TEXT;
      if (metricName === 'temperature' && !metrics.temperatureStatus) metrics.temperatureStatus = MONITORING_READ_TEXT;
    }

    if (item.sourceType === 'rw_health_monitoring_ack' && itemMetrics.name) {
      setRwNamedMetric(metrics.monitoring, itemMetrics.name, itemMetrics);
      metrics.monitoringStatus = itemMetrics.success === false ? MONITORING_FAILED_TEXT : MONITORING_OK_TEXT;
    }

    if (
      (item.sourceType === 'rw_health_data' ||
        item.sourceType === 'rw_health_data_ack' ||
        item.sourceType === 'rw_health_data_control_ack' ||
        item.sourceType === 'rw_health_data_pending') &&
      itemMetrics.name
    ) {
      const metricName = setRwNamedMetric(metrics.healthData, itemMetrics.name, itemMetrics);

      if (metricName === 'heart_rate') {
        metrics.heartRateStatus = getHealthStatusText(itemMetrics, item.sourceType, 'heart_rate');
      }
      if (metricName === 'blood_oxygen') {
        metrics.bloodOxygenStatus = getHealthStatusText(itemMetrics, item.sourceType, 'blood_oxygen');
      }
      if (metricName === 'temperature') {
        metrics.temperatureStatus = getHealthStatusText(itemMetrics, item.sourceType, 'temperature');
      }
      if (metricName === 'hrv') {
        metrics.hrvStatus = getHealthStatusText(itemMetrics, item.sourceType, 'hrv');
      }
      if (metricName === 'stress') {
        metrics.stressStatus = getHealthStatusText(itemMetrics, item.sourceType, 'stress');
      }
      if (metricName === 'blood_sugar') {
        metrics.bloodSugarStatus = getHealthStatusText(itemMetrics, item.sourceType, 'blood_sugar');
      }
      if (metricName === 'blood_pressure') {
        metrics.bloodPressureStatus = getHealthStatusText(itemMetrics, item.sourceType, 'blood_pressure');
      }
      if (metricName === 'battery' && item.sourceType === 'rw_health_data_pending') {
        metrics.batteryStatus = getVisibleRwStatusMessage(itemMetrics.message, metrics.batteryStatus || NO_LIVE_VALUE_TEXT);
      }
      if (metricName === 'collect_period' && item.sourceType === 'rw_health_data_pending') {
        metrics.monitoringStatus = getVisibleRwStatusMessage(itemMetrics.message, metrics.monitoringStatus || NO_LIVE_VALUE_TEXT);
      }

      if (item.sourceType === 'rw_health_data') {
        if (metricName === 'heart_rate') {
          metrics.heartRate = isRwRealtimeHealthDataPacket(itemMetrics, 'heart_rate')
            ? normalizeRwMetricValue(itemMetrics.value, itemMetrics.data, 'heart_rate') ?? metrics.heartRate
            : metrics.heartRate;
        }
        if (metricName === 'blood_oxygen') {
          metrics.bloodOxygen = isRwRealtimeHealthDataPacket(itemMetrics, 'blood_oxygen')
            ? normalizeRwMetricValue(itemMetrics.value, itemMetrics.data, 'blood_oxygen') ?? metrics.bloodOxygen
            : metrics.bloodOxygen;
        }
        if (metricName === 'temperature') {
          if (isRwRealtimeHealthDataPacket(itemMetrics, 'temperature')) {
            const rawTemperature = normalizeRwMetricValue(itemMetrics.value, itemMetrics.data, 'temperature');
            const temperature = normalizeTemperatureMetric(rawTemperature);
            metrics.temperature = temperature ?? metrics.temperature;
            if (rawTemperature != null && temperature == null) {
              metrics.temperatureStatus = NO_TEMPERATURE_TEXT;
            }
          }
        }
        if (metricName === 'hrv') {
          metrics.hrv = isRwRealtimeHealthDataPacket(itemMetrics, 'hrv')
            ? normalizeRwMetricValue(itemMetrics.value, itemMetrics.data, 'hrv') ?? metrics.hrv
            : metrics.hrv;
        }
        if (metricName === 'stress') {
          metrics.stress = isRwRealtimeHealthDataPacket(itemMetrics, 'stress')
            ? normalizeRwMetricValue(itemMetrics.value, itemMetrics.data, 'stress') ?? metrics.stress
            : metrics.stress;
        }
        if (metricName === 'blood_sugar') {
          metrics.bloodSugar = isRwRealtimeHealthDataPacket(itemMetrics, 'blood_sugar')
            ? normalizeRwMetricValue(itemMetrics.value, itemMetrics.data, 'blood_sugar') ?? metrics.bloodSugar
            : metrics.bloodSugar;
        }
        if (metricName === 'blood_pressure') {
          metrics.bloodPressure = isRwRealtimeHealthDataPacket(itemMetrics, 'blood_pressure')
            ? normalizeBloodPressureMetric(itemMetrics.value, itemMetrics.data) ?? metrics.bloodPressure
            : metrics.bloodPressure;
        }
      }
    }

    if (
      item.sourceType === 'qkeer_v2_health'
    ) {
      metrics.heartRate = normalizeHeartRateMetric(itemMetrics.heartRate) ?? metrics.heartRate;
      metrics.bloodOxygen = normalizeBloodOxygenMetric(itemMetrics.bloodOxygen ?? itemMetrics.spo2) ?? metrics.bloodOxygen;
      const temperature = normalizeTemperatureMetric(itemMetrics.temperature);
      metrics.temperature = temperature ?? metrics.temperature;
      if (itemMetrics.temperature != null && temperature == null) metrics.temperatureStatus = NO_TEMPERATURE_TEXT;
    }

    if (item.sourceType === 'qkeer_v2_health_list') {
      const records = Array.isArray(itemMetrics.records) ? itemMetrics.records : [];
      const preservedLiveVitals = isRwHistoryMetricsSource(item, itemMetrics) ? captureLiveVitals(metrics) : null;
      metrics.historyDataType = itemMetrics.dataType ?? metrics.historyDataType;
      metrics.historyStatus = itemMetrics.status || (records.length > 0 ? 'success' : metrics.historyStatus);
      metrics.historyMessage = records.length > 0
        ? itemMetrics.message || `\u5df2\u540c\u6b65${records.length}\u6761`
        : metrics.historyMessage;
      const latestHealthRecord = getLatestRecord(records);
      if (latestHealthRecord) {
        applyHealthRecordMetrics(metrics, latestHealthRecord);
      }
      records.forEach((record: unknown) => {
        if (record && typeof record === 'object') {
          applyHealthRecordMetrics(metrics, record as Record<string, any>);
        }
      });
      applyHistoryRecordsMetrics(metrics, records);
      restoreCapturedLiveVitals(metrics, preservedLiveVitals);
    }

    if (item.sourceType === 'qkeer_v2_step' || item.sourceType === 'qkeer_v2_last_data' || item.sourceType === 'qkeer_v2_heartbeat') {
      if (item.sourceType === 'qkeer_v2_last_data') {
        metrics.battery = normalizeBatteryMetric(itemMetrics.battery ?? itemMetrics.batteryLevel) ?? metrics.battery;
        metrics.chargingStatus = itemMetrics.chargingStatus ?? metrics.chargingStatus;
        metrics.chargingStatusText = itemMetrics.chargingStatusText ?? metrics.chargingStatusText;
        metrics.heartRate = normalizeHeartRateMetric(getRecordValue(itemMetrics, HEART_RATE_METRIC_ALIASES)) ?? metrics.heartRate;
        metrics.bloodOxygen =
          normalizeBloodOxygenMetric(getRecordValue(itemMetrics, BLOOD_OXYGEN_METRIC_ALIASES)) ?? metrics.bloodOxygen;
        const temperature = normalizeTemperatureMetric(getTemperatureMetricValue(itemMetrics));
        metrics.temperature = temperature ?? metrics.temperature;
        if (hasTemperatureMetricValue(itemMetrics) && temperature == null) metrics.temperatureStatus = NO_TEMPERATURE_TEXT;
        metrics.hrv =
          normalizeHrvMetric(getNumberRecordValue(itemMetrics, HRV_METRIC_ALIASES)) ??
          metrics.hrv;
        metrics.stress =
          normalizeStressMetric(getNumberRecordValue(itemMetrics, STRESS_METRIC_ALIASES)) ??
          metrics.stress;
        metrics.bloodSugar =
          normalizeRwBloodSugarMetric(getRecordValue(itemMetrics, BLOOD_SUGAR_METRIC_ALIASES)) ??
          metrics.bloodSugar;
        metrics.bloodPressure = getBloodPressureValue(itemMetrics) ?? metrics.bloodPressure;
        metrics.sleepStatus = itemMetrics.sleepStatusText ?? metrics.sleepStatus;
        metrics.sleepTotalMinutes = itemMetrics.sleepTotalMinutes ?? metrics.sleepTotalMinutes;
        metrics.sleepDeepMinutes = itemMetrics.sleepDeepMinutes ?? metrics.sleepDeepMinutes;
        metrics.sleepLightMinutes = itemMetrics.sleepLightMinutes ?? metrics.sleepLightMinutes;
        metrics.sleepRemMinutes = itemMetrics.sleepRemMinutes ?? metrics.sleepRemMinutes;
        metrics.sleepAwakeMinutes = itemMetrics.sleepAwakeMinutes ?? metrics.sleepAwakeMinutes;
        metrics.historyDataType = itemMetrics.dataType ?? metrics.historyDataType;
        metrics.historyStatus = itemMetrics.status || metrics.historyStatus;
      }

      metrics.stepCount = itemMetrics.stepCount ?? itemMetrics.step ?? metrics.stepCount;
      metrics.calorie = itemMetrics.calorie ?? itemMetrics.calories ?? itemMetrics.motionCalorie ?? metrics.calorie;
      metrics.activityMinutes = itemMetrics.activityMinutes ?? itemMetrics.motionTime ?? itemMetrics.activeMinutes ?? metrics.activityMinutes;
      metrics.activityLevel = itemMetrics.activityLevel ?? itemMetrics.motionLevel ?? itemMetrics.intensityLevel ?? metrics.activityLevel;
      metrics.distance = itemMetrics.distance ?? itemMetrics.distanceKm ?? itemMetrics.mileage ?? metrics.distance;
      metrics.isWorn = itemMetrics.isWorn ?? metrics.isWorn;
      metrics.fatigue = itemMetrics.fatigue ?? metrics.fatigue;
      metrics.fatigueLevel = itemMetrics.fatigueLevel ?? metrics.fatigueLevel;
      metrics.anxiety = itemMetrics.anxiety ?? metrics.anxiety;
      metrics.anxietyLevel = itemMetrics.anxietyLevel ?? metrics.anxietyLevel;
    }

    if (item.sourceType === 'qkeer_v2_step_list') {
      const records = Array.isArray(itemMetrics.records) ? itemMetrics.records : [];
      const latestStepRecord = getLatestRecord(records);
      if (latestStepRecord) {
        applyHealthRecordMetrics(metrics, latestStepRecord);
      }
      metrics.historyDataType = itemMetrics.dataType ?? metrics.historyDataType;
      metrics.historyStatus = itemMetrics.status || (records.length > 0 ? 'success' : metrics.historyStatus);
      metrics.historyMessage = records.length > 0
        ? itemMetrics.message || `\u5df2\u540c\u6b65${records.length}\u6761`
        : metrics.historyMessage;
    }

    if (
      item.sourceType === 'qkeer_v2_sleep' ||
      item.sourceType === 'qkeer_v2_last_data_sleep' ||
      item.sourceType === 'qkeer_v2_sleep_list'
    ) {
      metrics.sleepStatus = itemMetrics.sleepStatusText ?? metrics.sleepStatus;
      metrics.sleepTotalMinutes = itemMetrics.sleepTotalMinutes ?? metrics.sleepTotalMinutes;
      metrics.sleepDeepMinutes = itemMetrics.sleepDeepMinutes ?? metrics.sleepDeepMinutes;
      metrics.sleepLightMinutes = itemMetrics.sleepLightMinutes ?? metrics.sleepLightMinutes;
      metrics.sleepRemMinutes = itemMetrics.sleepRemMinutes ?? metrics.sleepRemMinutes;
      metrics.sleepAwakeMinutes = itemMetrics.sleepAwakeMinutes ?? metrics.sleepAwakeMinutes;

      const records = Array.isArray(itemMetrics.records) ? itemMetrics.records : [];
      if (records.length > 0) {
        const sleepTotals = records.reduce(
          (result: Record<string, number>, record: Record<string, any>) => {
            const minutes = typeof record.durationMinutes === 'number' ? record.durationMinutes : 0;
            result.total += minutes;
            if (record.sleepStatus === 1) result.light += minutes;
            if (record.sleepStatus === 2) result.deep += minutes;
            if (record.sleepStatus === 3) result.awake += minutes;
            if (record.sleepStatus === 4) result.rem += minutes;
            return result;
          },
          { total: 0, deep: 0, light: 0, rem: 0, awake: 0 }
        );

        metrics.sleepTotalMinutes = sleepTotals.total || metrics.sleepTotalMinutes;
        metrics.sleepDeepMinutes = sleepTotals.deep || metrics.sleepDeepMinutes;
        metrics.sleepLightMinutes = sleepTotals.light || metrics.sleepLightMinutes;
        metrics.sleepRemMinutes = sleepTotals.rem || metrics.sleepRemMinutes;
        metrics.sleepAwakeMinutes = sleepTotals.awake || metrics.sleepAwakeMinutes;
      }
      metrics.historyDataType = itemMetrics.dataType ?? metrics.historyDataType;
      metrics.historyStatus = itemMetrics.status || (records.length > 0 ? 'success' : metrics.historyStatus);
      metrics.historyMessage = records.length > 0
        ? itemMetrics.message || `\u5df2\u540c\u6b65${records.length}\u6761`
        : metrics.historyMessage;
    }

    if (item.sourceType === 'rw_history_pending') {
      metrics.historyStatus = itemMetrics.status || 'pending';
      metrics.historyMessage = itemMetrics.message || '';
    }
  }

  if (hasRwSource) {
    applyRwFallbackTemperature(metrics);
  }

  return metrics;
};

const hasMetricValue = (value: unknown) => {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0 && value.trim() !== '-';
  return true;
};

const preferMetricValue = <T>(current: T, previous: T): T => {
  return hasMetricValue(current) ? current : previous;
};

const isPendingMetricStatusText = (value: unknown) => {
  if (typeof value !== 'string') return false;
  const status = value.trim().toLowerCase();
  return Boolean(status && (/pending|requested|wait/.test(status) || /待|等待|未返回|已请求/.test(status)));
};

const preferLiveMetricStatus = <T>(
  currentStatus: T,
  previousStatus: T,
  currentValue: unknown,
  previousValue: unknown
): T => {
  if (!hasMetricValue(currentValue) && hasMetricValue(previousValue) && isPendingMetricStatusText(currentStatus)) {
    return previousStatus;
  }
  return preferMetricValue(currentStatus, previousStatus);
};

const preferTimestampMetric = (current: number, previous: number | undefined) => {
  return current > 0 ? current : previous ?? current;
};

const mergeMetricRecords = (
  current: Record<string, any>,
  previous: Record<string, any> | undefined
) => {
  return {
    ...(previous || {}),
    ...(current || {})
  };
};

const preferTemperatureMetricValue = (
  current: RingBusinessMetrics['temperature'],
  previous: RingBusinessMetrics['temperature'] | undefined
): RingBusinessMetrics['temperature'] => {
  const currentTemperature = normalizeTemperatureMetric(current);
  if (currentTemperature) return currentTemperature;
  return normalizeTemperatureMetric(previous) ?? null;
};

export const mergeRingBusinessMetricSnapshot = (
  current: RingBusinessMetrics,
  previous: Partial<RingBusinessMetrics>
): RingBusinessMetrics => {
  return {
    ...current,
    battery: preferMetricValue(current.battery, previous.battery ?? current.battery),
    batteryStatus: preferMetricValue(current.batteryStatus, previous.batteryStatus ?? current.batteryStatus),
    chargingStatus: preferMetricValue(current.chargingStatus, previous.chargingStatus ?? current.chargingStatus),
    chargingStatusText: preferMetricValue(current.chargingStatusText, previous.chargingStatusText ?? current.chargingStatusText),
    firmwareVersion: preferMetricValue(current.firmwareVersion, previous.firmwareVersion ?? current.firmwareVersion),
    hardwareVersion: preferMetricValue(current.hardwareVersion, previous.hardwareVersion ?? current.hardwareVersion),
    softwareVersion: preferMetricValue(current.softwareVersion, previous.softwareVersion ?? current.softwareVersion),
    uiVersion: preferMetricValue(current.uiVersion, previous.uiVersion ?? current.uiVersion),
    screenWidth: preferMetricValue(current.screenWidth, previous.screenWidth ?? current.screenWidth),
    screenHeight: preferMetricValue(current.screenHeight, previous.screenHeight ?? current.screenHeight),
    deviceTimestamp: preferTimestampMetric(current.deviceTimestamp, previous.deviceTimestamp),
    timezone: preferMetricValue(current.timezone, previous.timezone ?? current.timezone),
    heartRate: preferMetricValue(current.heartRate, previous.heartRate ?? current.heartRate),
    heartRateStatus: preferLiveMetricStatus(
      current.heartRateStatus,
      previous.heartRateStatus ?? current.heartRateStatus,
      current.heartRate,
      previous.heartRate
    ),
    bloodOxygen: preferMetricValue(current.bloodOxygen, previous.bloodOxygen ?? current.bloodOxygen),
    bloodOxygenStatus: preferLiveMetricStatus(
      current.bloodOxygenStatus,
      previous.bloodOxygenStatus ?? current.bloodOxygenStatus,
      current.bloodOxygen,
      previous.bloodOxygen
    ),
    temperature: preferTemperatureMetricValue(current.temperature, previous.temperature),
    temperatureStatus: preferLiveMetricStatus(
      current.temperatureStatus,
      previous.temperatureStatus ?? current.temperatureStatus,
      current.temperature,
      previous.temperature
    ),
    hrv: preferMetricValue(current.hrv, previous.hrv ?? current.hrv),
    hrvStatus: preferLiveMetricStatus(
      current.hrvStatus,
      previous.hrvStatus ?? current.hrvStatus,
      current.hrv,
      previous.hrv
    ),
    stress: preferMetricValue(current.stress, previous.stress ?? current.stress),
    stressStatus: preferLiveMetricStatus(
      current.stressStatus,
      previous.stressStatus ?? current.stressStatus,
      current.stress,
      previous.stress
    ),
    bloodSugar: preferMetricValue(current.bloodSugar, previous.bloodSugar ?? current.bloodSugar),
    bloodSugarStatus: preferLiveMetricStatus(
      current.bloodSugarStatus,
      previous.bloodSugarStatus ?? current.bloodSugarStatus,
      current.bloodSugar,
      previous.bloodSugar
    ),
    bloodPressure: preferMetricValue(current.bloodPressure, previous.bloodPressure ?? current.bloodPressure),
    bloodPressureStatus: preferLiveMetricStatus(
      current.bloodPressureStatus,
      previous.bloodPressureStatus ?? current.bloodPressureStatus,
      current.bloodPressure,
      previous.bloodPressure
    ),
    stepCount: preferMetricValue(current.stepCount, previous.stepCount ?? current.stepCount),
    calorie: preferMetricValue(current.calorie, previous.calorie ?? current.calorie),
    activityMinutes: preferMetricValue(current.activityMinutes, previous.activityMinutes ?? current.activityMinutes),
    activityLevel: preferMetricValue(current.activityLevel, previous.activityLevel ?? current.activityLevel),
    distance: preferMetricValue(current.distance, previous.distance ?? current.distance),
    isWorn: preferMetricValue(current.isWorn, previous.isWorn ?? current.isWorn),
    sleepTotalMinutes: preferMetricValue(current.sleepTotalMinutes, previous.sleepTotalMinutes ?? current.sleepTotalMinutes),
    sleepDeepMinutes: preferMetricValue(current.sleepDeepMinutes, previous.sleepDeepMinutes ?? current.sleepDeepMinutes),
    sleepLightMinutes: preferMetricValue(current.sleepLightMinutes, previous.sleepLightMinutes ?? current.sleepLightMinutes),
    sleepRemMinutes: preferMetricValue(current.sleepRemMinutes, previous.sleepRemMinutes ?? current.sleepRemMinutes),
    sleepAwakeMinutes: preferMetricValue(current.sleepAwakeMinutes, previous.sleepAwakeMinutes ?? current.sleepAwakeMinutes),
    sleepStatus: preferMetricValue(current.sleepStatus, previous.sleepStatus ?? current.sleepStatus),
    fatigue: preferMetricValue(current.fatigue, previous.fatigue ?? current.fatigue),
    fatigueLevel: preferMetricValue(current.fatigueLevel, previous.fatigueLevel ?? current.fatigueLevel),
    anxiety: preferMetricValue(current.anxiety, previous.anxiety ?? current.anxiety),
    anxietyLevel: preferMetricValue(current.anxietyLevel, previous.anxietyLevel ?? current.anxietyLevel),
    alarmText: preferMetricValue(current.alarmText, previous.alarmText ?? current.alarmText),
    historyStatus: preferMetricValue(current.historyStatus, previous.historyStatus ?? current.historyStatus),
    historyMessage: preferMetricValue(current.historyMessage, previous.historyMessage ?? current.historyMessage),
    historyDataType: preferMetricValue(current.historyDataType, previous.historyDataType ?? current.historyDataType),
    collectPeriodSeconds: preferMetricValue(current.collectPeriodSeconds, previous.collectPeriodSeconds ?? current.collectPeriodSeconds),
    collectPeriodMinutes: preferMetricValue(current.collectPeriodMinutes, previous.collectPeriodMinutes ?? current.collectPeriodMinutes),
    monitoringStatus: preferMetricValue(current.monitoringStatus, previous.monitoringStatus ?? current.monitoringStatus),
    monitoring: mergeMetricRecords(current.monitoring, previous.monitoring),
    healthData: mergeMetricRecords(current.healthData, previous.healthData)
  };
};
