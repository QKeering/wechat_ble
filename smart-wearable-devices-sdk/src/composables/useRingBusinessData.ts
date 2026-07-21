import { computed, getCurrentInstance, onUnmounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useRingStore } from '@/stores';
import { isRingHistoryInProgress, resolveRingProtocol, type RingDeviceInfo } from '@/sdk/ring-ble';

const BUSINESS_DATA_STALE_MS = 120000;
const BUSINESS_DATA_FRESHNESS_INTERVAL_MS = 5000;

const isColonSeparatedBleMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());

const getCurrentBusinessDataIdentity = (device: RingDeviceInfo) => {
  if (device.mac) return device.mac;
  if (device.advertis?.macInfo) return device.advertis.macInfo;

  if (resolveRingProtocol(device) === 'rw') {
    if (isColonSeparatedBleMac(device.uniMacId)) return device.uniMacId;
    if (isColonSeparatedBleMac(device.deviceId)) return device.deviceId;
    return `${device.deviceId || ''}`.trim();
  }

  return `${device.uniMacId || device.deviceId || ''}`.trim();
};

export const useRingBusinessData = () => {
  const ringStore = useRingStore();
  const ringRefs = storeToRefs(ringStore);
  const freshnessNow = ref(Date.now());
  const freshnessTimer = setInterval(() => {
    freshnessNow.value = Date.now();
  }, BUSINESS_DATA_FRESHNESS_INTERVAL_MS);
  (freshnessTimer as any).unref?.();
  if (getCurrentInstance()) {
    onUnmounted(() => clearInterval(freshnessTimer));
  }

  const metrics = computed(() => ringRefs.latestMetrics.value);
  const healthData = computed(() => ringRefs.healthData.value);
  const isHistoryPending = computed(() => isRingHistoryInProgress(metrics.value.historyStatus));
  const isConnected = computed(() => ringRefs.isConnected.value);
  const isRefreshingOrUploading = computed(() => ringRefs.isUploading.value || ringRefs.reconnectStatus.value === 'reconnecting');
  const isReadyForBusinessPages = computed(() =>
    Boolean(
      ringRefs.deviceInfo.value.deviceId &&
        ringRefs.deviceInfo.value.serviceId &&
        ringRefs.deviceInfo.value.cmdCharId &&
        ringRefs.deviceInfo.value.dataCharId
    )
  );
  const currentDeviceName = computed(() => ringRefs.deviceInfo.value.displayName || ringRefs.deviceInfo.value.name || ringRefs.deviceInfo.value.localName || '');
  const currentDeviceIdentity = computed(() => getCurrentBusinessDataIdentity(ringRefs.deviceInfo.value));
  const currentDeviceTail = computed(() => {
    const identity = currentDeviceIdentity.value;
    if (!identity) return '-';
    return identity.length <= 8 ? identity : identity.slice(-8);
  });
  const businessDataAgeMs = computed(() => {
    const lastMetricUpdateAt = ringRefs.lastMetricUpdateAt.value || ringRefs.healthData.value.lastMetricUpdateAt || 0;
    if (!lastMetricUpdateAt) return null;
    return Math.max(0, freshnessNow.value - lastMetricUpdateAt);
  });
  const isBusinessDataStale = computed(() => businessDataAgeMs.value != null && businessDataAgeMs.value > BUSINESS_DATA_STALE_MS);
  const businessDataFreshnessText = computed(() => {
    const ageMs = businessDataAgeMs.value;
    if (ageMs == null) return '\u672a\u8bfb\u53d6';
    const elapsedSeconds = Math.max(1, Math.floor(ageMs / 1000));
    if (isBusinessDataStale.value && elapsedSeconds < 60) return `${elapsedSeconds}\u79d2\u524d\u66f4\u65b0\uff0c\u5efa\u8bae\u5237\u65b0`;
    if (elapsedSeconds < 10) return '\u521a\u521a\u66f4\u65b0';
    if (elapsedSeconds < 60) return `${elapsedSeconds}\u79d2\u524d\u66f4\u65b0`;
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (isBusinessDataStale.value) return `${elapsedMinutes}\u5206\u949f\u524d\u66f4\u65b0\uff0c\u5efa\u8bae\u5237\u65b0`;
    return `${elapsedMinutes}\u5206\u949f\u524d\u66f4\u65b0`;
  });

  return {
    metrics,
    healthData,
    isHistoryPending,
    isConnected,
    isRefreshingOrUploading,
    isReadyForBusinessPages,
    currentDeviceName,
    currentDeviceIdentity,
    currentDeviceTail,
    businessDataAgeMs,
    isBusinessDataStale,
    businessDataFreshnessText,
    deviceInfo: ringRefs.deviceInfo,
    normalizedData: ringRefs.normalizedData,
    receivedData: ringRefs.receivedData,
    devices: ringRefs.devices,
    localData: ringRefs.localData,
    historyRecords: ringRefs.historyRecords,
    normalMac: ringRefs.normalMac,
    iosMacId: ringRefs.iosMacId,
    lastMetricUpdateAt: ringRefs.lastMetricUpdateAt,
    lastReadTimestamp: ringRefs.lastReadTimestamp,
    isScanning: ringRefs.isScanning,
    isBluetoothReady: ringRefs.isBluetoothReady,
    reconnectStatus: ringRefs.reconnectStatus,
    reconnectResult: ringRefs.reconnectResult,
    uploadingStatus: ringRefs.uploadingStatus,
    updateLastReadTimestamp: ringStore.updateLastReadTimestamp
  };
};
