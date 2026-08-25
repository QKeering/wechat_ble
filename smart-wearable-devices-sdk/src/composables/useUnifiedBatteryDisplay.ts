import { computed, watch, type ComputedRef } from 'vue';
import { batteryDisplayCacheRevision, readBatteryDisplayCache, writeBatteryDisplayCache } from '@/utils/batteryCache';
import {
  formatBatteryStatusForDisplay,
  getRawBatteryPercent,
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

const findLatestBatteryPacket = (userStore: StoreLike) => {
  const sources = [userStore.normalizedData || [], userStore.receivedData || []];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const item = source[index] as Record<string, any>;
      const type = item?.type || item?.dataType || item?.sourceType;
      if (type !== 'battery' && type !== 'firmware_version') continue;
      const value = getBatteryValue(item);
      const status = getBatteryStatus(item);
      if (getRawBatteryPercent(value) != null || isBatteryChargingLike(value, status)) return item;
    }
  }
  return null;
};

const firstBatteryValue = (...values: unknown[]) =>
  values.find((value) => getRawBatteryPercent(value) != null || isBatteryChargingLike(value));

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
  const latestPacket = computed(() => findLatestBatteryPacket(userStore));

  const sourceValue = computed(() =>
    firstBatteryValue(
      getBatteryValue(latestPacket.value),
      getBatteryValue(ringStore.deviceInfo),
      getBatteryValue(userStore.deviceInfo),
      ringStore.latestMetrics?.battery,
      userStore.latestMetrics?.battery,
      ringStore.healthData?.battery,
      userStore.healthData?.battery
    )
  );

  const status = computed(() =>
    firstBatteryStatus(
      getBatteryStatus(latestPacket.value),
      getBatteryStatus(ringStore.deviceInfo),
      getBatteryStatus(userStore.deviceInfo),
      ringStore.latestMetrics?.chargingStatusText,
      ringStore.latestMetrics?.batteryStatus,
      userStore.latestMetrics?.chargingStatusText,
      userStore.latestMetrics?.batteryStatus,
      ringStore.healthData?.chargingStatusText,
      ringStore.healthData?.batteryStatus,
      userStore.healthData?.chargingStatusText,
      userStore.healthData?.batteryStatus
    )
  );

  watch(
    () => {
      const percent = getRawBatteryPercent(sourceValue.value);
      return percent == null || !mac.value ? '' : `${userId.value}|${mac.value}|${Math.round(percent)}|${String(status.value || '')}`;
    },
    (signature) => {
      if (!signature) return;
      writeBatteryDisplayCache({
        userId: userId.value,
        mac: mac.value,
        battery: sourceValue.value,
        status: status.value,
        source: 'unified-battery-display'
      });
    },
    { immediate: true }
  );

  const cacheRecord = computed(() => {
    void batteryDisplayCacheRevision.value;
    return readBatteryDisplayCache(userId.value, mac.value);
  });
  const rawValue = computed(() => cacheRecord.value?.rawBattery ?? sourceValue.value);
  const rawPercent = computed(() => getRawBatteryPercent(rawValue.value));
  const displayText = computed(
    () => cacheRecord.value?.displayText || formatBatteryStatusForDisplay(sourceValue.value, status.value, '')
  );
  const isCharging = computed(
    () => displayText.value === '充电中' || isBatteryChargingLike(sourceValue.value, status.value)
  );

  return { rawValue, rawPercent, status, displayText, isCharging, userId, mac };
};
