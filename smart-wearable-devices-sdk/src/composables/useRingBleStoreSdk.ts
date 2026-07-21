import { effectScope, watch } from 'vue';
import { bindRingDevice, getBoundRingDevice, unbindRingDevice, uploadRingHistoryRecords } from '@/api';
import { useRingStore } from '@/stores';
import { isSameRingDevice, useRingBleSdk, type UseRingBleSdkOptions } from './useRingBleSdk';
import type { RingDeviceInfo, RingParsedData } from '@/sdk/ring-ble';
import { getRwHistoryDataType, parseRwFileTimestamp } from '@/sdk/ring-ble/rw';

const hasCustomOptions = (options: UseRingBleSdkOptions) => Object.keys(options).length > 0;
let defaultStoreSdk: ReturnType<typeof createRingBleStoreSdk> | null = null;

const enrichLocalDataRecord = (
  record: Record<string, any>,
  parsed: RingParsedData,
  device: RingDeviceInfo,
  extra: Record<string, any> = {}
) => {
  const protocol = record.protocol || parsed.protocol || device.protocol;
  const stableIdentity =
    protocol === 'rw'
      ? getRwStableRecordIdentity(record, parsed, device)
      : record.uniMacId || parsed.uniMacId || device.uniMacId;
  return {
    ...record,
    ...extra,
    protocol,
    sourceType: record.sourceType || parsed.type,
    deviceId: record.deviceId || parsed.deviceId || device.deviceId,
    deviceName: record.deviceName || parsed.deviceName || device.name,
    uniMacId: stableIdentity,
    mac: record.mac || parsed.mac || device.mac || device.advertis?.macInfo || (protocol === 'rw' ? stableIdentity : ''),
    advertis: record.advertis || parsed.advertis || device.advertis
  };
};

const getRwStableRecordIdentity = (
  record: Record<string, any>,
  parsed: RingParsedData,
  device: RingDeviceInfo
) =>
  record.mac ||
  record.advertis?.macInfo ||
  parsed.mac ||
  parsed.advertis?.macInfo ||
  device.mac ||
  device.advertis?.macInfo ||
  (isColonSeparatedBleMac(record.uniMacId) ? record.uniMacId : '') ||
  (isColonSeparatedBleMac(parsed.uniMacId) ? parsed.uniMacId : '') ||
  (isColonSeparatedBleMac(device.uniMacId) ? device.uniMacId : '');

const getStableRecordDeviceKey = (record: Record<string, any>) => {
  const stableIdentity = record.mac || record.advertis?.macInfo;
  if (stableIdentity) return normalizeRecordIdentity(stableIdentity) || String(stableIdentity).trim();

  if (record.protocol === 'rw') {
    const legacyStableIdentity = isColonSeparatedBleMac(record.uniMacId) ? record.uniMacId : isColonSeparatedBleMac(record.deviceId) ? record.deviceId : '';
    if (legacyStableIdentity) return normalizeRecordIdentity(legacyStableIdentity) || String(legacyStableIdentity).trim();
    return String(record.deviceId || record.uniMacId || '').trim();
  }

  const fallbackIdentity = record.uniMacId || record.deviceId || '';
  return normalizeRecordIdentity(fallbackIdentity) || String(fallbackIdentity).trim();
};

const normalizeRecordIdentity = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  return hex.length >= 6 && hex.length % 2 === 0 ? hex : '';
};

const isColonSeparatedBleMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());

const getLocalDataNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (value == null || value === '') continue;
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
};

const parseLocalDataRecordTime = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const timestamp = Date.parse(value.trim().replace(/-/g, '/'));
  if (!Number.isFinite(timestamp)) return 0;
  return Math.floor(timestamp / 1000);
};

const getLocalDataRecordTime = (record: Record<string, any>) => {
  const value =
    getLocalDataNumber(record.unixTime, record.timestamp, record.startTimestamp, record.recordTimestamp) ||
    parseLocalDataRecordTime(record.recordTime);
  if (!value || value <= 0) return 0;
  return value > 100000000000 ? Math.floor(value / 1000) : Math.floor(value);
};

const getLocalDataRecordKey = (record: Record<string, any>) => {
  const protocol = record.protocol || '';
  const deviceKey = getStableRecordDeviceKey(record);
  const recordTime = getLocalDataRecordTime(record);
  if (recordTime && record.dataType) return `${protocol}:${deviceKey}:time:${record.dataType}:${recordTime}`;
  if (record.seq != null && record.fileName) return `${protocol}:${deviceKey}:seq:${record.seq}:${record.fileName}`;
  if (record.fileName) return `${protocol}:${deviceKey}:file:${record.fileName}`;
  return '';
};

