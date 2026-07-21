import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

(globalThis as any).uni = {
  getSystemInfoSync: () => ({ platform: 'android', system: 'Android 14' }),
  onBLEConnectionStateChange: () => undefined,
  offBLEConnectionStateChange: () => undefined,
  getStorageSync: () => '',
  setStorageSync: () => undefined,
  removeStorageSync: () => undefined
};

setActivePinia(createPinia());

const { useRingStore } = await import('@/stores');
const { useRingBusinessData } = await import('./useRingBusinessData');

const ringStore = useRingStore();
const businessData = useRingBusinessData();
const returnedDataText = '\u5df2\u8fd4\u56de\u6570\u636e';

ringStore.updateDeviceInfo({
  deviceId: 'rw-device',
  uniMacId: 'ios-random-uuid',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  name: 'SY03',
  advertis: {
    macInfo: '00:05:1B'
  }
} as any);
ringStore.setDevices([{ deviceId: 'rw-device', name: 'SY03', protocol: 'rw' }] as any);
ringStore.setNormalMac('00:05:1B');
ringStore.setIosMacId('ios-mac-id');
ringStore.setBluetoothReady(true);
ringStore.setScanning(true);
// Ready communication fields mean the device is connected; stale reconnecting UI state must not override it.
ringStore.setReconnectStatus('reconnecting');
ringStore.setUploadingStatus('uploading');
ringStore.setLocalData([{ dataType: 'heart_rate', unixTime: 1710000000 }] as any);
ringStore.appendHistoryRecords([{ dataType: 'sleep', unixTime: 1710000300 }] as any);
ringStore.setLastReadTimestamp(1710000300);

if (
  !businessData.isReadyForBusinessPages.value ||
  !businessData.isConnected.value ||
  !businessData.isRefreshingOrUploading.value ||
  businessData.deviceInfo.value.deviceId !== 'rw-device' ||
  businessData.currentDeviceName.value !== 'SY03' ||
  businessData.currentDeviceIdentity.value !== '00:05:1B' ||
  businessData.currentDeviceTail.value !== '00:05:1B' ||
  businessData.devices.value.length !== 1 ||
  businessData.normalMac.value !== '00:05:1B' ||
  businessData.iosMacId.value !== 'ios-mac-id' ||
  !businessData.isBluetoothReady.value ||
  !businessData.isScanning.value ||
  businessData.reconnectStatus.value !== 'success' ||
  businessData.uploadingStatus.value !== 'uploading' ||
  businessData.localData.value.length === 0 ||
  businessData.historyRecords.value.length === 0 ||
  businessData.lastReadTimestamp.value !== 1710000300
) {
  throw new Error(
    `Business data should expose live business refs: ${JSON.stringify({
      isReady: businessData.isReadyForBusinessPages.value,
      isConnected: businessData.isConnected.value,
      isRefreshingOrUploading: businessData.isRefreshingOrUploading.value,
      deviceInfo: businessData.deviceInfo.value,
      currentDeviceName: businessData.currentDeviceName.value,
      currentDeviceIdentity: businessData.currentDeviceIdentity.value,
      currentDeviceTail: businessData.currentDeviceTail.value,
      devices: businessData.devices.value,
      normalMac: businessData.normalMac.value,
      iosMacId: businessData.iosMacId.value,
      isBluetoothReady: businessData.isBluetoothReady.value,
      isScanning: businessData.isScanning.value,
      reconnectStatus: businessData.reconnectStatus.value,
      uploadingStatus: businessData.uploadingStatus.value,
      localData: businessData.localData.value,
      historyRecords: businessData.historyRecords.value,
      lastReadTimestamp: businessData.lastReadTimestamp.value
    })}`
  );
}

ringStore.updateDeviceInfo({
  deviceId: 'rw-platform-id',
  uniMacId: 'B09FBA121E1C',
  protocol: 'rw',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  name: 'SY03'
} as any);
await nextTick();
if (businessData.currentDeviceIdentity.value !== 'rw-platform-id' || businessData.currentDeviceTail.value !== 'tform-id') {
  throw new Error(
    `Business data should use RW platform deviceId as the non-stable display fallback: ${JSON.stringify({
      identity: businessData.currentDeviceIdentity.value,
      tail: businessData.currentDeviceTail.value
    })}`
  );
}

