import type { RingBindPayload, RingBoundDevice, RingHistoricalRecord, RingParsedData, RingUnbindPayload } from '@/sdk/ring-ble';

const BOUND_RING_KEY = 'qkeer:bound-ring-device';
const RING_HISTORY_KEY = 'qkeer:ring-history-records';
const RING_RAW_HISTORY_KEY = 'qkeer:ring-raw-history-frames:v1';
const MAX_LOCAL_HISTORY_RECORDS = 200;
const MAX_LOCAL_RAW_HISTORY_FRAMES = 1000;

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

type AnyRecord = Record<string, any>;

export interface RingRawHistoryFrame {
  deviceKey: string;
  protocol?: string;
  sourceType?: string;
  status?: string;
  rawHex: string;
  rawHash: string;
  rawByteLength: number;
  receivedAt: number;
  lastSeenAt: number;
  seenCount: number;
  chunkIndex: number;
  chunkCount: number;
  recordCount: number;
  totalNum?: number;
  maxSeq?: number;
  recordTimeStart?: string;
  recordTimeEnd?: string;
}

const normalizeFieldName = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const getFieldValue = (source: AnyRecord | null | undefined, ...keys: string[]) => {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  const normalizedEntries = Object.keys(source).map((key) => [normalizeFieldName(key), source[key]] as const);
  for (const key of keys) {
    const normalizedKey = normalizeFieldName(key);
    const matched = normalizedEntries.find(([name]) => name === normalizedKey);
    if (matched) return matched[1];
  }
  return undefined;
};