const getLocalDataFileKey = (record: Record<string, any>) => {
  const protocol = record.protocol || '';
  const deviceKey = getStableRecordDeviceKey(record);
  if (record.seq == null || !record.fileName) return '';
  return `${protocol}:${deviceKey}:file-seq:${record.seq}:${record.fileName}`;
};

const getRawRecordDeviceIdentityValues = (record: Record<string, any>) =>
  [record.deviceId, record.uniMacId, record.mac, record.advertis?.macInfo].filter(Boolean);

const getStableRecordDeviceIdentityValues = (record: Record<string, any>, protocolHint = '') => {
  const protocol = record.protocol || protocolHint;
  if (protocol === 'rw') {
    return [
      record.mac,
      record.advertis?.macInfo,
      isColonSeparatedBleMac(record.uniMacId) ? record.uniMacId : '',
      isColonSeparatedBleMac(record.deviceId) ? record.deviceId : ''
    ].filter(Boolean);
  }
  return getRawRecordDeviceIdentityValues(record);
};

const getRecordDeviceIdentityScope = (record: Record<string, any>, protocolHint = '') => ({
  ids: getStableRecordDeviceIdentityValues(record, protocolHint),
  hadIdentity: getRawRecordDeviceIdentityValues(record).length > 0
});

const hasMatchingStableRecordIdentity = (leftIds: unknown[], rightIds: unknown[]) => {
  const leftRaw = leftIds.map((value) => String(value || '').trim()).filter(Boolean);
  const rightRaw = rightIds.map((value) => String(value || '').trim()).filter(Boolean);
  if (leftRaw.some((left) => rightRaw.includes(left))) return true;

  const leftNormalized = leftRaw.map(normalizeRecordIdentity).filter((value) => value.length >= 6);
  const rightNormalized = rightRaw.map(normalizeRecordIdentity).filter((value) => value.length >= 6);
  return leftNormalized.some((left) =>
    rightNormalized.some((right) => left.endsWith(right.slice(-6)) || right.endsWith(left.slice(-6)))
  );
};

const hasRecordDeviceIdentity = (record: Record<string, any>) => getRawRecordDeviceIdentityValues(record).length > 0;

const isRecordForCurrentDevice = (record: Record<string, any>, currentDevice: RingDeviceInfo) => {
  if (record.protocol && currentDevice.protocol && record.protocol !== currentDevice.protocol && hasRecordDeviceIdentity(record)) {
    return false;
  }
  if (!hasRecordDeviceIdentity(record)) return true;
  if (!hasRecordDeviceIdentity(currentDevice)) return true;

  const recordScope = getRecordDeviceIdentityScope(record, currentDevice.protocol);
  const currentScope = getRecordDeviceIdentityScope(currentDevice, record.protocol);
  const isRwScope = record.protocol === 'rw' || currentDevice.protocol === 'rw';
  if (isRwScope) {
    if (recordScope.hadIdentity && recordScope.ids.length === 0) return false;
    if (currentScope.hadIdentity && currentScope.ids.length === 0 && recordScope.ids.length > 0) return false;
    if (recordScope.ids.length === 0 || currentScope.ids.length === 0) return true;
    return hasMatchingStableRecordIdentity(recordScope.ids, currentScope.ids);
  }

  return isSameRingDevice(currentDevice, {
    deviceId: record.deviceId,
    uniMacId: record.uniMacId,
    mac: record.mac || record.advertis?.macInfo,
    protocol: record.protocol
  });
};

const getLocalDataRecordScore = (record: Record<string, any>) => {
  let score = 0;
  if (record.sourceType === 'local_data' || record.sourceType === 'rw_upload_file') score += 20;
  if (record.status && record.status !== 'pending_upload_payload') score += 8;
  if (record.status === 'pending_upload_payload') score -= 5;
  if (record.payloadHex || record.records || record.value != null) score += 5;
  if (record.dataType && record.dataType !== 'history_file') score += 3;
  if (getLocalDataRecordTime(record)) score += 1;
  return score;
};

