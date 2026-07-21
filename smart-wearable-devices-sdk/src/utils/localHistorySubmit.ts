import { submitData } from '@/common/api/homeDetail';
import type { SyncData } from '@/types/api/homeDetail';
import { formatMetricRecordTime, getMetricSubmitDeviceMac } from '@/utils/metricSubmit';

type LocalHistoryRecord = Record<string, any>;

interface BuildLocalHistorySubmitOptions {
  includeDeviceStress?: boolean;
}

interface UploadLocalHistoryOptions extends BuildLocalHistorySubmitOptions {
  isIOS?: boolean;
  lastReadTimestamp?: number;
  records?: LocalHistoryRecord[];
}

const STATUS_ONLY_VALUES = new Set([0x11, 0x31]);

const getNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (value == null || value === '') continue;
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
};

const getRecordValue = (record: LocalHistoryRecord, fields: string[]) => {
  for (const field of fields) {
    const value = record?.[field];
    if (value !== undefined && value !== null && value !== '') return value;
  }

  const lowerEntries = Object.keys(record || {}).reduce<Record<string, any>>((result, key) => {
    result[key.toLowerCase()] = record[key];
    return result;
  }, {});

  for (const field of fields) {
    const value = lowerEntries[field.toLowerCase()];
    if (value !== undefined && value !== null && value !== '') return value;
  }

  return undefined;
};

const normalizeRangeNumber = (value: unknown, min: number, max: number) => {
  const numeric = getNumber(value);
  if (numeric == null || numeric < min || numeric > max || STATUS_ONLY_VALUES.has(numeric)) return undefined;
  return numeric;
};

const normalizePositiveNumber = (value: unknown, max = Number.MAX_SAFE_INTEGER) => {
  const numeric = getNumber(value);
  if (numeric == null || numeric <= 0 || numeric > max || STATUS_ONLY_VALUES.has(numeric)) return undefined;
  return numeric;
};

export const getLocalHistoryRecordUnixTime = (record: LocalHistoryRecord) => {
  const direct = getNumber(
    getRecordValue(record, ['unixTime', 'recordTimestamp', 'startTimestamp', 'timestampSec', 'timeSec'])
  );
  if (direct && direct > 0) return direct > 100000000000 ? Math.floor(direct / 1000) : Math.floor(direct);

  const timestamp = getRecordValue(record, ['timestamp', 'recordTime', 'time', 'startTime']);
  if (typeof timestamp === 'string' && timestamp.trim()) {
    const parsed = Date.parse(timestamp.trim().replace(/-/g, '/'));
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }

  const numericTimestamp = getNumber(timestamp);
  if (numericTimestamp && numericTimestamp > 0) {
    return numericTimestamp > 100000000000 ? Math.floor(numericTimestamp / 1000) : Math.floor(numericTimestamp);
  }

  return 0;
};

const formatHistoryRecordTime = (record: LocalHistoryRecord) => {
  const explicit = getRecordValue(record, ['recordTime']);
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const unixTime = getLocalHistoryRecordUnixTime(record);
  return formatMetricRecordTime(unixTime ? unixTime * 1000 : Date.now());
};

export const isLocalHistoryReadComplete = (packets: LocalHistoryRecord[] = []) => {
  return packets.some((packet) => {
    if (packet?.type !== 'local_data') return false;
    if (packet.status === 'no_data' || packet.status === 'empty' || packet.status === 'filtered') return true;

    const records = Array.isArray(packet.records) ? packet.records : [];
    if (packet.protocol === 'rw' && packet.status === 'success' && records.length >= 0) return true;

    const totalNum = getNumber(packet.totalNum);
    if (totalNum == null) return packet.status === 'success' && records.length > 0;

    return records.some((record: LocalHistoryRecord) => getNumber(record?.seq) === totalNum);
  });
};

