import { ref } from 'vue';
import {
  formatBatteryPercentForDisplay,
  formatBatteryStatusForDisplay,
  getRawBatteryPercent,
  isBatteryChargedLike,
  isBatteryChargingLike
} from './batteryDisplay';

const BATTERY_CACHE_KEY_PREFIX = 'qkeer:lastBattery:v1:';
const BATTERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// “充电中”是瞬时状态，不能像电量百分比一样缓存一天。超过该时间后
// 仍保留最近电量，但降级为百分比展示，等待下一次设备回包确认状态。
export const BATTERY_CHARGING_CACHE_MAX_AGE_MS = 2 * 60 * 1000;

// Storage itself is not reactive. Pages depend on this revision so a battery
// update received on one page is reflected immediately on every other page.
export const batteryDisplayCacheRevision = ref(0);

export type BatteryDisplayCacheRecord = {
  userId: string;
  mac: string;
  rawBattery: number;
  displayText: string;
  status?: string;
  isCharging: boolean;
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
  const status = item.status == null ? '' : String(item.status).trim();
  const displayText = String(item.displayText || formatBatteryStatusForDisplay(rawBattery, status, '')).trim();
  const isCharging = item.isCharging === true || displayText === '充电中' || isBatteryChargingLike(status);
  return {
    userId,
    mac,
    rawBattery: Math.round(rawBattery),
    displayText,
    status: status || undefined,
    isCharging,
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
    if (record.isCharging && Number.isFinite(age) && age > BATTERY_CHARGING_CACHE_MAX_AGE_MS) {
      return {
        ...record,
        displayText: formatBatteryPercentForDisplay(record.rawBattery, ''),
        status: 'charging_cache_expired',
        isCharging: false
      };
    }
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
  if (!key) return null;
  const charging = isBatteryChargingLike(params.battery, params.status);
  const charged = isBatteryChargedLike(params.battery, params.status);
  let rawBattery = getRawBatteryPercent(params.battery);

  // Legacy L19 uses the sentinel values 101/102 (rendered as “充电中/充电完成”)
  // instead of returning a percentage. Keep the last known percentage while
  // charging so the transient state can still be cached and shared by pages.
  // A fully charged response is safe to normalize to 100%.
  if (rawBattery == null && (charging || charged)) {
    let previous: BatteryDisplayCacheRecord | null = null;
    try {
      previous = normalizeBatteryCacheRecord(uni.getStorageSync(key));
    } catch {
      // Missing/unavailable storage should not discard a valid charge state.
    }
    rawBattery = charged ? 100 : previous?.rawBattery ?? 100;
  }
  if (rawBattery == null) return null;
  const record: BatteryDisplayCacheRecord = {
    userId: normalizeCacheKeyPart(params.userId),
    mac: normalizeCacheMacPart(params.mac),
    rawBattery: Math.round(rawBattery),
    displayText: formatBatteryStatusForDisplay(rawBattery, params.status, ''),
    status: params.status == null ? undefined : String(params.status).trim() || undefined,
    isCharging: charging,
    updatedAt: Math.floor(Number(params.nowMs || Date.now())),
    source: params.source
  };
  try {
    uni.setStorageSync(key, record);
    batteryDisplayCacheRevision.value += 1;
  } catch {
    // cache write failure must not block page rendering.
  }
  return record;
};
