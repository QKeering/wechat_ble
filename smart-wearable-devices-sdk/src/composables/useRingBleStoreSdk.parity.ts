import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

const storage = new Map<string, unknown>();
const bleConnectionStateCallbacks: Array<(result: { deviceId: string; connected: boolean }) => void> = [];
const bluetoothFoundCallbacks: Array<(result: { devices: any[] }) => void> = [];
const notifyRequests: Array<{ deviceId: string; serviceId: string; characteristicId: string; state: boolean }> = [];
const connectedDeviceServiceRequests: string[][] = [];
const connectedDeviceIds: string[] = [];
const rssiRequests: string[] = [];
const writtenHex: string[] = [];
const connectionFailures = new Set<string>();
const defaultRwScanDevice = {
  deviceId: 'rw-reconnect-platform-id',
  name: 'SY03',
  mac: '3E:00:00:00:05:1B',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  advertisData: 'D60602008100523E000000051B8043443330336530303031',
  advertisServiceUUIDs: ['0000180D-0000-1000-8000-00805F9B34FB']
};
let scanDevices: any[] = [defaultRwScanDevice];

const arrayBufferToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

(globalThis as any).uni = {
  getSystemInfoSync: () => ({
    platform: 'android',
    system: 'Android 14',
    uniPlatform: 'mp-weixin'
  }),
  getSetting: ({ success }: { success: (result: unknown) => void }) => success({ authSetting: { 'scope.userLocation': true } }),
  getLocation: ({ success }: { success: (result: unknown) => void }) => success({}),
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => {
    storage.set(key, value);
  },
  removeStorageSync: (key: string) => {
    storage.delete(key);
  },
  openBluetoothAdapter: ({ success }: { success: (result: unknown) => void }) => success({}),
  startBluetoothDevicesDiscovery: ({ success }: { success: (result: unknown) => void }) => {
    success({});
    setTimeout(() => {
      bluetoothFoundCallbacks.forEach((callback) =>
        callback({
          devices: scanDevices
        })
      );
    }, 0);
  },
  stopBluetoothDevicesDiscovery: ({ success }: { success?: (result: unknown) => void } = {}) => {
    success?.({});
  },
  onBluetoothDeviceFound: (callback: (result: { devices: any[] }) => void) => {
    bluetoothFoundCallbacks.push(callback);
  },
  offBluetoothDeviceFound: (callback?: (result: { devices: any[] }) => void) => {
    if (!callback) {
      bluetoothFoundCallbacks.length = 0;
      return;
    }
    const index = bluetoothFoundCallbacks.indexOf(callback);
    if (index >= 0) bluetoothFoundCallbacks.splice(index, 1);
  },
  getBluetoothDevices: ({ success }: { success: (result: { devices: any[] }) => void }) =>
    success({
      devices: scanDevices
    }),
  createBLEConnection: ({
    deviceId,
    success,
    fail
  }: {
    deviceId: string;
    success: (result: unknown) => void;
    fail?: (result: { errMsg: string }) => void;
  }) => {
    connectedDeviceIds.push(deviceId);
    if (connectionFailures.has(deviceId)) {
      fail?.({ errMsg: `createBLEConnection:fail ${deviceId}` });
      return;
    }
    success({});
  },
  closeBLEConnection: ({ success }: { success: (result: unknown) => void }) => success({}),
  setBLEMTU: ({ success }: { success: (result: unknown) => void }) => success({}),
  getBLEDeviceServices: ({ success }: { success: (result: unknown) => void }) =>
    success({
      services: [{ uuid: '0000A00A-0000-1000-8000-00805F9B34FB' }]
    }),
  getBLEDeviceCharacteristics: ({ serviceId, success }: { serviceId: string; success: (result: unknown) => void }) =>
    success({
      characteristics: [
        {
          uuid: '0000B002-0000-1000-8000-00805F9B34FB',
          properties: { write: true, writeNoResponse: true }
        },
        {
          uuid: '0000B003-0000-1000-8000-00805F9B34FB',
          properties: { notify: true }
        }
      ],
      serviceId
    }),
  notifyBLECharacteristicValueChange: ({
    deviceId,
    serviceId,
    characteristicId,
    state,
    success
  }: {
    deviceId: string;
    serviceId: string;
    characteristicId: string;
    state: boolean;
    success: (result: unknown) => void;
  }) => {
    notifyRequests.push({ deviceId, serviceId, characteristicId, state });
    success({});
  },
  writeBLECharacteristicValue: ({ value, success }: { value: ArrayBuffer; success: (result: unknown) => void }) => {
    writtenHex.push(arrayBufferToHex(value));
    success({});
  },
  getConnectedBluetoothDevices: ({ services, success }: { services: string[]; success: (result: { devices: any[] }) => void }) => {
    connectedDeviceServiceRequests.push(services);
    success({
      devices: [
        {
          deviceId: 'rw-utility-platform-id'
        }
      ]
    });
  },
  getBLEDeviceRSSI: ({ deviceId, success }: { deviceId: string; success: (result: unknown) => void }) => {
    rssiRequests.push(deviceId);
    success({});
  },
  onBLECharacteristicValueChange: () => undefined,
  onBLEConnectionStateChange: (callback: (result: { deviceId: string; connected: boolean }) => void) => {
    bleConnectionStateCallbacks.push(callback);
  },
  offBLEConnectionStateChange: () => {
    bleConnectionStateCallbacks.length = 0;
  },
  offBLECharacteristicValueChange: () => undefined
};