ringStore.updateDeviceInfo({
  uniMacId: 'B09FBA121E1C',
  protocol: 'rw',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  name: 'SY03'
} as any);
await nextTick();
if (businessData.currentDeviceIdentity.value !== '' || businessData.currentDeviceTail.value !== '-') {
  throw new Error(
    `Business data should not expose random RW uniMacId as the current device identity: ${JSON.stringify({
      identity: businessData.currentDeviceIdentity.value,
      tail: businessData.currentDeviceTail.value
    })}`
  );
}

ringStore.setNormalizedData([
  {
    sourceType: 'rw_file_list',
    metrics: {
      files: [{ fileName: '001_20260101000000_hr.txt' }],
      totalFileCount: 1,
      selectedFileCount: 1
    }
  }
] as any);
await nextTick();
if (!businessData.isHistoryPending.value) {
  throw new Error(`Business data should treat RW file-list transfer as pending: ${businessData.metrics.value.historyStatus}`);
}

ringStore.setNormalizedData([
  {
    sourceType: 'rw_file_list',
    metrics: {
      files: [{ fileName: '001_20260101000000_hr.txt' }],
      totalFileCount: 1,
      selectedFileCount: 0,
      filteredFileCount: 1
    }
  }
] as any);
await nextTick();
if (businessData.isHistoryPending.value) {
  throw new Error(`Business data should not treat RW filtered history as pending: ${businessData.metrics.value.historyStatus}`);
}

ringStore.updateDeviceInfo({
  deviceId: 'rw-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '',
  dataCharId: '',
  name: 'SY03'
} as any);
await nextTick();
if (businessData.isReadyForBusinessPages.value || businessData.isConnected.value) {
  throw new Error('Business data should not expose a half-discovered BLE device as ready or connected.');
}
ringStore.updateDeviceInfo({
  deviceId: 'rw-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  name: 'SY03',
  advertis: {
    macInfo: '00:05:1B'
  }
} as any);
await nextTick();

ringStore.setNormalizedData([
  {
    sourceType: 'rw_health_data',
    metrics: {
      type: 'rw_health_data',
      name: 'heart_rate',
      value: 68
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      type: 'rw_health_data',
      name: 'blood_oxygen',
      value: 98
    }
  }
]);
ringStore.updateReceivedData([{ type: 'battery', value: 80 } as any]);
await nextTick();

if (
  businessData.metrics.value.heartRate !== 68 ||
  businessData.healthData.value.heart_rate !== 68 ||
  businessData.healthData.value.oxygen !== 98 ||
  businessData.businessDataAgeMs.value == null ||
  businessData.businessDataFreshnessText.value === '未读取' ||
  businessData.isBusinessDataStale.value ||
  businessData.receivedData.value.length !== 1
) {
  throw new Error(
    `Business data should expose live health refs: ${JSON.stringify({
      metrics: businessData.metrics.value,
      healthData: businessData.healthData.value,
      businessDataAgeMs: businessData.businessDataAgeMs.value,
      businessDataFreshnessText: businessData.businessDataFreshnessText.value,
      isBusinessDataStale: businessData.isBusinessDataStale.value,
      receivedData: businessData.receivedData.value
    })}`
  );
}

ringStore.setNormalizedData([
  {
    sourceType: 'battery',
    metrics: {
      battery: 56,
      batteryStatus: 'normal'
    }
  },
  {
    sourceType: 'firmware_version',
    metrics: {
      firmwareVersion: '2.2.9',
      hardwareVersion: '2.2.9',
      softwareVersion: '303e0001',
      uiVersion: '303e0001'
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'heart_rate',
      value: 70,
      data: [70]
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'blood_oxygen',
      value: 97,
      data: [97]
    }
  }
]);
await nextTick();

ringStore.setNormalizedData([
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'heart_rate',
      status: 'requested',
      message: 'requested'
    }
  },
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'blood_oxygen',
      status: 'pending',
      message: 'pending'
    }
  },
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'temperature',
      status: 'pending',
      message: 'pending'
    }
  }
]);
await nextTick();

if (
  Number(businessData.metrics.value.battery) !== 56 ||
  businessData.metrics.value.firmwareVersion !== '2.2.9' ||
  Number(businessData.metrics.value.heartRate) !== 70 ||
  Number(businessData.metrics.value.bloodOxygen) !== 97 ||
  businessData.metrics.value.heartRateStatus !== returnedDataText ||
  businessData.metrics.value.bloodOxygenStatus !== returnedDataText ||
  businessData.metrics.value.temperatureStatus !== 'pending'
) {
  throw new Error(
    `Business data should keep the last valid SY03 metrics while new realtime values are pending: ${JSON.stringify({
      metrics: businessData.metrics.value,
      healthData: businessData.healthData.value
    })}`
  );
}