const dedupeLocalDataRecords = (records: Array<Record<string, any>>) => {
  const keyed = new Map<string, Record<string, any>>();
  const unkeyed: Array<Record<string, any>> = [];
  const resolvedFileKeys = new Set(
    records
      .filter(
        (record) =>
          (record.sourceType === 'local_data' || record.sourceType === 'rw_upload_file') &&
          record.status !== 'pending_upload_payload'
      )
      .map(getLocalDataFileKey)
      .filter(Boolean)
  );

  for (const record of records) {
    if (
      resolvedFileKeys.has(getLocalDataFileKey(record)) &&
      (record.sourceType === 'rw_file_list' || record.status === 'pending_upload_payload')
    ) {
      continue;
    }

    const key = getLocalDataRecordKey(record);
    if (!key) {
      unkeyed.push(record);
      continue;
    }

    const existing = keyed.get(key);
    if (!existing || getLocalDataRecordScore(record) >= getLocalDataRecordScore(existing)) {
      keyed.set(key, record);
    }
  }

  return [...unkeyed, ...Array.from(keyed.values())].sort((left, right) => {
    return getLocalDataRecordTime(right) - getLocalDataRecordTime(left);
  });
};

const isLocalDataResetPacket = (item: Record<string, any>, currentDevice: RingDeviceInfo) => {
  if (!isRecordForCurrentDevice(item, currentDevice)) return false;
  if (getLocalDataResetType(item)) return false;
  if (item.type === 'local_data') return ['no_data', 'empty', 'filtered'].includes(item.status);
  if (item.type !== 'rw_file_list') return false;
  return Array.isArray(item.selectedFiles) && item.selectedFiles.length === 0;
};

const getLocalDataResetType = (item: Record<string, any>) => {
  if (item.type === 'local_data' && ['no_data', 'empty', 'filtered'].includes(item.status)) {
    return normalizeHistoryDataType(item.dataType || item.rawDataType || item.fileType);
  }
  if (item.type === 'rw_file_list' && Array.isArray(item.selectedFiles) && item.selectedFiles.length === 0) {
    return normalizeHistoryDataType(item.dataType || item.rawDataType || item.fileType);
  }
  return '';
};

const getLocalDataSourceAfterLastReset = (items: RingParsedData[], currentDevice: RingDeviceInfo) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (isLocalDataResetPacket(items[index] as Record<string, any>, currentDevice)) {
      return items.slice(index + 1);
    }
  }
  return items;
};

const getLocalDataResetTypes = (items: RingParsedData[], currentDevice: RingDeviceInfo) => {
  const latestResetIndex = new Map<string, number>();
  const latestRecordIndex = new Map<string, number>();

  items.forEach((item, index) => {
    if (!isRecordForCurrentDevice(item, currentDevice)) return;

    const resetType = getLocalDataResetType(item as Record<string, any>);
    if (resetType) {
      latestResetIndex.set(resetType, index);
      return;
    }

    for (const recordType of getLocalDataRecordTypesForItem(item as Record<string, any>)) {
      latestRecordIndex.set(recordType, index);
    }
  });

  return new Set(
    [...latestResetIndex.entries()]
      .filter(([type, resetIndex]) => resetIndex > (latestRecordIndex.get(type) ?? -1))
      .map(([type]) => type)
  );
};

const getLocalDataRecordNormalizedType = (record: Record<string, any>) =>
  normalizeHistoryDataType(record.dataType || record.rawDataType || record.fileType || record.metricType);

const getLocalDataRecordTypesForItem = (item: Record<string, any>) => {
  if (item.type === 'local_data' && Array.isArray(item.records)) {
    return item.records
      .map((record: Record<string, any>) =>
        normalizeHistoryDataType(record.dataType || record.rawDataType || record.fileType || record.metricType || item.dataType)
      )
      .filter(Boolean);
  }
  if (item.type === 'qkeer_v2_health_list') return ['vital'];
  if (item.type === 'qkeer_v2_step_list') return ['step'];
  if (item.type === 'qkeer_v2_sleep_list') return ['sleep'];
  if (item.type === 'rw_file_list' && (Array.isArray(item.selectedFiles) || Array.isArray(item.files))) {
    const files = Array.isArray(item.selectedFiles) ? item.selectedFiles : item.files;
    return files
      .map((record: Record<string, any>) => normalizeHistoryDataType(getRwHistoryDataType(record.fileType, record.fileName)))
      .filter(Boolean);
  }
  if (item.type === 'rw_upload_file') {
    return [normalizeHistoryDataType(getRwHistoryDataType(item.fileType, item.fileName))].filter(Boolean);
  }
  return [];
};

