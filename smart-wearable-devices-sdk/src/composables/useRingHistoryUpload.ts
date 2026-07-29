type RingHistoryRecord = Record<string, any>;
export type RingHistorySubmitRecord = RingHistoryRecord & { recordTime: string };

export interface RingHistorySyncResultLike {
  records?: RingHistoryRecord[];
}

export interface SubmitRingHistorySyncResultOptions {
  deviceMac: string;
  submit: (payload: { deviceMac: string; dataList: RingHistorySubmitRecord[] }) => Promise<unknown>;
  sinceTimestamp?: number;
}

export interface SubmitRingHistorySyncResultResult {
  submitted: boolean;
  count: number;
  maxTimestamp: number;
  maxVisibleTimestamp: number;
  rawCount: number;
  filteredOutCount: number;
  futureFilteredOutCount: number;
  rawMetricCounts: Record<string, number>;
  submitMetricCounts: Record<string, number>;
  sampleFilteredRecords: RingHistoryRecord[];
  sampleFutureFilteredRecords: RingHistoryRecord[];
  sampleSubmittedRecords: RingHistorySubmitRecord[];
  submitResponse?: unknown;
}

const HISTORY_FUTURE_TOLERANCE_SECONDS = 10 * 60;
const RW_FALLBACK_TEMPERATURE_CELSIUS = 36.6;
const RING_HISTORY_SUBMIT_DEDUPE_FIELDS = [
  'recordTime',
  'stepCount',
  'rawStepCount',
  'cumulativeStepCount',
  'stepCountSource',
  'heartRate',
  'hrv',
  'spo2',
  'stress',
  'bloodSugar',
  'systolic',
  'diastolic',
  'temperature',
  'sleepState',
  'sleepDuration',
  'startTime',
  'endTime',
  'dateRef',
  'motionIntensity',
  'perfusionIndex',
  'rrIntervals'
];

const HISTORY_SOURCE_TYPES = new Set([
  'local_data',
  'qkeer_v2_health_list',
  'qkeer_v2_last_data',
  'qkeer_v2_step_list',
  'qkeer_v2_sleep_list',
  'rw_upload_file',
  'rw_file_list'
]);

const getNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (value == null || value === '') continue;
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
};