const getStringField = (source: AnyRecord | null | undefined, ...keys: string[]) => {
  for (const key of keys) {
    const value = getFieldValue(source, key);
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};

export const normalizeRingBoundDevice = <T extends AnyRecord | null | undefined>(device: T): RingBoundDevice | null => {
  if (!device || typeof device !== 'object') return null;
  const source = device as AnyRecord;
  const rawAdvertis = getFieldValue(source, 'advertis', 'advertise', 'advertisement', 'advertising');
  const advertis = rawAdvertis && typeof rawAdvertis === 'object' ? { ...(rawAdvertis as AnyRecord) } : undefined;
  const mac =
    getStringField(source, 'mac', 'macAddress', 'deviceMac', 'bluetoothMac', 'bleMac', 'macAddr', 'mac_addr') ||
    getStringField(advertis, 'macInfo', 'mac', 'macAddress', 'deviceMac', 'bluetoothMac', 'bleMac', 'macAddr', 'mac_addr');
  const uniMacId =
    getStringField(source, 'uniMacId', 'uni_mac_id', 'macId', 'mac_id') ||
    getStringField(advertis, 'uniMacId', 'uni_mac_id');
  const deviceId = getStringField(
    source,
    'deviceId',
    'device_id',
    'bleDeviceId',
    'ble_device_id',
    'bluetoothDeviceId',
    'bluetooth_device_id',
    'platformDeviceId',
    'platform_device_id',
    'wxDeviceId',
    'wx_device_id'
  );
  const deviceName = getStringField(
    source,
    'deviceName',
    'device_name',
    'name',
    'localName',
    'local_name',
    'bleName',
    'ble_name',
    'bluetoothName',
    'bluetooth_name'
  );
  const normalizedAdvertis = advertis || mac ? { ...(advertis || {}), ...(mac ? { macInfo: getStringField(advertis, 'macInfo') || mac } : {}) } : undefined;

  return {
    ...source,
    mac: mac || source.mac,
    deviceId: deviceId || source.deviceId || mac || '',
    deviceName: deviceName || source.deviceName || source.name,
    name: source.name || deviceName || source.deviceName,
    serviceId: getStringField(source, 'serviceId', 'service_id') || source.serviceId,
    cmdCharId:
      getStringField(source, 'cmdCharId', 'cmd_char_id', 'writeCharId', 'write_char_id', 'writeCharacteristicId', 'write_characteristic_id') ||
      source.cmdCharId,
    dataCharId:
      getStringField(source, 'dataCharId', 'data_char_id', 'notifyCharId', 'notify_char_id', 'notifyCharacteristicId', 'notify_characteristic_id') ||
      source.dataCharId,
    dataServiceId: getStringField(source, 'dataServiceId', 'data_service_id', 'notifyServiceId', 'notify_service_id') || source.dataServiceId,
    uniMacId: uniMacId || source.uniMacId || mac || '',
    protocol: getStringField(source, 'protocol', 'deviceProtocol', 'device_protocol') || source.protocol,
    advertis: normalizedAdvertis || source.advertis
  };
};

export const getBoundRingDevice = async (): Promise<RingBoundDevice | null> => {
  const stored = readStorage<RingBoundDevice | null>(BOUND_RING_KEY, null);
  return normalizeRingBoundDevice(stored);
};

export const clearBoundRingDevice = async (): Promise<void> => {
  writeStorage(BOUND_RING_KEY, null);
};

export const bindRingDevice = async (payload: RingBindPayload): Promise<RingBoundDevice> => {
  const stableMac = getBindPayloadStableMac(payload);
  const normalizedPayload = normalizeRingBoundDevice(payload as any) || (payload as any);
  const boundDevice: RingBoundDevice = {
    ...normalizedPayload,
    mac: stableMac || normalizedPayload.mac || '',
    deviceId: normalizedPayload.deviceId || stableMac || '',
    deviceName: normalizedPayload.deviceName || normalizedPayload.name,
    name: normalizedPayload.name || normalizedPayload.deviceName,
    serviceId: normalizedPayload.serviceId,
    cmdCharId: normalizedPayload.cmdCharId,
    dataCharId: normalizedPayload.dataCharId,
    dataServiceId: normalizedPayload.dataServiceId,
    uniMacId: normalizedPayload.uniMacId || stableMac || '',
    protocol: normalizedPayload.protocol,
    advertis: normalizedPayload.advertis
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
  const rawStageResult = stageRingRawHistoryFrames(records, parsed);
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
  return { count: records.length, storedCount: nextHistory.length, ...rawStageResult };
};

export const buildRingRawHistoryFrames = (
  records: Array<RingHistoricalRecord | AnyRecord>,
  parsed: (RingParsedData & AnyRecord) | AnyRecord | null | undefined,
  forcedDeviceKey = ''
): RingRawHistoryFrame[] => {
  if (!parsed || typeof parsed !== 'object') return [];
  const rawChunks = getParsedRawChunks(parsed as RingParsedData);
  if (rawChunks.length === 0) return [];

  const parsedIdentity = getParsedHistoryIdentity(parsed as RingParsedData);
  const firstRecord = records[0] as RingHistoricalRecord | undefined;
  const deviceKey =
    normalizeRingIdentity(forcedDeviceKey) ||
    normalizeRingIdentity(parsedIdentity.mac || parsedIdentity.uniMacId || parsedIdentity.deviceId) ||
    (firstRecord ? getHistoryRecordDeviceKey(firstRecord) : '') ||
    String(forcedDeviceKey || parsedIdentity.mac || parsedIdentity.uniMacId || parsedIdentity.deviceId || '').trim();
  const recordTimes = (records as RingHistoricalRecord[])
    .map(getHistoryRecordTime)
    .filter((time) => time > 0)
    .sort((left, right) => left - right);
  const recordTimeStart = formatHistoryUnixTime(recordTimes[0]);
  const recordTimeEnd = formatHistoryUnixTime(recordTimes[recordTimes.length - 1]);
  const receivedAt = Date.now();

  return rawChunks.map((raw, index) => {
    const rawHex = bytesToHex(raw);
    const protocol = String(parsed.protocol || '');
    const sourceType = String(parsed.type || '');
    const rawHash = hashRawHistoryFrame(`${deviceKey}:${protocol}:${sourceType}:${rawHex}`);
    return {
      deviceKey,
      protocol: parsed.protocol,
      sourceType: parsed.type,
      status: parsed.status,
      rawHex,
      rawHash,
      rawByteLength: raw.length,
      receivedAt,
      lastSeenAt: receivedAt,
      seenCount: 1,
      chunkIndex: index,
      chunkCount: rawChunks.length,
      recordCount: records.length,
      totalNum: Number.isFinite(Number(parsed.totalNum)) ? Number(parsed.totalNum) : undefined,
      maxSeq: Number.isFinite(Number(parsed.maxSeq)) ? Number(parsed.maxSeq) : undefined,
      recordTimeStart,
      recordTimeEnd
    };
  });
};

const stageRingRawHistoryFrames = (records: RingHistoricalRecord[], parsed: RingParsedData) => {
  const rawFrames = buildRingRawHistoryFrames(records, parsed);
  if (rawFrames.length === 0) {
    return { rawStored: false, rawFrameCount: 0, rawStoredCount: 0 };
  }

  try {
    const storedFrames = readStorage<RingRawHistoryFrame[]>(RING_RAW_HISTORY_KEY, []);
    const keyedFrames = new Map<string, RingRawHistoryFrame>();

    for (const frame of storedFrames) {
      if (frame?.rawHash) keyedFrames.set(frame.rawHash, frame);
    }

    rawFrames.forEach((frame) => {
      const previous = keyedFrames.get(frame.rawHash);
      keyedFrames.set(frame.rawHash, {
        ...frame,
        receivedAt: previous?.receivedAt || frame.receivedAt,
        lastSeenAt: frame.lastSeenAt,
        seenCount: (previous?.seenCount || 0) + 1
      });
    });

    const nextFrames = Array.from(keyedFrames.values())
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .slice(0, MAX_LOCAL_RAW_HISTORY_FRAMES);
    writeStorage(RING_RAW_HISTORY_KEY, nextFrames);

    return {
      rawStored: true,
      rawFrameCount: rawFrames.length,
      rawStoredCount: nextFrames.length
    };
  } catch {
    return {
      rawStored: false,
      rawFrameCount: rawFrames.length,
      rawStoredCount: 0
    };
  }
};

const getParsedRawChunks = (parsed: RingParsedData) => {
  const source = parsed as Record<string, any>;
  const rawChunks = source?.rawChunks || source?.raw_frames || source?.rawFrames || source?.frames;
  if (Array.isArray(rawChunks)) {
    return rawChunks.map(normalizeRawBytes).filter((raw) => raw.length > 0);
  }

  const raw = normalizeRawBytes(source.raw ?? source.rawHex ?? source.raw_hex ?? source.hex ?? source.payload ?? source.frame);
  return raw.length > 0 ? [raw] : [];
};

const normalizeRawBytes = (value: unknown) => {
  let bytes: unknown[] = [];
  if (Array.isArray(value)) {
    bytes = value;
  } else if (typeof value === 'string') {
    const hex = value.replace(/[^0-9a-f]/gi, '');
    if (hex.length >= 2 && hex.length % 2 === 0) {
      bytes = hex.match(/.{2}/g)?.map((item) => parseInt(item, 16)) || [];
    }
  } else if (value && typeof value === 'object') {
    const objectValue = value as Record<string, any>;
    const nestedRaw = objectValue.raw ?? objectValue.rawHex ?? objectValue.raw_hex ?? objectValue.hex ?? objectValue.payload ?? objectValue.frame;
    if (nestedRaw !== undefined && nestedRaw !== value) {
      return normalizeRawBytes(nestedRaw);
    }
    if (Array.isArray(objectValue.data)) {
      bytes = objectValue.data;
    } else if (typeof ArrayBuffer !== 'undefined') {
      if (value instanceof ArrayBuffer) {
        bytes = Array.from(new Uint8Array(value));
      } else if (typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(value as ArrayBufferView)) {
        const view = value as ArrayBufferView;
        bytes = Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      }
    }
  }
  return bytes
    .map((byte) => Number(byte))
    .filter((byte) => Number.isFinite(byte) && byte >= 0 && byte <= 255)
    .map((byte) => Math.floor(byte));
};

const bytesToHex = (bytes: number[]) => bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();

const hashRawHistoryFrame = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const formatHistoryUnixTime = (unixTime?: number) => {
  if (!unixTime || unixTime <= 0) return undefined;
  const date = new Date(unixTime * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
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