const normalizeHistoryDataType = (value: unknown) => {
  const normalized = `${value || ''}`.trim().replace(/-/g, '_').toLowerCase();
  const compact = normalized.replace(/[_\s]/g, '');
  if (!compact) return '';
  if (compact === 'vital' || compact === 'vitals' || compact === 'health' || compact === 'healthdata' || compact === 'dailyhealth') return 'vital';
  if (compact === 'sleep' || compact === 'sleepdata' || compact === 'sleepdetail' || compact === 'sleepdetails') return 'sleep';
  if (compact === 'step' || compact === 'steps' || compact === 'stepcount' || compact === 'sport' || compact === 'activity' || compact === 'dailyactivity') {
    return 'step';
  }
  if (compact === 'hr' || compact === 'heartrate' || compact === 'heartrateraw') return 'heart_rate';
  if (compact === 'spo2' || compact === 'bloodoxygen' || compact === 'bloodoxygenraw' || compact === 'oxygen') return 'blood_oxygen';
  if (compact === 'bodytemperature' || compact === 'bodytemp' || compact === 'skintemperature' || compact === 'skintemp' || compact === 'temperature') {
    return 'temperature';
  }
  if (compact === 'bp' || compact === 'bloodpressure') return 'blood_pressure';
  if (compact === 'bs' || compact === 'glucose' || compact === 'bloodsugar') return 'blood_sugar';
  return normalized;
};

export const useRingBleStoreSdk = (options: UseRingBleSdkOptions = {}) => {
  if (!hasCustomOptions(options)) {
    if (!defaultStoreSdk) {
      defaultStoreSdk = createRingBleStoreSdk(options);
    }
    return defaultStoreSdk;
  }

  return createRingBleStoreSdk(options);
};

