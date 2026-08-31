import { computed, onScopeDispose, ref, watch, type ComputedRef } from 'vue';
import { batteryDisplayCacheRevision, readBatteryDisplayCache, writeBatteryDisplayCache } from '@/utils/batteryCache';
import {
  formatBatteryStatusForDisplay,
  getRawBatteryPercent,
  isBatteryChargedLike,
  isBatteryChargingLike
} from '@/utils/batteryDisplay';
import { getBoundRingIdentity } from '@/utils/ringBinding';

type StoreLike = Record<string, any>;

const getBatteryValue = (item: Record<string, any> | null | undefined) =>
  item?.metrics?.battery ??
  item?.metrics?.batteryValue ??
  item?.metrics?.value ??
  item?.battery ??
  item?.batteryValue ??
  item?.value;

const getBatteryStatus = (item: Record<string, any> | null | undefined) =>
  item?.metrics?.chargingStatusText ??
  item?.metrics?.batteryStatus ??
  item?.metrics?.chargingStatus ??
  item?.chargingStatusText ??
  item?.chargeStatusText ??
  item?.batteryStatus ??
  item?.chargingStatus ??
  item?.status;

const normalizeObservedAt = (value: unknown) => {
  if (value == null || value === '') return 0;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric < 1e11 ? Math.floor(numeric * 1000) : Math.floor(numeric);
};

const getPacketObservedAt = (item: Record<string, any> | null | undefined) =>
  normalizeObservedAt(
    item?.collectedAt ??
      item?.receivedAt ??
      item?.timestamp ??
      item?.updatedAt ??
      item?.raw?.receivedAt ??
      item?.raw?.timestamp
  );

const MEASUREMENT_SOURCE_TYPES = new Set([
  'active_measure',
  'active_OxyGenMeasure',
  'active_Temperature',
  'qkeer_v2_health',
  'qkeer_v2_heartbeat',
  'rw_health_data'
]);

const hasMeasurementValue = (item: Record<string, any>) => {
  const metrics = item?.metrics || item;
  if (item?.sourceType === 'rw_health_data' && item?.metrics?.name) {
    return item.metrics.value != null || (Array.isArray(item.metrics.data) && item.metrics.data.length > 0);
  }
  return [
    metrics.heartRate,
    metrics.heart_rate,
    metrics.bloodOxygen,
    metrics.spo2,
    metrics.temperature,
    metrics.hrv,
    metrics.stress
  ].some((value) => value != null && value !== '');
};

const getRuntimeDataSources = (userStore: StoreLike, ringStore: StoreLike) => [
  ringStore.normalizedData || [],
  ringStore.receivedData || [],
  userStore.normalizedData || [],
  userStore.receivedData || []
];

const findLatestBatteryPacket = (userStore: StoreLike, ringStore: StoreLike) => {
  const sources = getRuntimeDataSources(userStore, ringStore);
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const item = source[index] as Record<string, any>;
      const type = item?.type || item?.dataType || item?.sourceType;
      const value = getBatteryValue(item);
      const status = getBatteryStatus(item);
      const isBatteryState = isBatteryChargingLike(value, status) || isBatteryChargedLike(value, status);
      if (type !== 'battery' && type !== 'firmware_version' && getRawBatteryPercent(value) == null && !isBatteryState) {
        continue;
      }
      if (getRawBatteryPercent(value) != null || isBatteryState) return item;
    }
  }
  return null;
};

const findLatestMeasurementObservedAt = (userStore: StoreLike, ringStore: StoreLike) => {
  let latest = 0;
  const sources = getRuntimeDataSources(userStore, ringStore);
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const rawItem of source) {
      const item = rawItem as Record<string, any>;
      const type = item?.sourceType || item?.type || item?.dataType;
      if (!MEASUREMENT_SOURCE_TYPES.has(String(type || '')) || !hasMeasurementValue(item)) continue;
      latest = Math.max(latest, getPacketObservedAt(item));
    }
  }
  return latest;
};

const firstBatteryValue = (...values: unknown[]) =>
  values.find((value) => getRawBatteryPercent(value) != null || isBatteryChargingLike(value) || isBatteryChargedLike(value));

const firstBatteryStatus = (...values: unknown[]) =>
  values.find((value) => value != null && String(value).trim() !== '');

const getUserId = (userStore: StoreLike) => {
  const info = (userStore.userInfo || {}) as Record<string, any>;
  return String(info.id || info.user_id || info.userId || info.uid || userStore.userId || 'anonymous');
};

const getMac = (userStore: StoreLike, ringStore: StoreLike) =>
  getBoundRingIdentity(ringStore.deviceInfo as Record<string, any> | null | undefined) ||
  getBoundRingIdentity(userStore.deviceInfo as Record<string, any> | null | undefined) ||
  userStore.normalMac ||
  userStore.iosMacId ||
  '';

export type UnifiedBatteryDisplay = {
  rawValue: ComputedRef<unknown>;
  rawPercent: ComputedRef<number | null>;
  status: ComputedRef<unknown>;
  displayText: ComputedRef<string>;
  isCharging: ComputedRef<boolean>;
  observedAt: ComputedRef<number>;
  userId: ComputedRef<string>;
  mac: ComputedRef<string>;
};

