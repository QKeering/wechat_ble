import { getScannedDeviceMergeKeys } from './adapter';
import { createLegacyRingAdapter } from './adapter';

const sy03FirstKeys = getScannedDeviceMergeKeys({
  deviceId: 'ios-random-1',
  name: 'SY03',
  protocol: 'rw',
  advertisData: 'D60602008100523E000000051B8043443330336530303031'
});

const sy03SecondKeys = getScannedDeviceMergeKeys({
  deviceId: 'ios-random-2',
  localName: 'SY03',
  protocol: 'rw',
  advertisData: 'D60602008100523E000000051B8043443330336530303031'
});

if (!sy03FirstKeys.some((key) => sy03SecondKeys.includes(key))) {
  throw new Error(`SY03 scan records with changing deviceId should merge by advertis identity: ${JSON.stringify({ sy03FirstKeys, sy03SecondKeys })}`);
}

const bh3Keys = getScannedDeviceMergeKeys({
  deviceId: 'bh3-1',
  name: 'BH3',
  protocol: 'rw',
  advertisData: 'D6060200810052351000001191804344433303353130303030'
});

if (sy03FirstKeys.some((key) => bh3Keys.includes(key))) {
  throw new Error(`Different RW devices should not share scan merge keys: ${JSON.stringify({ sy03FirstKeys, bh3Keys })}`);
}

const qkeerFirstKeys = getScannedDeviceMergeKeys({
  deviceId: 'qkeer-random-1',
  name: 'QKeeRingL19',
  protocol: 'legacy',
  advertisServiceUUIDs: ['0000BAE8-0000-1000-8000-00805F9B34FB']
});

const qkeerSecondKeys = getScannedDeviceMergeKeys({
  deviceId: 'qkeer-random-2',
  localName: 'QKeeRingL19',
  protocol: 'legacy',
  advertisServiceUUIDs: ['0000BAE8-0000-1000-8000-00805F9B34FB']
});

if (qkeerFirstKeys.some((key) => qkeerSecondKeys.includes(key))) {
  throw new Error(`Legacy rings with different deviceId should not merge only by name and service: ${JSON.stringify({ qkeerFirstKeys, qkeerSecondKeys })}`);
}

const discoveredCallbacks: Array<(result: { devices: any[] }) => void> = [];
const adapterStateCallbacks: Array<(result: { available: boolean; discovering: boolean }) => void> = [];
let mtuFailureCount = 0;
const serviceCache: Record<string, string> = {};
(globalThis as any).uni = {
  getSystemInfoSync: () => ({ platform: 'android', system: 'Android 14', uniPlatform: 'mp-weixin' }),
  offBLEConnectionStateChange: () => undefined,
  onBLEConnectionStateChange: () => undefined,
  offBluetoothAdapterStateChange: () => {
    adapterStateCallbacks.length = 0;
  },
  onBluetoothAdapterStateChange: (callback: (result: { available: boolean; discovering: boolean }) => void) => {
    adapterStateCallbacks.push(callback);
  },
  offBLECharacteristicValueChange: () => undefined,
  offBluetoothDeviceFound: () => undefined,
  onBluetoothDeviceFound: (callback: (result: { devices: any[] }) => void) => {
    discoveredCallbacks.push(callback);
  },
  startBluetoothDevicesDiscovery: ({ success }: { success: (result: unknown) => void }) => success({}),
  stopBluetoothDevicesDiscovery: ({ success }: { success: (result: unknown) => void }) => success({}),
  getBluetoothDevices: () => undefined,
  createBLEConnection: ({ success }: { success: (result: unknown) => void }) => success({}),
  setBLEMTU: ({ fail }: { fail: (error: unknown) => void }) => {
    mtuFailureCount += 1;
    fail({ errMsg: 'setBLEMTU:fail:internal' });
  },
  getBLEDeviceServices: ({ success }: { success: (result: unknown) => void }) =>
    success({
      services: [{ uuid: '0000BAE8-4F05-4503-8E65-3AF1F7329D1F' }]
    }),
  getBLEDeviceCharacteristics: ({ success }: { success: (result: unknown) => void }) =>
    success({
      characteristics: [
        { uuid: 'legacy-write-char', properties: { write: true } },
        { uuid: 'legacy-notify-char', properties: { notify: true } }
      ]
    }),
  notifyBLECharacteristicValueChange: ({ success }: { success: (result: unknown) => void }) => success({}),
  getStorageSync: (key: string) => serviceCache[key] || {},
  setStorageSync: (key: string, value: unknown) => {
    serviceCache[key] = value as any;
  }
};