const createRingBleStoreSdk = (options: UseRingBleSdkOptions = {}) => {
  const ringStore = useRingStore();

  const sdk = useRingBleSdk({
    ...options,
    getBoundDevice: async () => {
      const device = await (options.getBoundDevice ? options.getBoundDevice() : getBoundRingDevice());
      ringStore.setBoundDevice(device || null);
      return device;
    },
    bindDevice: async (payload) => {
      const device = await (options.bindDevice ? options.bindDevice(payload) : bindRingDevice(payload));
      ringStore.setBoundDevice(device as any);
      return device;
    },
    unbindDevice: async (payload) => {
      const result = await (options.unbindDevice ? options.unbindDevice(payload) : unbindRingDevice(payload));
      ringStore.setBoundDevice(null);
      return result;
    },
    uploadHistoricalRecords: async (records, parsed) => {
      const result = await (options.uploadHistoricalRecords
        ? options.uploadHistoricalRecords(records, parsed)
        : uploadRingHistoryRecords(records, parsed));
      ringStore.appendHistoryRecords(records);
      return result;
    }
  });

  const storeSyncScope = effectScope(true);
  storeSyncScope.run(() => {
  watch(sdk.devices, (value) => ringStore.setDevices(value), { deep: true, immediate: true });
  watch(
    sdk.deviceInfo,
    (value) => {
      ringStore.setDeviceInfo(value);
      const stableMac = value.mac || value.advertis?.macInfo;
      const shouldSyncStoredIdentity = (storedIdentity?: string) =>
        Boolean(
          stableMac &&
            (!storedIdentity || !isSameRingDevice({ mac: storedIdentity, protocol: value.protocol }, { ...value, mac: stableMac }))
        );

      if (shouldSyncStoredIdentity(ringStore.normalMac)) {
        ringStore.setNormalMac(stableMac);
      }
      if (value.protocol === 'rw' && shouldSyncStoredIdentity(ringStore.iosMacId)) {
        ringStore.setIosMacId(stableMac);
      }
    },
    { deep: true, immediate: true }
  );
  watch(sdk.receivedData, (value) => ringStore.setReceivedData(value), { deep: true, immediate: true });
  watch(
    sdk.receivedData,
    (value) => {
      const currentDevice = sdk.deviceInfo.value;
      const localDataSource = getLocalDataSourceAfterLastReset(value, currentDevice);
      const localDataRecords: Array<Record<string, any>> = localDataSource.flatMap((item) => {
        if (!isRecordForCurrentDevice(item, currentDevice)) return [];

        if (item.type === 'local_data' && Array.isArray(item.records)) {
          return item.records.map((record) => enrichLocalDataRecord(record, item, currentDevice));
        }
        if (item.type === 'qkeer_v2_step_list' && Array.isArray(item.records)) {
          return item.records.map((record) => enrichLocalDataRecord(record, item, currentDevice, { dataType: 'step' }));
        }
        if (item.type === 'qkeer_v2_health_list' && Array.isArray(item.records)) {
          return item.records.map((record) => enrichLocalDataRecord(record, item, currentDevice, { dataType: 'vital' }));
        }
        if (item.type === 'qkeer_v2_sleep_list' && Array.isArray(item.records)) {
          return item.records.map((record) => enrichLocalDataRecord(record, item, currentDevice, { dataType: 'sleep' }));
        }
        if (item.type === 'rw_file_list' && (Array.isArray(item.selectedFiles) || Array.isArray(item.files))) {
          const files = Array.isArray(item.selectedFiles) ? item.selectedFiles : item.files;
          return files.map((record: Record<string, any>) =>
            enrichLocalDataRecord(record, item, currentDevice, {
              dataType: getRwHistoryDataType(record.fileType, record.fileName),
              rawDataType: record.fileType || '',
              unixTime: record.unixTime || parseRwFileTimestamp(record.timestampText)
            })
          );
        }
        if (item.type === 'rw_upload_file') {
          const records = Array.isArray(item.records) ? item.records : [];
          const dataType = getRwHistoryDataType(item.fileType, item.fileName);
          const fileUnixTime = item.startTimestamp || parseRwFileTimestamp(item.timestampText);
          if (records.length > 0) {
            return records.map((record) =>
              enrichLocalDataRecord(record, item, currentDevice, {
                dataType,
                rawDataType: item.fileType || '',
                fileName: item.fileName,
                seq: record.seq ?? item.seq,
                fileSeq: item.seq,
                status: item.status,
                unixTime: getLocalDataRecordTime(record) || fileUnixTime
              })
            );
          }
          return [
            enrichLocalDataRecord(item, item, currentDevice, {
              dataType,
              rawDataType: item.fileType || '',
              unixTime: fileUnixTime
            })
          ];
        }
        return [];
      });
      const resetTypes = getLocalDataResetTypes(localDataSource, currentDevice);
      const dedupedLocalDataRecords = dedupeLocalDataRecords(localDataRecords).filter(
        (record) => !resetTypes.has(getLocalDataRecordNormalizedType(record))
      );
      ringStore.setLocalData(dedupedLocalDataRecords);

      const latestUnixTime = dedupedLocalDataRecords.reduce((latest, record) => {
        const unixTime = getLocalDataRecordTime(record);
        return unixTime > latest ? unixTime : latest;
      }, 0);

      if (latestUnixTime > 0) {
        ringStore.setLastReadTimestamp(latestUnixTime);
      }
    },
    { deep: true, immediate: true }
  );
  watch(sdk.normalizedData, (value) => ringStore.setNormalizedData(value), { deep: true, immediate: true });
  watch(sdk.isScanning, (value) => ringStore.setScanning(value), { immediate: true });
  watch(sdk.isBluetoothReady, (value) => ringStore.setBluetoothReady(value), { immediate: true });
  watch(sdk.reconnectStatus, (value) => ringStore.setReconnectStatus(value), { immediate: true });
  watch(sdk.reconnectResult, (value) => ringStore.setReconnectResult(value), { immediate: true });
  watch(sdk.uploadingStatus, (value) => ringStore.setUploadingStatus(value), { immediate: true });
  });

  const clearData = () => {
    sdk.clearData();
    ringStore.clearBusinessRuntimeData();
  };

  const syncCurrentDeviceInfoBeforeRefresh = () => {
    const currentDevice = sdk.deviceInfo.value;
    if (currentDevice.deviceId && !isSameRingDevice(ringStore.deviceInfo, currentDevice)) {
      ringStore.clearBusinessRuntimeData();
    }
    ringStore.setDeviceInfo(currentDevice);
  };

  const refreshBusinessMetrics: typeof sdk.refreshBusinessMetrics = (...args) => {
    syncCurrentDeviceInfoBeforeRefresh();
    return sdk.refreshBusinessMetrics(...args);
  };

  const disconnect = async () => {
    const result = await sdk.disconnect();
    ringStore.clearRuntime();
    return result;
  };

  const unbind = async () => {
    const result = await sdk.unbind();
    ringStore.setBoundDevice(null);
    ringStore.clearRuntime();
    return result;
  };

  const cleanup = async () => {
    storeSyncScope.stop();
    await sdk.cleanup();
    ringStore.clearRuntime();
  };

  return {
    ...sdk,
    get adapter() {
      return sdk.adapter;
    },
    ringStore,
    clearData,
    refreshBusinessMetrics,
    disconnect,
    unbind,
    cleanup
  };
};