setActivePinia(createPinia());

const { useRingBleStoreSdk } = await import('./useRingBleStoreSdk');

const first = useRingBleStoreSdk();
const second = useRingBleStoreSdk();

if (first !== second) {
  throw new Error('Default useRingBleStoreSdk calls should share one SDK instance across legacy entries.');
}

first.deviceInfo.value = {
  deviceId: 'shared-device',
  serviceId: 'shared-service'
} as any;

if (second.deviceInfo.value.deviceId !== 'shared-device') {
  throw new Error(`Shared SDK instance should expose the same device state: ${JSON.stringify(second.deviceInfo.value)}`);
}

const custom = useRingBleStoreSdk({
  getBoundDevice: async () => null
});

if (custom === first || custom.deviceInfo.value.deviceId === 'shared-device') {
  throw new Error('Custom useRingBleStoreSdk options should create an isolated SDK instance.');
}

const emptyReconnectResult = await custom.autoConnectLastDevice();
if (emptyReconnectResult !== false || custom.reconnectStatus.value !== 'failed' || custom.reconnectResult.value !== false) {
  throw new Error(`Empty reconnect should fail gracefully without throwing: ${JSON.stringify({
    emptyReconnectResult,
    reconnectStatus: custom.reconnectStatus.value,
    reconnectResult: custom.reconnectResult.value
  })}`);
}

notifyRequests.length = 0;
const rwAdvertisOnlyReconnect = useRingBleStoreSdk({
  getBoundDevice: async () => ({
    name: 'SY03',
    deviceName: 'SY03',
    protocol: 'rw',
    advertis: {
      macInfo: '3E:00:00:00:05:1B'
    }
  })
});
rwAdvertisOnlyReconnect.ringStore.setNormalMac('AA:BB:CC:DD:EE:FF');
rwAdvertisOnlyReconnect.ringStore.setIosMacId('stale-l19-ios-id');
const rwAdvertisOnlyReconnectResult = await rwAdvertisOnlyReconnect.autoConnectLastDevice();
await nextTick();

if (
  rwAdvertisOnlyReconnectResult !== true ||
  rwAdvertisOnlyReconnect.deviceInfo.value.deviceId !== 'rw-reconnect-platform-id' ||
  rwAdvertisOnlyReconnect.deviceInfo.value.mac !== '3E:00:00:00:05:1B' ||
  rwAdvertisOnlyReconnect.ringStore.normalMac !== '3E:00:00:00:05:1B' ||
  rwAdvertisOnlyReconnect.ringStore.iosMacId !== '3E:00:00:00:05:1B' ||
  rwAdvertisOnlyReconnect.reconnectStatus.value !== 'success' ||
  rwAdvertisOnlyReconnect.reconnectResult.value !== true ||
  !notifyRequests.some((request) => request.deviceId === 'rw-reconnect-platform-id' && request.state === true)
) {
  throw new Error(
    `RW reconnect should scan and restore devices whose stored identity only has advertis macInfo: ${JSON.stringify({
      result: rwAdvertisOnlyReconnectResult,
      deviceInfo: rwAdvertisOnlyReconnect.deviceInfo.value,
      normalMac: rwAdvertisOnlyReconnect.ringStore.normalMac,
      iosMacId: rwAdvertisOnlyReconnect.ringStore.iosMacId,
      reconnectStatus: rwAdvertisOnlyReconnect.reconnectStatus.value,
      reconnectResult: rwAdvertisOnlyReconnect.reconnectResult.value,
      notifyRequests
    })}`
  );
}

notifyRequests.length = 0;
connectedDeviceIds.length = 0;
scanDevices = [];
const rwStableOnlyReconnect = useRingBleStoreSdk({
  rwReconnectScanTimeoutMs: 1,
  rwReconnectCandidateTimeoutMs: 1,
  getBoundDevice: async () => ({
    deviceId: '3E:00:00:00:05:1B',
    name: 'SY03',
    deviceName: 'SY03',
    protocol: 'rw',
    mac: '3E:00:00:00:05:1B',
    advertis: {
      macInfo: '3E:00:00:00:05:1B'
    }
  })
});
const rwStableOnlyReconnectResult = await rwStableOnlyReconnect.autoConnectLastDevice();

