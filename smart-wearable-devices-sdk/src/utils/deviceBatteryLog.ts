import { reportDeviceBatteryLog } from '@/common/api/device';
import { getRawBatteryPercent } from '@/utils/batteryDisplay';
import { normalizeDeviceIdentityMac } from '@/utils/deviceIdentityCache';

const BATTERY_LOG_DEDUP_MS = 5 * 1000;
const BATTERY_LOG_CACHE_TTL_MS = 10 * 60 * 1000;
const BATTERY_LOG_CACHE_MAX_COUNT = 300;

const batteryLogReportCache = new Map<string, number>();

export interface ReportRealBatteryLogOptions {
  userId?: unknown;
  mac?: unknown;
  battery?: unknown;
  source?: string;
  recordTime?: string | Date;
}

const normalizeBatteryRecordTime = (value?: string | Date) => {
  if (value instanceof Date) return value.toISOString();
  if (value) return String(value);
  return new Date().toISOString();
};

const normalizeBatteryLogUserId = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text && text !== '0' ? text : '';
};

const pruneBatteryLogReportCache = (now = Date.now()) => {
  for (const [signature, cachedAt] of batteryLogReportCache) {
    if (now - cachedAt > BATTERY_LOG_CACHE_TTL_MS) {
      batteryLogReportCache.delete(signature);
    }
  }
  if (batteryLogReportCache.size <= BATTERY_LOG_CACHE_MAX_COUNT) return;
  const removeCount = batteryLogReportCache.size - BATTERY_LOG_CACHE_MAX_COUNT;
  Array.from(batteryLogReportCache.keys())
    .slice(0, removeCount)
    .forEach((signature) => batteryLogReportCache.delete(signature));
};

export const reportRealBatteryLog = async (options: ReportRealBatteryLogOptions) => {
  const userId = normalizeBatteryLogUserId(options.userId);
  const deviceMac = normalizeDeviceIdentityMac(options.mac);
  const rawBattery = getRawBatteryPercent(options.battery);
  if (!userId || !deviceMac || rawBattery == null) return false;

  const now = Date.now();
  pruneBatteryLogReportCache(now);
  const realBattery = Math.round(rawBattery);
  const minuteBucket = Math.floor(now / BATTERY_LOG_DEDUP_MS);
  const signature = `${userId}|${deviceMac}|${realBattery}|${minuteBucket}`;
  const cachedAt = batteryLogReportCache.get(signature) || 0;
  if (now - cachedAt < BATTERY_LOG_DEDUP_MS) return false;
  batteryLogReportCache.set(signature, now);

  try {
    await reportDeviceBatteryLog(
      {
        userId,
        deviceMac,
        realBattery,
        recordTime: normalizeBatteryRecordTime(options.recordTime),
        source: options.source
      },
      { custom: { toast: false, catch: true } }
    );
    return true;
  } catch (error) {
    batteryLogReportCache.delete(signature);
    return false;
  }
};