const getRecordValue = (record: RingHistoryRecord, aliases: string[]) => {
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

const getRecordNumber = (record: RingHistoryRecord, aliases: string[]) => getNumber(...aliases.map((alias) => getRecordValue(record, [alias])));

const STATUS_ONLY_BYTES = new Set([0x11, 0x31]);
const HEART_RATE_ALIASES = ['heartRate', 'heart_rate', 'heartrate', 'hr', 'heartRateValue', 'heart_rate_value'];
const HRV_ALIASES = [
  'hrv',
  'hrvValue',
  'hrv_value',
  'heartRateVariability',
  'heart_rate_variability',
  'heartRateVariabilityValue',
  'heart_rate_variability_value',
  'rmssd'
];
const BLOOD_OXYGEN_ALIASES = [
  'spo2',
  'spO2',
  'SPO2',
  'bloodOxygen',
  'blood_oxygen',
  'bloodOxygenSaturation',
  'blood_oxygen_saturation',
  'bloodOxy',
  'oxygen',
  'oxygenSaturation',
  'oxygen_saturation',
  'bo'
];
const STRESS_ALIASES = [
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
const TEMPERATURE_ALIASES = [
  'temperature',
  'temperatureValue',
  'temperature_value',
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
const BLOOD_SUGAR_ALIASES = ['bloodSugar', 'blood_sugar', 'bloodSugarValue', 'blood_sugar_value', 'glucose', 'sugar'];
const SYSTOLIC_ALIASES = [
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
const DIASTOLIC_ALIASES = [
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
const L19_SLEEP_STATE_ALIASES = ['sleepState', 'sleep_state', 'sleepStage', 'sleep_stage', 'state', 'stage'];
const RW_SLEEP_STATUS_ALIASES = ['sleepStatus', 'sleep_status', 'status'];
const SLEEP_TYPE_ALIASES = ['sleepType', 'sleep_type'];
const L19_SLEEP_STATE_TEXT: Record<string, number> = {
  awake: 1,
  wake: 1,
  waking: 1,
  rem: 2,
  light: 3,
  lightsleep: 3,
  deep: 4,
  deepsleep: 4,
  nap: 5,
  清醒: 1,
  醒: 1,
  快速眼动: 2,
  眼动: 2,
  浅睡: 3,
  浅睡眠: 3,
  深睡: 4,
  深睡眠: 4,
  小睡: 5,
  午睡: 5
};

const normalizeBloodSugarNumber = (value: unknown) => {
  const numeric = getNumber(value);
  if (numeric == null || numeric <= 0 || STATUS_ONLY_BYTES.has(numeric)) return undefined;
  return numeric > 30 && numeric <= 300 ? Number((numeric / 10).toFixed(1)) : numeric;
};

const normalizeBloodOxygenNumber = (value: unknown) => {
  const numeric = getNumber(value);
  if (numeric == null || numeric < 70 || numeric > 100) return undefined;
  return numeric;
};

const normalizeHeartRateNumber = (value: unknown) => {
  const numeric = getNumber(value);
  if (numeric == null || numeric < 25 || numeric > 240) return undefined;
  return numeric;
};

const normalizeHrvNumber = (value: unknown) => {
  const numeric = getNumber(value);
  if (numeric == null || numeric <= 0 || numeric > 300 || STATUS_ONLY_BYTES.has(numeric)) return undefined;
  return numeric;
};

const normalizeStressNumber = (value: unknown) => {
  const numeric = getNumber(value);
  if (numeric == null || numeric < 0 || numeric > 100 || STATUS_ONLY_BYTES.has(numeric)) return undefined;
  return numeric;
};

const normalizeStepCountNumber = (value: unknown) => {
  const numeric = getNumber(value);
  if (numeric == null || numeric <= 0 || numeric > 300000 || STATUS_ONLY_BYTES.has(numeric)) return undefined;
  return Math.floor(numeric);
};

const normalizeTemperatureNumber = (value: unknown) => {
  const numeric = getNumber(value);
  if (numeric == null || STATUS_ONLY_BYTES.has(numeric)) return undefined;
  const celsius =
    numeric >= 3000 && numeric <= 4500
      ? numeric / 100
      : numeric >= 250 && numeric <= 450
        ? numeric / 10
        : numeric;
  if (celsius < 25 || celsius > 45) return undefined;
  return Number(celsius.toFixed(2));
};

const normalizeBloodPressurePart = (value: unknown, min: number, max: number) => {
  const numeric = getNumber(value);
  if (numeric == null || numeric < min || numeric > max || STATUS_ONLY_BYTES.has(numeric)) return undefined;
  return numeric;
};

const normalizeBloodPressureParts = (parts: { systolic?: unknown; diastolic?: unknown }) => {
  const systolic = normalizeBloodPressurePart(parts.systolic, 50, 260);
  const diastolic = normalizeBloodPressurePart(parts.diastolic, 30, 180);
  if (systolic == null || diastolic == null) return {};
  return { systolic, diastolic };
};

const normalizeL19SleepStateValue = (value: unknown) => {
  if (value == null || value === '') return undefined;
  const numeric = getNumber(value);
  if (numeric != null && numeric >= 1 && numeric <= 5) return numeric;
  const text = String(value).trim().toLowerCase().replace(/[\s_-]/g, '');
  return L19_SLEEP_STATE_TEXT[text];
};

const normalizeRwSleepStatusToL19State = (value: unknown) => {
  if (value == null || value === '') return undefined;
  const numeric = getNumber(value);
  if (numeric === 1) return 3;
  if (numeric === 2) return 4;
  if (numeric === 3) return 1;
  if (numeric === 4) return 2;
  const text = String(value).trim().toLowerCase().replace(/[\s_-]/g, '');
  return L19_SLEEP_STATE_TEXT[text];
};

const getSleepStateValue = (record: RingHistoryRecord) => {
  const explicitState = normalizeL19SleepStateValue(getRecordValue(record, L19_SLEEP_STATE_ALIASES));
  if (explicitState != null) return explicitState;

  const rwStatus = normalizeRwSleepStatusToL19State(getRecordValue(record, RW_SLEEP_STATUS_ALIASES));
  if (rwStatus != null) return rwStatus;

  const typedSleepValue = isTypedHistoryRecord(record, [/sleep/]) ? getRecordValue(record, ['value', 'val']) : undefined;
  return normalizeL19SleepStateValue(getRecordValue(record, SLEEP_TYPE_ALIASES) ?? typedSleepValue);
};

const getRecordTypeText = (record: RingHistoryRecord) =>
  `${getRecordValue(record, ['dataType']) || ''}_${getRecordValue(record, ['rawDataType']) || ''}_${
    getRecordValue(record, ['fileType']) || ''
  }_${getRecordValue(record, ['fileName']) || ''}`.toLowerCase();

const isTypedHistoryRecord = (record: RingHistoryRecord, patterns: RegExp[]) => {
  const typeText = getRecordTypeText(record);
  return Boolean(typeText && patterns.some((pattern) => pattern.test(typeText)));
};

const getTypedHistoryNumber = (record: RingHistoryRecord, patterns: RegExp[]) => {
  if (!isTypedHistoryRecord(record, patterns)) return undefined;
  return getRecordNumber(record, ['value', 'val', 'measurement', 'measureValue', 'avg', 'average']);
};

const UNSAFE_STEP_SOURCE_TYPES = new Set([
  'ab_activity_current_day_summary',
  'ab_activity_current_day_hour',
  'ab_activity_current_day_jl2_hour',
  'ab_activity_current_day_relative_hour',
  'last_data',
  'qkeer_v2_last_data'
]);

const RW_CURRENT_DAY_CUMULATIVE_STEP_SOURCE_TYPES = new Set([
  'ab_activity_current_day_relative_hour'
]);

const getLowerRecordText = (record: RingHistoryRecord, aliases: string[]) =>
  String(getRecordValue(record, aliases) || '').trim().toLowerCase();

const isRwHistoryRecord = (record: RingHistoryRecord) => {
  const protocol = getLowerRecordText(record, ['protocol', 'deviceProtocol', 'device_protocol']);
  if (protocol === 'rw') return true;
  const sourceType = getLowerRecordText(record, ['sourceType', 'source_type', 'type']);
  return sourceType === 'rw' || sourceType.startsWith('rw_');
};

const getRwFallbackTemperature = (record: RingHistoryRecord, value: unknown) =>
  isRwHistoryRecord(record) && normalizeTemperatureNumber(value) == null ? RW_FALLBACK_TEMPERATURE_CELSIUS : undefined;

const getRwCurrentDayCumulativeStepCountValue = (record: RingHistoryRecord) => {
  const rawDataType = getLowerRecordText(record, ['rawDataType']);
  if (!RW_CURRENT_DAY_CUMULATIVE_STEP_SOURCE_TYPES.has(rawDataType)) return undefined;
  return normalizeStepCountNumber(getRecordNumber(record, ['stepCount', 'step_count', 'step', 'steps', 'totalSteps']));
};

const isUnsafeHistoryStepSource = (record: RingHistoryRecord) => {
  const rawDataType = getLowerRecordText(record, ['rawDataType']);
  const dataType = getLowerRecordText(record, ['dataType']);
  const sourceType = getLowerRecordText(record, ['sourceType', 'type']);
  return dataType === 'summary' || UNSAFE_STEP_SOURCE_TYPES.has(rawDataType) || UNSAFE_STEP_SOURCE_TYPES.has(sourceType);
};

const getHistoryStepCountValue = (record: RingHistoryRecord) => {
  if (isUnsafeHistoryStepSource(record)) return undefined;
  return (
    normalizeStepCountNumber(getRecordNumber(record, ['stepCount', 'step_count', 'step', 'steps', 'totalSteps'])) ??
    normalizeStepCountNumber(getTypedHistoryNumber(record, [/step|sport|activity/]))
  );
};

const getBloodPressureValueParts = (value: unknown) => {
  if (Array.isArray(value)) {
    return normalizeBloodPressureParts({
      systolic: getNumber(value[0]),
      diastolic: getNumber(value[1])
    });
  }
  if (value && typeof value === 'object') {
    const item = value as Record<string, any>;
    return normalizeBloodPressureParts({
      systolic: getRecordNumber(item, SYSTOLIC_ALIASES),
      diastolic: getRecordNumber(item, DIASTOLIC_ALIASES)
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
  return {};
};

const getBloodPressureParts = (record: RingHistoryRecord) => {
  const direct = getBloodPressureValueParts(
    getRecordValue(record, ['bloodPressure', 'blood_pressure', 'bloodPressureValue', 'blood_pressure_value', 'bp', 'bpValue', 'bp_value'])
  );
  if (direct.systolic != null || direct.diastolic != null) return direct;
  if (!isTypedHistoryRecord(record, [/blood[_-]?pressure/, /(^|[_\-.])bp($|[_\-.])/])) return {};
  return getBloodPressureValueParts(
    getRecordValue(record, ['value', 'val', 'measurement', 'measureValue', 'data']) ?? record.metrics?.data
  );
};

const getTypedSleepState = (record: RingHistoryRecord) => {
  if (!isTypedHistoryRecord(record, [/sleep/])) return undefined;
  const value = getRecordValue(record, [
    'value',
    'val',
    'sleepState',
    'sleep_state',
    'sleepStatus',
    'sleep_status',
    'sleepStage',
    'sleep_stage',
    'sleepType',
    'sleep_type',
    'state',
    'stage',
    'status'
  ]);
  if (value == null || value === '') return undefined;
  return value;
};

export const countRingHistoryRecordMetrics = (records: Array<Record<string, any>> = []) => {
  const counters: Record<string, number> = {
    stepCount: 0,
    heartRate: 0,
    hrv: 0,
    spo2: 0,
    stress: 0,
    temperature: 0,
    bloodSugar: 0,
    bloodPressure: 0,
    sleep: 0
  };

  records.forEach((record) => {
    const typeText = getRecordTypeText(record);
    const typedValue = getTypedHistoryNumber(record, [/heart[_-]?rate|(^|[_\-.])hr($|[_\-.])/, /hrv/, /blood[_-]?oxygen|spo2|oxygen/, /stress|fatigue/, /temperature|temp/, /step|sport|activity/]);
    if (
      getHistoryStepCountValue(record) != null ||
      getRwCurrentDayCumulativeStepCountValue(record) != null ||
      normalizeStepCountNumber(getRecordNumber(record, ['rawStepCount', 'raw_step_count', 'cumulativeStepCount', 'cumulative_step_count'])) != null
    ) {
      counters.stepCount += 1;
    }
    if (normalizeHeartRateNumber(getRecordValue(record, HEART_RATE_ALIASES)) != null || (/heart[_-]?rate|(^|[_\-.])hr($|[_\-.])/.test(typeText) && typedValue != null)) {
      counters.heartRate += 1;
    }
    if (normalizeHrvNumber(getRecordValue(record, HRV_ALIASES)) != null || (/hrv|rmssd/.test(typeText) && typedValue != null)) {
      counters.hrv += 1;
    }
    if (
      normalizeBloodOxygenNumber(getRecordValue(record, BLOOD_OXYGEN_ALIASES)) != null ||
      (/blood[_-]?oxygen|spo2|oxygen/.test(typeText) && typedValue != null)
    ) {
      counters.spo2 += 1;
    }
    if (normalizeStressNumber(getRecordValue(record, STRESS_ALIASES)) != null || (/stress|fatigue|(^|[_\-.])pressure($|[_\-.])/.test(typeText) && typedValue != null)) {
      counters.stress += 1;
    }
    if (
      normalizeTemperatureNumber(getRecordValue(record, TEMPERATURE_ALIASES)) != null ||
      (/temperature|temp|body[_-]?temp|skin[_-]?temp/.test(typeText) && typedValue != null)
    ) {
      counters.temperature += 1;
    }
    if (normalizeBloodSugarNumber(getRecordValue(record, BLOOD_SUGAR_ALIASES)) != null) counters.bloodSugar += 1;
    const bloodPressure = getBloodPressureParts(record);
    if (
      normalizeBloodPressurePart(getRecordValue(record, SYSTOLIC_ALIASES), 50, 260) != null ||
      bloodPressure.systolic != null ||
      bloodPressure.diastolic != null
    ) {
      counters.bloodPressure += 1;
    }
    if (getSleepStateValue(record) != null || getSleepDurationMinutes(record) != null) {
      counters.sleep += 1;
    }
  });

  return Object.fromEntries(Object.entries(counters).filter(([, value]) => value > 0));
};

const isRingHistoryRecordAfterMaxVisible = (record: RingHistoryRecord, maxVisibleTimestamp: number) => {
  const unixTime = getRingHistoryRecordSyncUnixTime(record);
  return Boolean(unixTime && unixTime > maxVisibleTimestamp);
};

const normalizeSleepDurationMinutes = (value: unknown) => {
  const numeric = getNumber(value);
  if (numeric == null || numeric <= 0 || numeric > 24 * 60) return undefined;
  return Math.floor(numeric);
};

const getSleepDurationMinutes = (record: RingHistoryRecord) =>
  normalizeSleepDurationMinutes(getRecordNumber(record, [
    'sleepDuration',
    'sleep_duration',
    'sleepDurationMinutes',
    'sleep_duration_minutes',
    'durationMinutes',
    'duration_minutes',
    'sleepMinutes',
    'sleep_minutes',
    'totalSleepTime',
    'total_sleep_time',
    'totalSleepMinutes',
    'total_sleep_minutes',
    'totalMinutes',
    'total_minutes',
    'minutes',
    'duration',
    'sleepLen',
    'sleep_len',
    'len'
  ]));

const normalizeUnixTimestamp = (value: number | undefined) => {
  if (!value || value <= 0) return undefined;
  return value > 100000000000 ? Math.floor(value / 1000) : Math.floor(value);
};

const getRingHistoryRecordStartUnixTime = (record: RingHistoryRecord) =>
  normalizeUnixTimestamp(
    getRecordNumber(record, ['unixTime', 'timestamp', 'startTimestamp', 'recordTimestamp']) ??
      parseRecordTime(getRecordValue(record, ['recordTime']))
  );

const getSleepEndUnixTime = (record: RingHistoryRecord) => {
  const explicitEndTime =
    getRecordNumber(record, [
      'endTimestamp',
      'end_timestamp',
      'stopTimestamp',
      'stop_timestamp',
      'finishTimestamp',
      'finish_timestamp',
      'sleepEndTimestamp',
      'sleep_end_timestamp'
    ]) ??
    parseRecordTime(
      getRecordValue(record, [
        'endTime',
        'end_time',
        'stopTime',
        'stop_time',
        'finishTime',
        'finish_time',
        'sleepEndTime',
        'sleep_end_time'
      ])
    );
  const normalizedEndTime = normalizeUnixTimestamp(explicitEndTime);
  if (normalizedEndTime) return normalizedEndTime;

  const startTime = getRingHistoryRecordStartUnixTime(record);
  const durationMinutes = getSleepDurationMinutes(record);
  if (!startTime || !durationMinutes || durationMinutes <= 0) return undefined;
  return startTime + Math.round(durationMinutes * 60);
};

const isSleepHistoryRecord = (record: RingHistoryRecord) =>
  getTypedSleepState(record) != null ||
  getRecordValue(record, [
    'sleepType',
    'sleep_type',
    'sleepState',
    'sleep_state',
    'sleepStatus',
    'sleep_status',
    'sleepStage',
    'sleep_stage',
    'stage'
  ]) != null ||
  getSleepDurationMinutes(record) != null ||
  isTypedHistoryRecord(record, [/sleep/]);

export const getRingHistoryRecordUnixTime = (record: RingHistoryRecord) => {
  return getRingHistoryRecordStartUnixTime(record);
};

export const getRingHistoryRecordSyncUnixTime = (record: RingHistoryRecord) => {
  const startTime = getRingHistoryRecordStartUnixTime(record);
  if (!isSleepHistoryRecord(record)) return startTime;
  const endTime = getSleepEndUnixTime(record);
  if (startTime && endTime) return Math.max(startTime, endTime);
  return endTime || startTime;
};

const parseRecordTime = (value: unknown) => {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 100000000000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const text = String(value).trim();
  if (!text) return undefined;
  if (/^\d{10,13}$/.test(text)) {
    const numeric = Number(text);
    return numeric > 100000000000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }
  if (/^\d{14}$/.test(text)) {
    const timestamp = new Date(
      Number(text.slice(0, 4)),
      Number(text.slice(4, 6)) - 1,
      Number(text.slice(6, 8)),
      Number(text.slice(8, 10)),
      Number(text.slice(10, 12)),
      Number(text.slice(12, 14))
    ).getTime();
    return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : undefined;
  }
  const normalized = text.replace(/-/g, '/');
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.floor(timestamp / 1000);
};

const formatUnixTime = (unixTime: number) => {
  const date = new Date(unixTime * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
};

export const formatRingHistoryRecordTime = (record: RingHistoryRecord) => {
  const unixTime = getRingHistoryRecordUnixTime(record);
  if (unixTime) return formatUnixTime(unixTime);
  const recordTime = getRecordValue(record, ['recordTime']);
  return recordTime ? String(recordTime) : '';
};

const formatRingHistoryTimeValue = (value: unknown) => {
  const unixTime = parseRecordTime(value);
  return unixTime ? formatUnixTime(unixTime) : undefined;
};

const getRingHistoryRecordTimeByAliases = (record: RingHistoryRecord, aliases: string[]) => {
  const value = getRecordValue(record, aliases);
  return formatRingHistoryTimeValue(value);
};

const normalizeDateRefValue = (value: unknown) => {
  if (value == null || value === '') return undefined;
  const text = String(value).trim();
  const matched = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (matched) {
    return `${matched[1]}-${matched[2].padStart(2, '0')}-${matched[3].padStart(2, '0')}`;
  }
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return formatRingHistoryTimeValue(value)?.slice(0, 10);
};

const resolveSleepDateRef = (explicitDateRef: unknown, startTime?: string, endTime?: string) => {
  const explicit = normalizeDateRefValue(explicitDateRef);
  if (explicit) return explicit;
  const startDate = startTime?.slice(0, 10);
  const endDate = endTime?.slice(0, 10);
  if (startDate && endDate && endDate > startDate) return endDate;
  return startDate || endDate;
};

const getRingHistorySubmitDedupeKey = (record: RingHistorySubmitRecord) =>
  JSON.stringify(RING_HISTORY_SUBMIT_DEDUPE_FIELDS.map((field) => [field, record[field] ?? null]));

const dedupeRingHistorySubmitRecords = (records: RingHistorySubmitRecord[]) => {
  const seen = new Set<string>();
  const deduped: RingHistorySubmitRecord[] = [];
  records.forEach((record) => {
    const key = getRingHistorySubmitDedupeKey(record);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(record);
  });
  return deduped;
};

export const isRingHistoryPayload = (item: RingHistoryRecord) => HISTORY_SOURCE_TYPES.has(item?.type);

export const isRingHistoryReadComplete = (receivedData: RingHistoryRecord[] = []) => {
  return receivedData.some((item) => {
    if (!isRingHistoryPayload(item)) return false;
    if (item.type === 'local_data') {
      if (item.status === 'no_data' || item.status === 'empty' || item.status === 'filtered') return true;
      if (item.protocol === 'rw' && item.status === 'success' && Array.isArray(item.records)) return true;
      const firstRecord = Array.isArray(item.records) ? item.records[0] : null;
      return Boolean(item.totalNum != null && firstRecord?.seq != null && item.totalNum === firstRecord.seq);
    }
    if (item.type === 'rw_upload_file') return item.status === 'completed' || item.statusCode === 2 || Array.isArray(item.records);
    if (item.type === 'rw_file_list') {
      if (Number(item.selectedFileCount) === 0) return true;
      if (Array.isArray(item.selectedFiles) && item.selectedFiles.length === 0) return true;
      return Array.isArray(item.files) && item.files.length === 0;
    }
    if (
      item.type === 'qkeer_v2_health_list' ||
      item.type === 'qkeer_v2_last_data' ||
      item.type === 'qkeer_v2_step_list' ||
      item.type === 'qkeer_v2_sleep_list'
    ) {
      return Array.isArray(item.records);
    }
    return false;
  });
};

export const buildRingHistorySubmitRecords = (records: RingHistoryRecord[] = [], lastReadTimestamp = 0): RingHistorySubmitRecord[] => {
  const submitRecords = records
    .filter((record) => {
      const unixTime = getRingHistoryRecordSyncUnixTime(record);
      return !lastReadTimestamp || !unixTime || unixTime >= lastReadTimestamp;
    })
    .map((record) => {
      const rrIntervals = getRecordValue(record, ['rrIntervals', 'rrintervals', 'ppg']);
      const bloodPressure = getBloodPressureParts(record);
      const sleepState = getSleepStateValue(record);
      const sleepDuration = getSleepDurationMinutes(record);
      const hasSleepPayload = sleepState != null || sleepDuration != null || isSleepHistoryRecord(record);
      const rawTemperature =
        getRecordNumber(record, TEMPERATURE_ALIASES) ??
        getTypedHistoryNumber(record, [/temperature|temp|body[_-]?temp/]);
      const sleepStartTime = hasSleepPayload
        ? getRingHistoryRecordTimeByAliases(record, [
            'startTime',
            'start_time',
            'startTimestamp',
            'start_timestamp',
            'beginTime',
            'begin_time',
            'beginTimestamp',
            'begin_timestamp',
            'sleepStartTime',
            'sleep_start_time'
          ])
        : undefined;
      const sleepEndTime = hasSleepPayload
        ? getRingHistoryRecordTimeByAliases(record, [
            'endTime',
            'end_time',
            'endTimestamp',
            'end_timestamp',
            'stopTime',
            'stop_time',
            'finishTime',
            'finish_time',
            'finishTimestamp',
            'finish_timestamp',
            'sleepEndTime',
            'sleep_end_time'
          ])
        : undefined;
      const sleepDateRef = hasSleepPayload
        ? resolveSleepDateRef(
            getRecordValue(record, ['dateRef', 'date_ref', 'recordDate', 'record_date', 'day', 'date']),
            sleepStartTime,
            sleepEndTime
          )
        : undefined;
      const stepCount = getHistoryStepCountValue(record);
      const rawStepCount = getRwCurrentDayCumulativeStepCountValue(record);
      const item: RingHistorySubmitRecord = {
        recordTime: formatRingHistoryRecordTime(record),
        stepCount,
        ...(rawStepCount != null
          ? {
              rawStepCount,
              cumulativeStepCount: rawStepCount,
              stepCountSource: 'rw_current_day_cumulative',
              rawDataType: getRecordValue(record, ['rawDataType'])
            }
          : {}),
        heartRate: normalizeHeartRateNumber(
          getRecordValue(record, HEART_RATE_ALIASES) ??
            getTypedHistoryNumber(record, [/heart[_-]?rate|(^|[_\-.])hr($|[_\-.])/, /heart_rate_raw/])
        ),
        hrv: normalizeHrvNumber(
          getRecordNumber(record, HRV_ALIASES) ?? getTypedHistoryNumber(record, [/hrv|rmssd/])
        ),
        spo2:
          normalizeBloodOxygenNumber(getRecordValue(record, BLOOD_OXYGEN_ALIASES)) ??
          normalizeBloodOxygenNumber(getTypedHistoryNumber(record, [/blood[_-]?oxygen|spo2|oxygen|(^|[_\-.])bo($|[_\-.])/, /blood_oxygen_raw/])),
        stress: normalizeStressNumber(
          getRecordNumber(record, STRESS_ALIASES) ?? getTypedHistoryNumber(record, [/stress|fatigue|(^|[_\-.])pressure($|[_\-.])/])
        ),
        bloodSugar: normalizeBloodSugarNumber(
          getRecordValue(record, BLOOD_SUGAR_ALIASES) ??
            getTypedHistoryNumber(record, [/blood[_-]?sugar|glucose|(^|[_\-.])bs($|[_\-.])/])
        ),
        systolic:
          normalizeBloodPressurePart(getRecordNumber(record, SYSTOLIC_ALIASES), 50, 260) ?? bloodPressure.systolic,
        diastolic:
          normalizeBloodPressurePart(getRecordNumber(record, DIASTOLIC_ALIASES), 30, 180) ?? bloodPressure.diastolic,
        temperature: normalizeTemperatureNumber(rawTemperature) ?? getRwFallbackTemperature(record, rawTemperature),
        sleepState,
        sleepDuration,
        startTime: sleepStartTime,
        endTime: sleepEndTime,
        dateRef: sleepDateRef,
        motionIntensity: getRecordNumber(record, [
          'motionIntensity',
          'motion_intensity',
          'activityLevel',
          'activity_level',
          'motionLevel',
          'motion_level',
          'intensity',
          'intensityLevel',
          'intensity_level'
        ]),
        perfusionIndex: getRecordNumber(record, ['perfusion', 'perfusionIndex']),
        rrIntervals: formatRrIntervals(rrIntervals)
      };

      Object.keys(item).forEach((key) => {
        if (item[key] == null || item[key] === '') delete item[key];
      });

      return item;
    })
    .filter((record) => Object.keys(record).some((key) => key !== 'recordTime') && record.recordTime);

  return dedupeRingHistorySubmitRecords(submitRecords);
};

export const submitRingHistorySyncResult = async (
  result: RingHistorySyncResultLike | null | undefined,
  options: SubmitRingHistorySyncResultOptions
): Promise<SubmitRingHistorySyncResultResult> => {
  const rawRecords = result?.records || [];
  const maxVisibleTimestamp = Math.floor(Date.now() / 1000) + HISTORY_FUTURE_TOLERANCE_SECONDS;
  const futureFilteredRecords = rawRecords.filter((record) => isRingHistoryRecordAfterMaxVisible(record, maxVisibleTimestamp));
  const visibleRecords = rawRecords.filter((record) => !isRingHistoryRecordAfterMaxVisible(record, maxVisibleTimestamp));
  const dataList = buildRingHistorySubmitRecords(visibleRecords, options.sinceTimestamp ?? 0);
  const filteredRecords = visibleRecords.filter((record) => {
    const unixTime = getRingHistoryRecordSyncUnixTime(record);
    if (options.sinceTimestamp && unixTime && unixTime < options.sinceTimestamp) return true;
    return !buildRingHistorySubmitRecords([record], options.sinceTimestamp ?? 0).length;
  });
  const rawMetricCounts = countRingHistoryRecordMetrics(rawRecords as Array<Record<string, any>>);
  const submitMetricCounts = countRingHistoryRecordMetrics(dataList as Array<Record<string, any>>);
  if (dataList.length === 0) {
    return {
      submitted: false,
      count: 0,
      maxTimestamp: 0,
      maxVisibleTimestamp,
      rawCount: rawRecords.length,
      filteredOutCount: filteredRecords.length,
      futureFilteredOutCount: futureFilteredRecords.length,
      rawMetricCounts,
      submitMetricCounts,
      sampleFilteredRecords: filteredRecords.slice(0, 2),
      sampleFutureFilteredRecords: futureFilteredRecords.slice(0, 2),
      sampleSubmittedRecords: []
    };
  }

  const deviceMac = String(options.deviceMac || '').trim();
  if (!deviceMac) {
    throw new Error('缺少设备 MAC，历史数据未提交');
  }

  const submitResponse = await options.submit({ deviceMac, dataList });
  const maxTimestamp = dataList.reduce((latest, record) => {
    return Math.max(latest, getRingHistoryRecordSyncUnixTime(record) || 0);
  }, 0);

  return {
    submitted: true,
    count: dataList.length,
    maxTimestamp,
    maxVisibleTimestamp,
    rawCount: rawRecords.length,
    filteredOutCount: filteredRecords.length,
    futureFilteredOutCount: futureFilteredRecords.length,
    rawMetricCounts,
    submitMetricCounts,
    sampleFilteredRecords: filteredRecords.slice(0, 2),
    sampleFutureFilteredRecords: futureFilteredRecords.slice(0, 2),
    submitResponse,
    sampleSubmittedRecords: dataList.slice(0, 2)
  };
};

const formatRrIntervals = (value: unknown) => {
  if (value == null || value === '') return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
};

export const getRingSubmitDeviceMac = (userStore: any, isIOS: boolean, ...deviceSources: any[]) => {
  const info = userStore.deviceInfo || {};
  const allDeviceSources = [info, ...deviceSources].filter(Boolean);
  const hasRwSource = allDeviceSources.some((source) => source?.protocol === 'rw');

  if (info.protocol === 'rw' || hasRwSource) {
    for (const source of allDeviceSources) {
      const stableMac = getRwStableSubmitMac(source);
      if (stableMac) return stableMac;
    }
    return '';
  }

  const currentStableMac = info.mac || info.advertis?.macInfo;
  const stableMac = userStore.normalMac || currentStableMac;
  return (
    (isIOS ? stableMac || info.uniMacId : info.deviceId || stableMac) ||
    userStore.normalMac ||
    info.advertis?.macInfo ||
    info.deviceId ||
    info.uniMacId ||
    ''
  );
};

const getRwStableSubmitMac = (device?: Record<string, any> | null) => {
  if (!device) return '';
  return (
    device.mac ||
    device.advertis?.macInfo ||
    (isColonSeparatedBleMac(device.uniMacId) ? device.uniMacId : '') ||
    (isColonSeparatedBleMac(device.deviceId) ? device.deviceId : '')
  );
};

const isColonSeparatedBleMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());