if (
  rwStableOnlyReconnectResult !== false ||
  rwStableOnlyReconnect.reconnectStatus.value !== 'failed' ||
  rwStableOnlyReconnect.reconnectResult.value !== false ||
  connectedDeviceIds.length !== 0
) {
  throw new Error(
    `RW reconnect should fail cleanly instead of direct-connecting stable mac identities when scan misses: ${JSON.stringify({
      result: rwStableOnlyReconnectResult,
      reconnectStatus: rwStableOnlyReconnect.reconnectStatus.value,
      reconnectResult: rwStableOnlyReconnect.reconnectResult.value,
      connectedDeviceIds
    })}`
  );
}
scanDevices = [defaultRwScanDevice];

notifyRequests.length = 0;
connectedDeviceIds.length = 0;
connectionFailures.add('rw-reconnect-platform-id');
const rwScanConnectFailureReconnect = useRingBleStoreSdk({
  getBoundDevice: async () => ({
    name: 'SY03',
    deviceName: 'SY03',
    protocol: 'rw',
    advertis: {
      macInfo: '3E:00:00:00:05:1B'
    }
  })
});
let rwScanConnectFailureThrown = false;
const rwScanConnectFailureResult = await rwScanConnectFailureReconnect.autoConnectLastDevice().catch(() => {
  rwScanConnectFailureThrown = true;
  return true;
});
connectionFailures.clear();
scanDevices = [defaultRwScanDevice];

if (
  rwScanConnectFailureThrown ||
  rwScanConnectFailureResult !== false ||
  rwScanConnectFailureReconnect.reconnectStatus.value !== 'failed' ||
  rwScanConnectFailureReconnect.reconnectResult.value !== false ||
  rwScanConnectFailureReconnect.isScanning.value
) {
  throw new Error(
    `RW scan reconnect should fail cleanly and stop scanning when the scanned platform connection fails: ${JSON.stringify({
      rwScanConnectFailureThrown,
      rwScanConnectFailureResult,
      reconnectStatus: rwScanConnectFailureReconnect.reconnectStatus.value,
      reconnectResult: rwScanConnectFailureReconnect.reconnectResult.value,
      isScanning: rwScanConnectFailureReconnect.isScanning.value,
      connectedDeviceIds
    })}`
  );
}

notifyRequests.length = 0;
writtenHex.length = 0;
const coldRwCommandSdk = useRingBleStoreSdk({
  getBoundDevice: async () => null
});
coldRwCommandSdk.deviceInfo.value = {
  deviceId: 'rw-command-platform-id',
  name: 'SY03',
  protocol: 'rw',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  }
} as any;
await coldRwCommandSdk.readDeviceTime();

if (
  !notifyRequests.some((request) => request.deviceId === 'rw-command-platform-id' && request.state === true) ||
  !writtenHex.some((hex) => hex.startsWith('ab010003') && hex.endsWith('020110')) ||
  !writtenHex.some((hex) => hex.slice(4, 8) === '1001')
) {
  throw new Error(
    `Store SDK command methods should ensure RW communication before calling the adapter: ${JSON.stringify({
      notifyRequests,
      writtenHex
    })}`
  );
}