export const buildLocalHistorySubmitRecords = (
  records: LocalHistoryRecord[] = [],
  lastReadTimestamp = 0,
  options: BuildLocalHistorySubmitOptions = {}
): SyncData[] => {
  return records
    .filter((record) => {
      const unixTime = getLocalHistoryRecordUnixTime(record);
      return !lastReadTimestamp || !unixTime || unixTime >= lastReadTimestamp;
    })
    .map((record) => {
      const rrIntervals = getRecordValue(record, ['rrIntervals', 'rrintervals', 'ppg']);
      const sleepState = getNumber(getRecordValue(record, ['sleepState', 'sleep_state', 'sleepType', 'sleep_type', 'sleepStage', 'stage']));
      const item: SyncData = {
        recordTime: formatHistoryRecordTime(record),
        stepCount: normalizePositiveNumber(getRecordValue(record, ['stepCount', 'steps', 'step']), 300000),
        heartRate: normalizeRangeNumber(getRecordValue(record, ['heartRate', 'heart_rate', 'hr']), 25, 240),
        hrv: normalizeRangeNumber(getRecordValue(record, ['hrv', 'heartRateVariability', 'heart_rate_variability']), 1, 300),
        spo2: normalizeRangeNumber(getRecordValue(record, ['spo2', 'spO2', 'SPO2', 'bloodOxygen', 'blood_oxygen']), 70, 100),
        temperature: normalizeRangeNumber(getRecordValue(record, ['temperature', 'bodyTemperature', 'body_temperature', 'skinTemperature']), 20, 45),
        sleepState: sleepState && sleepState >= 1 && sleepState <= 5 ? sleepState : undefined,
        motionIntensity: normalizeRangeNumber(getRecordValue(record, ['motionIntensity', 'motion_intensity', 'activityLevel', 'activity_level']), 0, 255),
        perfusionIndex: normalizePositiveNumber(getRecordValue(record, ['perfusion', 'perfusionIndex', 'perfusion_index']), 1000),
        rrIntervals: rrIntervals == null || rrIntervals === '' ? undefined : typeof rrIntervals === 'string' ? rrIntervals : JSON.stringify(rrIntervals)
      };

      if (options.includeDeviceStress) {
        item.stress = normalizeRangeNumber(getRecordValue(record, ['stress', 'stressIndex', 'pressure']), 0, 100);
      }

      Object.keys(item).forEach((key) => {
        const value = (item as Record<string, unknown>)[key];
        if (value === undefined || value === null || value === '') delete (item as Record<string, unknown>)[key];
      });

      return item;
    })
    .filter((record) => Boolean(record.recordTime && Object.keys(record).some((key) => key !== 'recordTime')));
};

export const uploadLocalHistoryRecords = async (userStore: any, options: UploadLocalHistoryOptions = {}) => {
  const rawRecords = Array.isArray(options.records) ? options.records : userStore?.localData || [];
  const dataList = buildLocalHistorySubmitRecords(rawRecords, options.lastReadTimestamp ?? Number(userStore?.lastReadTimestamp || 0), {
    includeDeviceStress: options.includeDeviceStress
  });

  if (dataList.length === 0) {
    return { submitted: false, count: 0, maxTimestamp: 0, dataList };
  }

  const deviceMac = getMetricSubmitDeviceMac(userStore, options.isIOS === true);
  if (!deviceMac) {
    throw new Error('missing deviceMac for local history upload');
  }

  userStore?.updateUploadingStatus?.('1');
  const response = await submitData({ deviceMac, dataList });
  userStore?.updateUploadingStatus?.('2');

  const maxTimestamp = rawRecords.reduce((latest: number, record: LocalHistoryRecord) => {
    const unixTime = getLocalHistoryRecordUnixTime(record);
    return Math.max(latest, unixTime || 0);
  }, 0);

  if (maxTimestamp > 0) {
    userStore?.updateLastReadTimestamp?.(maxTimestamp);
  }

  return { submitted: true, count: dataList.length, maxTimestamp, dataList, response };
};
