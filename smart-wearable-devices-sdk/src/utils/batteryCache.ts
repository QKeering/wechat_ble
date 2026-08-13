import { formatBatteryStatusForDisplay, getRawBatteryPercent } from './batteryDisplay';

const BATTERY_CACHE_KEY_PREFIX = 'qkeer:lastBattery:v1:';
const BATTERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type BatteryDisplayCacheRecord = {
  userId: string;
  mac: string;
  rawBattery: number;
  displayText: string;
  updatedAt: number;
  source?: string;
};

const normalizeCacheKeyPart = (value: unknown) =>
  String(value || '')
    .trim()
    .toUpperCase();

const normalizeCacheMacPart = (value: unknown) => normalizeCacheKeyPart(value).replace(/[^0-9A-F]/g, '');

const buildBatteryCacheKey = (userId: unknown, mac: unknown) => {
  const normalizedUserId = normalizeCacheKeyPart(userId);
  const normalizedMac = normalizeCacheMacPart(mac);
  if (!normalizedUserId || !normalizedMac) return '';
  return `${BATTERY_CACHE_KEY_PREFIX}${normalizedUserId}:${normalizedMac}`;
};

const normalizeBatteryCacheRecord = (value: unknown): BatteryDisplayCacheRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, any>;
  const rawBattery = getRawBatteryPercent(item.rawBattery ?? item.battery);
  const userId = normalizeCacheKeyPart(item.userId);
  const mac = normalizeCacheMacPart(item.mac);
  const updatedAt = Math.floor(Number(item.updatedAt || 0));
  if (!userId || !mac || rawBattery == null || !Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  return {
    userId,
    mac,
    rawBattery: Math.round(rawBattery),
    displayText: String(item.displayText || formatBatteryStatusForDisplay(rawBattery, item.status, '')).trim(),
    updatedAt,
    source: item.source ? String(item.source) : undefined
  };
};

export const readBatteryDisplayCache = (
  userId: unknown,
  mac: unknown,
  maxAgeMs = BATTERY_CACHE_MAX_AGE_MS
): BatteryDisplayCacheRecord | null => {
  const key = buildBatteryCacheKey(userId, mac);
  if (!key) return null;
  try {
    const record = normalizeBatteryCacheRecord(uni.getStorageSync(key));
    if (!record) return null;
    const age = Date.now() - record.updatedAt;
    if (Number.isFinite(age) && age > Math.max(0, maxAgeMs)) return null;
    return record;
  } catch {
    return null;
  }
};

export const writeBatteryDisplayCache = (params: {
  userId: unknown;
  mac: unknown;
  battery: unknown;
  status?: unknown;
  source?: string;
  nowMs?: number;
}) => {
  const key = buildBatteryCacheKey(params.userId, params.mac);
  const rawBattery = getRawBatteryPercent(params.battery);
  if (!key || rawBattery == null) return null;
  const record: BatteryDisplayCacheRecord = {
    userId: normalizeCacheKeyPart(params.userId),
    mac: normalizeCacheMacPart(params.mac),
    rawBattery: Math.round(rawBattery),
    displayText: formatBatteryStatusForDisplay(rawBattery, params.status, ''),
    updatedAt: Math.floor(Number(params.nowMs || Date.now())),
    source: params.source
  };
  try {
    uni.setStorageSync(key, record);
  } catch {
    // cache write failure must not block page rendering.
  }
  return record;
};