writtenHex.length = 0;
await coldRwCommandSdk.getTimedTemperatureJL();
const storeTimedTemperatureReadHex = String(writtenHex[0] || '');
if (storeTimedTemperatureReadHex !== 'ab0100035c81027d10') {
  throw new Error(`Store SDK should expose RW timed temperature read aliases through the shared SDK surface: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await coldRwCommandSdk.setTimedTemperatureJL({
  enabled: true,
  startHour: 1,
  startMinute: 2,
  endHour: 3,
  endMinute: 4,
  interval: 5
});
const storeTimedTemperatureWriteHex = String(writtenHex[0] || '');
if (`${storeTimedTemperatureWriteHex.slice(12, 18)}:${storeTimedTemperatureWriteHex.slice(-12)}` !== '021b00:ff0102030405') {
  throw new Error(`Store SDK should expose RW timed temperature write aliases through the shared SDK surface: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await coldRwCommandSdk.readRwHealthData('bloodOxygen' as any);
if (
  JSON.stringify(writtenHex) !== JSON.stringify(['ab010003ac95024e10', 'ab010003024e10', 'ab0100039d17050910', 'ab010003050910'])
) {
  throw new Error(`Store SDK should normalize RW realtime health read aliases: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await coldRwCommandSdk.deleteRwHealthData('spO2' as any);
if (String(writtenHex[0] || '') !== 'ab0100034516050930') {
  throw new Error(`Store SDK should normalize RW direct health delete aliases: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await coldRwCommandSdk.controlRwHealthData('oxygen' as any, true);
if (String(writtenHex[0] || '') !== 'ab010006f5ce060900090501') {
  throw new Error(`Store SDK should normalize RW direct health control aliases: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await coldRwCommandSdk.controlHealthDataJL('bodyTemp' as any, true);
if (String(writtenHex[0] || '') !== 'ab010006359f060900080501') {
  throw new Error(`Store SDK should normalize RW JL health control aliases: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await coldRwCommandSdk.readRwHealthData('skinTemp' as any);
if (
  JSON.stringify(writtenHex) !== JSON.stringify(['ab0100030cb4023010', 'ab010003023010', 'ab0100030d16050810', 'ab010003050810'])
) {
  throw new Error(`Store SDK should normalize RW realtime skin-temperature aliases: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await coldRwCommandSdk.readRwMonitoringConfig('SPO2' as any);
if (String(writtenHex[0] || '') !== 'ab0100039cba022510') {
  throw new Error(`Store SDK should normalize RW monitoring read aliases: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await coldRwCommandSdk.setRwMonitoringConfig('bp' as any, {
  enabled: true,
  startHour: 1,
  startMinute: 2,
  endHour: 3,
  endMinute: 4,
  interval: 5
});
const storeCompatBloodPressureWriteHex = String(writtenHex[0] || '');
if (`${storeCompatBloodPressureWriteHex.slice(12, 18)}:${storeCompatBloodPressureWriteHex.slice(-12)}` !== '027c00:010102030405') {
  throw new Error(`Store SDK should normalize RW monitoring write aliases: ${JSON.stringify(writtenHex)}`);
}

notifyRequests.length = 0;
writtenHex.length = 0;
const coldRwRawCommandSdk = useRingBleStoreSdk({
  getBoundDevice: async () => null
});
coldRwRawCommandSdk.deviceInfo.value = {
  deviceId: 'rw-raw-command-platform-id',
  name: 'SY03',
  protocol: 'rw',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  }
} as any;
await coldRwRawCommandSdk.sendBytes(new Uint8Array([0xab, 0x01, 0x00, 0x00]));

if (
  !notifyRequests.some((request) => request.deviceId === 'rw-raw-command-platform-id' && request.state === true) ||
  String(writtenHex[0] || '') !== 'ab010000'
) {
  throw new Error(
    `Store SDK raw sendBytes should ensure RW communication before writing bytes: ${JSON.stringify({
      notifyRequests,
      writtenHex
    })}`
  );
}

connectedDeviceServiceRequests.length = 0;
rssiRequests.length = 0;
const rwUtilitySdk = useRingBleStoreSdk({
  getBoundDevice: async () => null
});
const rwUtilityConnected = await rwUtilitySdk.isDeviceConnected(
  'rw-utility-platform-id',
  '0000A00A-0000-1000-8000-00805F9B34FB'
);
if (
  rwUtilityConnected !== true ||
  rwUtilitySdk.adapter.protocol !== 'rw' ||
  connectedDeviceServiceRequests[0]?.[0] !== '0000A00A-0000-1000-8000-00805F9B34FB'
) {
  throw new Error(
    `Store SDK isDeviceConnected should route RW service checks through the RW adapter: ${JSON.stringify({
      rwUtilityConnected,
      protocol: rwUtilitySdk.adapter.protocol,
      connectedDeviceServiceRequests
    })}`
  );
}

bleConnectionStateCallbacks.length = 0;
const rwInitSdk = useRingBleStoreSdk({
  getBoundDevice: async () => null
});
rwInitSdk.deviceInfo.value = {
  deviceId: 'rw-init-device',
  protocol: 'rw'
} as any;
await rwInitSdk.initBluetooth();
if (String(rwInitSdk.adapter.protocol) !== 'rw' || bleConnectionStateCallbacks.length === 0) {
  throw new Error(
    `Store SDK initBluetooth should switch to the active RW adapter before registering listeners: ${JSON.stringify({
      protocol: rwInitSdk.adapter.protocol,
      listenerCount: bleConnectionStateCallbacks.length
    })}`
  );
}

const rwProtocolOnlyScanSdk = useRingBleStoreSdk({
  getBoundDevice: async () => null
});
rwProtocolOnlyScanSdk.deviceInfo.value = {
  protocol: 'rw'
} as any;
await rwProtocolOnlyScanSdk.startScan({ includeUnknown: true, preserveDevices: true, timeoutMs: 10 });
if (rwProtocolOnlyScanSdk.adapter.protocol !== 'legacy') {
  throw new Error(
    `Store SDK startScan should use the broad legacy scanner when there is no active deviceId: ${rwProtocolOnlyScanSdk.adapter.protocol}`
  );
}
await rwProtocolOnlyScanSdk.stopScan();

rwUtilitySdk.deviceInfo.value = {
  deviceId: 'rw-utility-current-id',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B'
} as any;
await rwUtilitySdk.checkByRSSI('3E:00:00:00:05:1B');
if (rwUtilitySdk.adapter.protocol !== 'rw' || !rssiRequests.includes('rw-utility-current-id')) {
  throw new Error(
    `Store SDK checkByRSSI should match RW by stable identity but call WeChat with the platform deviceId: ${JSON.stringify({
      protocol: rwUtilitySdk.adapter.protocol,
      rssiRequests
    })}`
  );
}

rssiRequests.length = 0;
connectedDeviceServiceRequests.length = 0;
await rwUtilitySdk.isDeviceConnected('3E:00:00:00:05:1B', '0000A00A-0000-1000-8000-00805F9B34FB');
if (!rssiRequests.includes('rw-utility-current-id') || rwUtilitySdk.adapter.protocol !== 'rw') {
  throw new Error(
    `Store SDK isDeviceConnected should use the platform id for RW RSSI fallback after stable identity matching: ${JSON.stringify({
      protocol: rwUtilitySdk.adapter.protocol,
      connectedDeviceServiceRequests,
      rssiRequests
    })}`
  );
}

bleConnectionStateCallbacks.length = 0;
const rwListenerSdk = useRingBleStoreSdk({
  getBoundDevice: async () => null
});
if (rwListenerSdk.adapter.protocol !== 'legacy') {
  throw new Error(`Fresh Store SDK listener instance should start from the legacy adapter: ${rwListenerSdk.adapter.protocol}`);
}
rwListenerSdk.deviceInfo.value = {
  deviceId: 'rw-listener-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any;
rwListenerSdk.normalizedData.value = [
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'heart_rate',
      value: 72,
      data: [72]
    }
  }
] as any;
await nextTick();
await rwListenerSdk.registerGlobalListeners();
if (String(rwListenerSdk.adapter.protocol) !== 'rw' || bleConnectionStateCallbacks.length === 0) {
  throw new Error(
    `Store SDK global listener registration should switch to the active RW adapter: ${JSON.stringify({
      protocol: rwListenerSdk.adapter.protocol,
      listenerCount: bleConnectionStateCallbacks.length
    })}`
  );
}
bleConnectionStateCallbacks[bleConnectionStateCallbacks.length - 1]?.({ deviceId: 'rw-listener-device', connected: false });
await nextTick();
if (
  rwListenerSdk.deviceInfo.value.deviceId ||
  rwListenerSdk.normalizedData.value.length !== 0 ||
  rwListenerSdk.ringStore.latestMetrics.heartRate !== null
) {
  throw new Error(
    `Store SDK RW global listener should clear stale runtime data after disconnect: ${JSON.stringify({
      deviceInfo: rwListenerSdk.deviceInfo.value,
      normalizedData: rwListenerSdk.normalizedData.value,
      metrics: rwListenerSdk.ringStore.latestMetrics
    })}`
  );
}

first.deviceInfo.value = {
  deviceId: 'history-device',
  name: 'SY03',
  protocol: 'rw',
  uniMacId: '00:05:1B',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  }
} as any;
await nextTick();

if (first.ringStore.normalMac !== '3E:00:00:00:05:1B') {
  throw new Error(`Store SDK should persist RW advertis macInfo as normalMac: ${first.ringStore.normalMac}`);
}

first.ringStore.resetLastReadTimestamp();
first.receivedData.value = [
  {
    type: 'local_data',
    protocol: 'rw',
    deviceId: 'history-device',
    mac: '3E:00:00:00:05:1B',
    records: [
      {
        recordTime: '2099-01-01 00:00:00',
        value: 62,
        dataType: 'heart_rate_raw'
      },
      {
        recordTime: '2099-01-01 00:00:00',
        value: 63,
        dataType: 'heart_rate_raw',
        status: 'uploaded'
      },
      {
        recordTime: '2000-01-01 00:00:00',
        value: 61,
        dataType: 'heart_rate_raw'
      }
    ]
  }
] as any;
await nextTick();

const recordTimeOnlyCursor = Math.floor(Date.parse('2099/01/01 00:00:00') / 1000);
const recordTimeOnlyRecords = first.ringStore.localData.filter((record) => record.dataType === 'heart_rate_raw');
if (
  first.ringStore.lastReadTimestamp !== recordTimeOnlyCursor ||
  recordTimeOnlyRecords.length !== 2 ||
  recordTimeOnlyRecords[0].recordTime !== '2099-01-01 00:00:00' ||
  recordTimeOnlyRecords[0].value !== 63
) {
  throw new Error(
    `Store SDK should dedupe, sort, and advance cursor for RW recordTime-only history records: ${JSON.stringify({
      lastReadTimestamp: first.ringStore.lastReadTimestamp,
      records: first.ringStore.localData
    })}`
  );
}

first.receivedData.value = [
  {
    type: 'rw_upload_file',
    protocol: 'rw',
    seq: 7,
    status: 'completed',
    fileName: 'u1_20260101010101_hr.txt',
    fileType: 'hr',
    records: [
      {
        timestamp: 1767229261,
        value: 68,
        ppg: [1, 2, 3]
      },
      {
        timestamp: 1767229270,
        value: 69,
        ppg: [4, 5, 6]
      }
    ]
  },
  {
    type: 'qkeer_v2_step_list',
    protocol: 'qkeer-v2',
    records: [{ unixTime: 1767229262, steps: 128 }]
  },
  {
    type: 'qkeer_v2_health_list',
    protocol: 'rw',
    records: [{ unixTime: 1767229264, heartRate: 71, bloodOxygen: 97 }]
  },
  {
    type: 'qkeer_v2_sleep_list',
    protocol: 'qkeer-v2',
    records: [{ unixTime: 1767229263, totalMinutes: 420 }]
  },
  {
    type: 'rw_file_list',
    protocol: 'rw',
    files: [{ seq: 7, fileName: 'u1_20260101010101_hr.txt', timestampText: '20260101010101', fileType: 'hr' }]
  }
] as any;

await nextTick();

const records = first.ringStore.localData;
if (records.length !== 5) {
  throw new Error(`Store SDK should expose five deduped enriched local data records: ${JSON.stringify(records)}`);
}

for (const record of records) {
  if (!record.protocol || !record.sourceType || record.deviceId !== 'history-device' || record.deviceName !== 'SY03') {
    throw new Error(`Local data record should keep protocol and device identity: ${JSON.stringify(record)}`);
  }
}

const dataTypes = records.map((record) => record.dataType).filter(Boolean);
if (!dataTypes.includes('step') || !dataTypes.includes('vital') || !dataTypes.includes('sleep') || !dataTypes.includes('heart_rate_raw')) {
  throw new Error(`Local data records should preserve normalized data types: ${JSON.stringify(records)}`);
}

const qkeerV2HealthRecord = records.find((record) => record.sourceType === 'qkeer_v2_health_list');
if (qkeerV2HealthRecord?.dataType !== 'vital' || qkeerV2HealthRecord.heartRate !== 71 || qkeerV2HealthRecord.bloodOxygen !== 97) {
  throw new Error(`Store SDK should expose RW QKeer V2 health-list history as vital local data: ${JSON.stringify(records)}`);
}

const rwHistoryFileRecord = records.find((record) => record.sourceType === 'rw_file_list');
if (rwHistoryFileRecord) {
  throw new Error(`Uploaded RW local data should replace the matching pending file-list record: ${JSON.stringify(records)}`);
}

const rwUploadedRecord = records.find((record) => record.sourceType === 'rw_upload_file' && record.seq === 7);
if (rwUploadedRecord?.status !== 'completed' || rwUploadedRecord.dataType !== 'heart_rate_raw') {
  throw new Error(`RW uploaded local data should keep semantic type and replace pending file: ${JSON.stringify(records)}`);
}

const rwUploadedRecords = records.filter((record) => record.sourceType === 'rw_upload_file' && record.seq === 7);
if (
  rwUploadedRecords.length !== 2 ||
  !rwUploadedRecords.some((record) => record.unixTime === 1767229261) ||
  !rwUploadedRecords.some((record) => record.unixTime === 1767229270)
) {
  throw new Error(`RW history records from one file should keep distinct timestamps: ${JSON.stringify(records)}`);
}

first.receivedData.value = [
  {
    type: 'rw_upload_file',
    protocol: 'rw',
    deviceId: 'rw-random-platform-1',
    mac: '3E:00:00:00:05:1B',
    seq: 8,
    status: 'completed',
    fileName: 'u1_20260101010200_hr.txt',
    fileType: 'hr',
    records: [
      {
        timestamp: 1767229320,
        value: 71
      }
    ]
  },
  {
    type: 'rw_upload_file',
    protocol: 'rw',
    deviceId: 'rw-random-platform-2',
    mac: '3E:00:00:00:05:1B',
    seq: 8,
    status: 'completed',
    fileName: 'u1_20260101010200_hr.txt',
    fileType: 'hr',
    records: [
      {
        timestamp: 1767229320,
        value: 71
      }
    ]
  },
  {
    type: 'rw_upload_file',
    protocol: 'rw',
    deviceId: 'rw-random-platform-3',
    mac: '3e-00-00-00-05-1b',
    seq: 8,
    status: 'completed',
    fileName: 'u1_20260101010200_hr.txt',
    fileType: 'hr',
    records: [
      {
        timestamp: 1767229320,
        value: 71
      }
    ]
  }
] as any;
await nextTick();

const stableRwHistoryRecords = first.ringStore.localData.filter(
  (record) => record.sourceType === 'rw_upload_file' && record.seq === 8
);
if (stableRwHistoryRecords.length !== 1 || stableRwHistoryRecords[0].deviceId !== 'rw-random-platform-3') {
  throw new Error(
    `Store SDK should dedupe RW history by stable MAC when platform deviceId or MAC formatting changes: ${JSON.stringify(first.ringStore.localData)}`
  );
}

first.receivedData.value = [
  {
    type: 'rw_upload_file',
    protocol: 'rw',
    deviceId: 'rw-record-random-platform',
    mac: '3E:00:00:00:05:1B',
    seq: 10,
    status: 'completed',
    fileName: 'u1_20260101010300_hr.txt',
    fileType: 'hr',
    records: [
      {
        timestamp: 1767229380,
        value: 72,
        uniMacId: '111111ABCDEF'
      }
    ]
  }
] as any;
await nextTick();

const rwRandomRecordIdentity = first.ringStore.localData.find(
  (record) => record.sourceType === 'rw_upload_file' && record.seq === 10
);
if (
  rwRandomRecordIdentity?.uniMacId !== '3E:00:00:00:05:1B' ||
  rwRandomRecordIdentity?.mac !== '3E:00:00:00:05:1B'
) {
  throw new Error(
    `Store SDK should replace random RW record uniMacId with the stable parsed/device MAC: ${JSON.stringify(first.ringStore.localData)}`
  );
}

first.receivedData.value = [
  ...first.receivedData.value,
  {
    type: 'rw_file_list',
    protocol: 'rw',
    mac: '3E:00:00:00:05:1B',
    files: [{ seq: 9, fileName: 'u1_20260101010101_hr.txt', timestampText: '20260101010101', fileType: 'hr' }],
    selectedFiles: [],
    selectedFileCount: 0,
    filteredFileCount: 1
  }
] as any;

await nextTick();

if (first.ringStore.localData.length !== 0) {
  throw new Error(
    `Store SDK should clear previous RW history records after an appended filtered file list: ${JSON.stringify(first.ringStore.localData)}`
  );
}

first.receivedData.value = [
  {
    type: 'rw_upload_file',
    protocol: 'rw',
    mac: '3E:00:00:00:05:1B',
    seq: 31,
    status: 'completed',
    fileName: 'u1_20260101030100_hr.txt',
    fileType: 'hr',
    records: [{ timestamp: 1767236460, heartRate: 73 }]
  },
  {
    type: 'local_data',
    protocol: 'rw',
    mac: '3E:00:00:00:05:1B',
    status: 'filtered',
    dataType: 'blood_oxygen',
    records: []
  }
] as any;

await nextTick();

if (
  !first.ringStore.localData.some((record) => record.seq === 31 && record.dataType === 'heart_rate_raw') ||
  first.ringStore.localData.some((record) => record.dataType === 'blood_oxygen_raw')
) {
  throw new Error(
    `Store SDK typed RW filtered local_data should preserve other vital-sign history types: ${JSON.stringify(first.ringStore.localData)}`
  );
}

first.receivedData.value = [
  ...first.receivedData.value,
  {
    type: 'local_data',
    protocol: 'rw',
    mac: '3E:00:00:00:05:1B',
    status: 'filtered',
    dataType: 'heartRate',
    records: []
  }
] as any;

await nextTick();

if (first.ringStore.localData.some((record) => record.seq === 31 || record.dataType === 'heart_rate_raw')) {
  throw new Error(
    `Store SDK typed RW filtered local_data should clear only the matching history type: ${JSON.stringify(first.ringStore.localData)}`
  );
}

first.receivedData.value = [
  {
    type: 'rw_file_list',
    protocol: 'rw',
    files: [{ seq: 9, fileName: 'u1_20260101010101_hr.txt', timestampText: '20260101010101', fileType: 'hr' }],
    selectedFiles: [],
    selectedFileCount: 0,
    filteredFileCount: 1
  }
] as any;

await nextTick();

if (first.ringStore.localData.length !== 0) {
  throw new Error(`Store SDK should not expose RW files filtered out of the current history range: ${JSON.stringify(first.ringStore.localData)}`);
}

first.receivedData.value = [
  {
    type: 'local_data',
    protocol: 'rw',
    deviceId: 'stale-device',
    mac: 'AA:BB:CC:DD:EE:FF',
    records: [
      {
        unixTime: 1767229300,
        value: 99,
        seq: 8,
        fileName: 'u1_20260101010200_hr.txt',
        dataType: 'heart_rate_raw',
        status: 'uploaded'
      }
    ]
  }
] as any;

await nextTick();

if (first.ringStore.localData.length !== 0) {
  throw new Error(`Store SDK should ignore stale local data from another device: ${JSON.stringify(first.ringStore.localData)}`);
}

first.receivedData.value = [
  {
    type: 'local_data',
    protocol: 'legacy',
    deviceId: 'history-device',
    mac: '3E:00:00:00:05:1B',
    records: [
      {
        unixTime: 1767229301,
        value: 88,
        dataType: 'heart_rate_raw',
        status: 'uploaded'
      }
    ]
  }
] as any;

await nextTick();

if (first.ringStore.localData.length !== 0) {
  throw new Error(`Store SDK should ignore local data from a conflicting protocol even when identity overlaps: ${JSON.stringify(first.ringStore.localData)}`);
}

first.deviceInfo.value = {
  deviceId: 'rw-random-current-platform',
  uniMacId: 'B09FBA121E1C',
  protocol: 'rw',
  name: 'SY03'
} as any;
first.receivedData.value = [
  {
    type: 'local_data',
    protocol: 'rw',
    deviceId: 'rw-random-current-platform',
    uniMacId: 'B09FBA121E1C',
    records: [
      {
        unixTime: 1767229400,
        value: 90,
        dataType: 'heart_rate_raw'
      }
    ]
  }
] as any;

await nextTick();

if (first.ringStore.localData.length !== 0) {
  throw new Error(`Store SDK should ignore RW local data tagged only with random platform identity: ${JSON.stringify(first.ringStore.localData)}`);
}

first.receivedData.value = [
  {
    type: 'local_data',
    protocol: 'rw',
    records: [
      {
        unixTime: 1767229401,
        value: 91,
        dataType: 'heart_rate_raw'
      }
    ]
  }
] as any;

await nextTick();

const untaggedRwLocalData = [...first.ringStore.localData];
if (untaggedRwLocalData.length !== 1 || untaggedRwLocalData[0]?.value !== 91) {
  throw new Error(`Store SDK should still accept untagged RW current-connection local data: ${JSON.stringify(untaggedRwLocalData)}`);
}

first.deviceInfo.value = {
  deviceId: 'legacy-history-device',
  uniMacId: 'legacy-history-uni',
  protocol: 'qkeer-v2',
  name: 'QKeeRingL19'
} as any;
first.receivedData.value = [
  {
    type: 'local_data',
    protocol: 'qkeer-v2',
    deviceId: 'legacy-history-device',
    uniMacId: 'legacy-history-uni',
    records: [
      {
        unixTime: 1767229402,
        value: 92,
        dataType: 'heart_rate_raw'
      }
    ]
  }
] as any;

await nextTick();

const legacyLocalData = [...first.ringStore.localData];
if (legacyLocalData.length !== 1 || legacyLocalData[0]?.value !== 92) {
  throw new Error(`Store SDK should preserve legacy/L19 local-data identity matching: ${JSON.stringify(legacyLocalData)}`);
}

first.deviceInfo.value = {
  deviceId: 'disconnect-device',
  serviceId: 'service',
  cmdCharId: 'write',
  dataCharId: 'notify',
  protocol: 'rw'
} as any;
first.normalizedData.value = [
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'heart_rate',
      value: 68,
      data: [68]
    }
  }
] as any;
await nextTick();

if (first.ringStore.latestMetrics.heartRate !== 68) {
  throw new Error(`Store SDK should expose current health metrics before disconnect: ${JSON.stringify(first.ringStore.latestMetrics)}`);
}

await first.registerGlobalListeners();
bleConnectionStateCallbacks[0]?.({ deviceId: 'disconnect-device', connected: false });
await nextTick();

if (
  first.deviceInfo.value.deviceId ||
  first.receivedData.value.length !== 0 ||
  first.normalizedData.value.length !== 0 ||
  first.ringStore.latestMetrics.heartRate !== null
) {
  throw new Error(
    `Store SDK should clear stale runtime data after async BLE disconnect: ${JSON.stringify({
      deviceInfo: first.deviceInfo.value,
      receivedData: first.receivedData.value,
      normalizedData: first.normalizedData.value,
      metrics: first.ringStore.latestMetrics
    })}`
  );
}
