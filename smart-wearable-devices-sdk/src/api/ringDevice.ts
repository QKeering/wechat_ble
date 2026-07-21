import type { RingBindPayload, RingBoundDevice, RingHistoricalRecord, RingParsedData, RingUnbindPayload } from '@/sdk/ring-ble';

const BOUND_RING_KEY = 'qkeer:bound-ring-device';
const RING_HISTORY_KEY = 'qkeer:ring-history-records';
const MAX_LOCAL_HISTORY_RECORDS = 200;

const readStorage = <T>(key: string, fallback: T): T => {
  try {
    return (uni.getStorageSync(key) as T) || fallback;
  } catch {
    return fallback;
  }
};

const writeStorage = (key: string, value: unknown) => {
  uni.setStorageSync(key, value);
};

export const getBoundRingDevice = async (): Promise<RingBoundDevice | null> => {
  return readStorage<RingBoundDevice | null>(BOUND_RING_KEY, null);
};

export const clearBoundRingDevice = async (): Promise<void> => {
  writeStorage(BOUND_RING_KEY, null);
};

export const bindRingDevice = async (payload: RingBindPayload): Promise<RingBoundDevice> => {
  const stableMac = getBindPayloadStableMac(payload);
  const boundDevice: RingBoundDevice = {
    mac: stableMac,
    deviceId: payload.deviceId || stableMac,
    deviceName: payload.deviceName,
    name: payload.deviceName,
    serviceId: payload.serviceId,
    cmdCharId: payload.cmdCharId,
    dataCharId: payload.dataCharId,
    dataServiceId: payload.dataServiceId,
    uniMacId: payload.uniMacId,
    protocol: payload.protocol,
    advertis: payload.advertis
  };

  writeStorage(BOUND_RING_KEY, boundDevice);
  return boundDevice;
};

const getBindPayloadStableMac = (payload: RingBindPayload) => {
  if (payload.protocol === 'rw') {
    return (
      payload.mac ||
      payload.advertis?.macInfo ||
      (isColonSeparatedBleMac(payload.uniMacId) ? payload.uniMacId : '') ||
      (isColonSeparatedBleMac(payload.deviceId) ? payload.deviceId : '')
    );
  }
  return payload.mac;
};

export const unbindRingDevice = async (payload: RingUnbindPayload): Promise<void> => {
  const current = await getBoundRingDevice();
  if (!current || isSameStoredRingIdentity(current, payload.mac)) {
    await clearBoundRingDevice();
  }
};

export const uploadRingHistoryRecords = async (records: RingHistoricalRecord[], parsed: RingParsedData) => {
  const history = readStorage<RingHistoricalRecord[]>(RING_HISTORY_KEY, []);
  const uploadedAt = Date.now();
  const sourceType = parsed.type;
  const protocol = parsed.protocol;
  const parsedIdentity = getParsedHistoryIdentity(parsed);
  const keyedHistory = new Map<string, RingHistoricalRecord>();

  for (const record of history) {
    keyedHistory.set(getHistoryRecordKey(record), record);
  }

  for (const record of records) {
    const nextRecord = {
      ...record,
      advertis: record.advertis || parsedIdentity.advertis,
      mac: record.mac || parsedIdentity.mac,
      uniMacId: record.uniMacId || parsedIdentity.uniMacId,
      deviceId: record.deviceId || parsedIdentity.deviceId,
      sourceType: record.sourceType || sourceType,
      protocol: record.protocol || protocol,
      uploadedAt
    };
    keyedHistory.set(getHistoryRecordKey(nextRecord), nextRecord);
  }

  const nextHistory = Array.from(keyedHistory.values())
    .sort((left, right) => getHistoryRecordTime(right) - getHistoryRecordTime(left))
    .slice(0, MAX_LOCAL_HISTORY_RECORDS);

  writeStorage(RING_HISTORY_KEY, nextHistory);
  return { count: records.length, storedCount: nextHistory.length };
};

const getHistoryRecordTime = (record: RingHistoricalRecord) => {
  const value =
    getHistoryRecordNumber(
      getHistoryRecordField(record, 'unixTime'),
      getHistoryRecordField(record, 'timestamp'),
      getHistoryRecordField(record, 'startTimestamp'),
      getHistoryRecordField(record, 'recordTimestamp')
    ) ||
    parseHistoryRecordTime(getHistoryRecordField(record, 'recordTime')) ||
    getHistoryRecordNumber(getHistoryRecordField(record, 'uploadedAt'));
  if (!value || value <= 0) return 0;
  return value > 100000000000 ? Math.floor(value / 1000) : Math.floor(value);
};

const getHistoryRecordKey = (record: RingHistoricalRecord) => {
  const protocol = record.protocol || '';
  const deviceKey = getHistoryRecordDeviceKey(record);
  const sourceType = record.sourceType || record.type || '';
  const metricType = getHistoryRecordMetricType(record);
  const time = getHistoryRecordTime(record);
  const seq =
    getHistoryRecordField(record, 'seq') ??
    getHistoryRecordField(record, 'fileName') ??
    getHistoryRecordField(record, 'id') ??
    '';
  const hasSequenceIdentity = seq != null && String(seq).trim() !== '';
  const hasMetricIdentity = String(metricType).trim() !== '';
  const hasStableRecordIdentity = Boolean((time || hasSequenceIdentity) && (hasMetricIdentity || hasSequenceIdentity));
  const fallback = hasStableRecordIdentity ? '' : JSON.stringify(record);
  const identitySourceType = hasStableRecordIdentity ? '' : sourceType;
  return `${protocol}:${deviceKey}:${identitySourceType}:${String(metricType).toLowerCase()}:${time}:${seq}:${fallback}`;
};