const state = {
  devices: { value: [] as any[] },
  isScanning: { value: false }
};
const adapter = createLegacyRingAdapter(state as any);
await adapter.startScan({ includeUnknown: true, timeoutMs: 1000 });
discoveredCallbacks[0]?.({
  devices: [
    {
      deviceId: 'scan-seen',
      name: 'SY03',
      advertisData: new Uint8Array([0xd6, 0x06, 0x02, 0x00, 0x81, 0x00, 0x52, 0x3e, 0, 0, 0, 0x05, 0x1b]).buffer
    }
  ]
});
await adapter.stopScan();

if (typeof state.devices.value[0]?.lastSeenAt !== 'number') {
  throw new Error(`Scanned devices should keep lastSeenAt for business-list freshness: ${JSON.stringify(state.devices.value[0])}`);
}

if (state.devices.value[0]?.protocol !== 'rw' || state.devices.value[0]?.advertis?.macInfo !== '3E:00:00:00:05:1B' || state.devices.value[0]?.mac !== '3E:00:00:00:05:1B') {
  throw new Error(`Default legacy scan path should keep RW stable advertis identity: ${JSON.stringify(state.devices.value[0])}`);
}

let bluetoothReady: boolean | null = null;
let disconnectedReason = '';
const adapterWithStateListener = createLegacyRingAdapter(
  {
    devices: { value: [] as any[] },
    isScanning: { value: true }
  } as any,
  {
    getDeviceInfo: () => ({ deviceId: 'sy03-id', serviceId: 'service', cmdCharId: 'write' }),
    onBluetoothReadyChange: (ready) => {
      bluetoothReady = ready;
    },
    onDisconnected: (reason) => {
      disconnectedReason = `${(reason as any)?.reason || ''}`;
    }
  }
);
adapterWithStateListener.registerConnectionStateListener();
adapterStateCallbacks[0]?.({ available: false, discovering: true });
await new Promise((resolve) => setTimeout(resolve, 0));

if (bluetoothReady !== false || disconnectedReason !== 'bluetooth_adapter_unavailable') {
  throw new Error(
    `Bluetooth adapter unavailable should notify runtime and stop business connection: ${JSON.stringify({
      bluetoothReady,
      disconnectedReason
    })}`
  );
}

const mtuFailureAdapter = createLegacyRingAdapter({
  devices: { value: [] as any[] },
  isScanning: { value: false }
} as any);
const connectedAfterMtuFailure = await mtuFailureAdapter.connectAndDiscover('mtu-fail-id', 'QKeeRingL19');

if (
  mtuFailureCount !== 1 ||
  connectedAfterMtuFailure.deviceId !== 'mtu-fail-id' ||
  connectedAfterMtuFailure.serviceId !== '0000BAE8-4F05-4503-8E65-3AF1F7329D1F' ||
  connectedAfterMtuFailure.cmdCharId !== 'legacy-write-char' ||
  connectedAfterMtuFailure.dataCharId !== 'legacy-notify-char'
) {
  throw new Error(`Legacy/RW connect should continue after Android MTU negotiation fails: ${JSON.stringify(connectedAfterMtuFailure)}`);
}

export const legacyAdapterParityPassed = true;