/**
 * Canonical battery source shared by home, mine and device-info pages.
 * Only global ring/user stores participate in source selection, so a page-local
 * stale snapshot can no longer override the value displayed on one page.
 */
export const useUnifiedBatteryDisplay = (userStore: StoreLike, ringStore: StoreLike): UnifiedBatteryDisplay => {
  const userId = computed(() => getUserId(userStore));
  const mac = computed(() => getMac(userStore, ringStore));
  const latestPacket = computed(() => findLatestBatteryPacket(userStore, ringStore));
  const batteryObservedAt = computed(() => getPacketObservedAt(latestPacket.value));
  const measurementObservedAt = computed(() => findLatestMeasurementObservedAt(userStore, ringStore));

  // Date.now() is not reactive. Without a clock dependency, an expired
  // "charging" cache remains visible forever while the user stays on the page.
  const cacheExpiryClock = ref(Date.now());
  const cacheExpiryTimer = setInterval(() => {
    cacheExpiryClock.value = Date.now();
  }, 10 * 1000);
  onScopeDispose(() => clearInterval(cacheExpiryTimer));

  const sourceValue = computed(() =>
    firstBatteryValue(
      getBatteryValue(latestPacket.value),
      ringStore.latestMetrics?.battery,
      userStore.latestMetrics?.battery,
      getBatteryValue(ringStore.deviceInfo),
      getBatteryValue(userStore.deviceInfo),
      ringStore.healthData?.battery,
      userStore.healthData?.battery
    )
  );

  const sourceStatus = computed(() =>
    firstBatteryStatus(
      getBatteryStatus(latestPacket.value),
      ringStore.latestMetrics?.chargingStatusText,
      ringStore.latestMetrics?.batteryStatus,
      ringStore.latestMetrics?.chargingStatus,
      userStore.latestMetrics?.chargingStatusText,
      userStore.latestMetrics?.batteryStatus,
      userStore.latestMetrics?.chargingStatus,
      getBatteryStatus(ringStore.deviceInfo),
      getBatteryStatus(userStore.deviceInfo),
      ringStore.healthData?.chargingStatusText,
      ringStore.healthData?.batteryStatus,
      userStore.healthData?.chargingStatusText,
      userStore.healthData?.batteryStatus
    )
  );

  // 戒指在充电座上无法执行佩戴测量。如果在“充电中”回包之后又收到有效
  // 实时测量数据，可以确定戒指已经离开充电器，立即清除旧充电状态。
  const chargingSupersededByMeasurement = computed(
    () =>
      isBatteryChargingLike(sourceValue.value, sourceStatus.value) &&
      measurementObservedAt.value > 0 &&
      (batteryObservedAt.value <= 0 || measurementObservedAt.value > batteryObservedAt.value)
  );
  const runtimeStatus = computed(() => (chargingSupersededByMeasurement.value ? '未充电' : sourceStatus.value));

  const cacheRecord = computed(() => {
    void batteryDisplayCacheRevision.value;
    void cacheExpiryClock.value;
    return readBatteryDisplayCache(userId.value, mac.value);
  });
  // Expose the freshest passive/active battery observation so pages can use
  // the command as a low-frequency fallback instead of polling on every show.
  const observedAt = computed(() => Math.max(batteryObservedAt.value, Number(cacheRecord.value?.updatedAt || 0)));
  const status = computed(() => {
    if (chargingSupersededByMeasurement.value || cacheRecord.value?.status === 'charging_cache_expired') return '未充电';
    return runtimeStatus.value;
  });

  watch(
    () => {
      const percent = getRawBatteryPercent(sourceValue.value);
      const hasStateOnlyValue =
        isBatteryChargingLike(sourceValue.value, status.value) || isBatteryChargedLike(sourceValue.value, status.value);
      const observedAt = chargingSupersededByMeasurement.value ? measurementObservedAt.value : batteryObservedAt.value;
      return (percent == null && !hasStateOnlyValue) || !mac.value || observedAt <= 0
        ? ''
        : `${userId.value}|${mac.value}|${percent == null ? String(sourceValue.value || '') : Math.round(percent)}|${String(
            status.value || ''
          )}|${observedAt}`;
    },
    (signature) => {
      if (!signature) return;
      writeBatteryDisplayCache({
        userId: userId.value,
        mac: mac.value,
        battery: sourceValue.value,
        status: status.value,
        source: chargingSupersededByMeasurement.value ? 'measurement-cleared-charging' : 'unified-battery-display',
        nowMs: chargingSupersededByMeasurement.value ? measurementObservedAt.value : batteryObservedAt.value
      });
    },
    { immediate: true }
  );

  const rawValue = computed(() => cacheRecord.value?.rawBattery ?? sourceValue.value);
  const rawPercent = computed(() => getRawBatteryPercent(rawValue.value));
  const displayText = computed(
    () => cacheRecord.value?.displayText || formatBatteryStatusForDisplay(sourceValue.value, status.value, '')
  );
  const isCharging = computed(() =>
    chargingSupersededByMeasurement.value
      ? false
      : cacheRecord.value
      ? cacheRecord.value.isCharging
      : displayText.value === '充电中' || isBatteryChargingLike(sourceValue.value, status.value)
  );

  return { rawValue, rawPercent, status, displayText, isCharging, observedAt, userId, mac };
};