const getHistoryRecordMetricType = (record: RingHistoricalRecord) => {
  const explicitType =
    getHistoryRecordField(record, 'dataType') ||
    getHistoryRecordField(record, 'rawDataType') ||
    getHistoryRecordField(record, 'fileType') ||
    getHistoryRecordField(record, 'metricType');
  if (explicitType != null && String(explicitType).trim()) return explicitType;

  if (hasHistoryRecordField(record, 'heartRate') || hasHistoryRecordField(record, 'hr')) return 'heart_rate';
  if (hasHistoryRecordField(record, 'bloodOxygen') || hasHistoryRecordField(record, 'spo2')) return 'blood_oxygen';
  if (hasHistoryRecordField(record, 'sleepTotalMinutes') || hasHistoryRecordField(record, 'sleepState')) return 'sleep';
  if (hasHistoryRecordField(record, 'stepCount') || hasHistoryRecordField(record, 'steps')) return 'step';
  if (hasHistoryRecordField(record, 'calorie') || hasHistoryRecordField(record, 'calories')) return 'calorie';
  if (hasHistoryRecordField(record, 'distance')) return 'distance';
  if (hasHistoryRecordField(record, 'temperature') || hasHistoryRecordField(record, 'bodyTemperature')) return 'temperature';
  if (hasHistoryRecordField(record, 'hrv')) return 'hrv';
  if (hasHistoryRecordField(record, 'stress')) return 'stress';
  if (hasHistoryRecordField(record, 'bloodSugar')) return 'blood_sugar';
  if (hasHistoryRecordField(record, 'systolic') || hasHistoryRecordField(record, 'diastolic') || hasHistoryRecordField(record, 'bloodPressure')) {
    return 'blood_pressure';
  }
  return '';
};

const getHistoryRecordField = (record: RingHistoricalRecord, field: string) => {
  const source = record as Record<string, any>;
  if (Object.prototype.hasOwnProperty.call(source, field)) return source[field];
  const normalizedField = field.toLowerCase();
  const matchedKey = Object.keys(source).find((key) => key.toLowerCase() === normalizedField);
  return matchedKey ? source[matchedKey] : undefined;
};

const hasHistoryRecordField = (record: RingHistoricalRecord, field: string) =>
  getHistoryRecordField(record, field) != null && getHistoryRecordField(record, field) !== '';

const getHistoryRecordNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (value == null || value === '') continue;
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
};

const parseHistoryRecordTime = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const timestamp = Date.parse(value.trim().replace(/-/g, '/'));
  if (!Number.isFinite(timestamp)) return 0;
  return Math.floor(timestamp / 1000);
};

const isSameStoredRingIdentity = (device: RingBoundDevice, identity: string) => {
  const target = normalizeRingIdentity(identity);
  const candidates =
    device.protocol === 'rw'
      ? [
          device.mac,
          device.advertis?.macInfo,
          isColonSeparatedBleMac(device.uniMacId) ? device.uniMacId : '',
          isColonSeparatedBleMac(device.deviceId) ? device.deviceId : ''
        ]
      : [device.mac, device.deviceId, device.uniMacId, device.advertis?.macInfo];
  return candidates.some((candidate) => {
    const rawCandidate = String(candidate || '').trim();
    if (!rawCandidate) return false;
    if (rawCandidate === identity) return true;
    const normalizedCandidate = normalizeRingIdentity(rawCandidate);
    return Boolean(target && normalizedCandidate && target === normalizedCandidate);
  });
};

const getParsedHistoryIdentity = (parsed: RingParsedData) => {
  const stableIdentity = parsed.mac || parsed.advertis?.macInfo;
  return {
    advertis: parsed.advertis,
    mac: stableIdentity,
    uniMacId: stableIdentity || parsed.uniMacId,
    deviceId: parsed.deviceId
  };
};

const getHistoryRecordDeviceKey = (record: RingHistoricalRecord) => {
  const stableIdentity = record.mac || record.advertis?.macInfo;
  if (stableIdentity) return normalizeRingIdentity(stableIdentity) || String(stableIdentity).trim();

  if (record.protocol === 'rw') {
    const legacyStableIdentity = isColonSeparatedBleMac(record.uniMacId)
      ? record.uniMacId
      : isColonSeparatedBleMac(record.deviceId)
        ? record.deviceId
        : '';
    if (legacyStableIdentity) return normalizeRingIdentity(legacyStableIdentity) || String(legacyStableIdentity).trim();
    return String(record.deviceId || record.uniMacId || '').trim();
  }

  const fallbackIdentity = record.uniMacId || record.deviceId || '';
  return normalizeRingIdentity(fallbackIdentity) || String(fallbackIdentity).trim();
};

const normalizeRingIdentity = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  return hex.length >= 6 && hex.length % 2 === 0 ? hex : '';
};

const isColonSeparatedBleMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());
