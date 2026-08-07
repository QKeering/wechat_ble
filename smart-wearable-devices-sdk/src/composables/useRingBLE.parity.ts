import { createPinia, setActivePinia } from 'pinia';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const parityDebug = process.env.RING_BLE_PARITY_DEBUG === '1';
const parityStep = (name: string) => {
  if (parityDebug) {
    console.log(`[useRingBLE.parity] ${name}`);
  }
};

const useRingBleSdkSource = readFileSync(join(process.cwd(), 'src', 'composables', 'useRingBleSdk.ts'), 'utf8');
if (
  useRingBleSdkSource.includes('isSameBleChannel({ serviceId: alternateServiceId, characteristicId: alternateCharacteristicId }, primaryNotifyChannel)') ||
  useRingBleSdkSource.includes('await targetAdapter.enableNotify(readyDeviceId, alternateServiceId, alternateCharacteristicId)') ||
  !useRingBleSdkSource.includes('await targetAdapter.enableNotify(readyDeviceId, primaryNotifyServiceId, primaryNotifyCharacteristicId)') ||
  !useRingBleSdkSource.includes("notifyError: ''")
) {
  throw new Error('RW ensureCommunicationReady should restore only the primary protocol notify channel so alternate descriptor failures cannot block reconnects.');
}

if (
  !useRingBleSdkSource.includes("const shouldRefreshRwDiscovery = protocol === 'rw' && !hasRwNotifyDiscoverySnapshot(currentDevice)") ||
  !useRingBleSdkSource.includes('!shouldRefreshRwDiscovery &&') ||
  !useRingBleSdkSource.includes('const discovered = await targetAdapter.discoverServicesAndChars(')
) {
  throw new Error('RW ensureCommunicationReady should rediscover cached devices that lost alternate notify-channel metadata.');
}

if (
  !useRingBleSdkSource.includes('summarizeRingDeviceForStoreLog') ||
  !useRingBleSdkSource.includes('const RW_RECONNECT_SCAN_TIMEOUT_MS = 12000;') ||
  !useRingBleSdkSource.includes('const RW_RECONNECT_CANDIDATE_TIMEOUT_MS = 12000;') ||
  !useRingBleSdkSource.includes('const RW_DIRECT_RECONNECT_MAX_DEVICE_AGE_MS = 30000;') ||
  !useRingBleSdkSource.includes('rwReconnectScanTimeoutMs?: number;') ||
  !useRingBleSdkSource.includes('rwReconnectCandidateTimeoutMs?: number;') ||
  !useRingBleSdkSource.includes('const isFreshRwReconnectTarget =') ||
  !useRingBleSdkSource.includes("reason: 'rw-no-fresh-scan-candidate'") ||
  !useRingBleSdkSource.includes('const getRwReconnectScanTimeoutMs = () =>') ||
  !useRingBleSdkSource.includes('timeoutMs: getRwReconnectScanTimeoutMs()') ||
  !useRingBleSdkSource.includes("writeRwStoreLog('reconnect-scan-start'") ||
  !useRingBleSdkSource.includes("writeRwStoreLog('reconnect-scan-candidate'") ||
  !useRingBleSdkSource.includes("writeRwStoreLog('reconnect-connect-start'") ||
  !useRingBleSdkSource.includes("writeRwStoreLog('reconnect-connect-result'") ||
  !useRingBleSdkSource.includes('let reconnectInFlight: Promise<boolean> | null = null;') ||
  !useRingBleSdkSource.includes("writeRwStoreLog('reconnect-reuse-inflight'")
) {
  throw new Error('RW reconnect should log scan candidates, reuse in-flight restores, and connect outcomes before falling back.');
}

const storage = new Map<string, unknown>();
const valueCallbacks: Array<(result: { deviceId: string; serviceId: string; characteristicId: string; value: ArrayBuffer }) => void> = [];
const writtenHex: string[] = [];
const connectedDeviceIds: string[] = [];
const closedDeviceIds: string[] = [];
const serviceDiscoveryDeviceIds: string[] = [];
const characteristicDiscoveryDeviceIds: string[] = [];
const notifyDeviceIds: string[] = [];
const connectionStateCallbacks: Array<(result: { deviceId: string; connected: boolean }) => void> = [];
const notifyRequests: Array<{ deviceId: string; serviceId: string; characteristicId: string }> = [];
const deviceFoundCallbacks: Array<(result: { devices: Array<Record<string, any>> }) => void> = [];
const failedConnectionDeviceIds = new Set<string>();
const failedNotifyChannels = new Set<string>();
const delayedConnectionDeviceIds = new Set<string>();
const delayedServiceDiscoveryDeviceIds = new Set<string>();
const delayedCharacteristicDiscoveryDeviceIds = new Set<string>();
const delayedNotifyDeviceIds = new Set<string>();
let scanDevices: Array<Record<string, any>> = [];

const emitMockValue = (
  payload: { deviceId: string; serviceId: string; characteristicId: string; value: ArrayBuffer }
) => {
  void Promise.resolve().then(() => {
    parityStep(`mock emit value callbacks=${valueCallbacks.length} device=${payload.deviceId}`);
    valueCallbacks.slice().forEach((callback) => callback(payload));
  });
};

const emitRwMockValue = (hex: string, deviceId = 'rw-compat-history') => {
  parityStep(`mock emit rw schedule length=${hex.length} device=${deviceId || '-'}`);
  emitMockValue({
    deviceId,
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
    value: hexToBytes(hex).buffer
  });
};

const asciiToFixedHex = (value: string, length: number) => {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < Math.min(value.length, length); index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

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
  openBluetoothAdapter: (options: { success?: (result: unknown) => void } = {}) => {
    options.success?.({});
    return Promise.resolve({});
  },
  closeBluetoothAdapter: (options: { success?: (result: unknown) => void } = {}) => {
    options.success?.({});
    return Promise.resolve({});
  },
  getBluetoothAdapterState: ({ success }: { success: (result: unknown) => void }) => success({ available: true, discovering: false }),
  startBluetoothDevicesDiscovery: (options: { success?: (result: unknown) => void } = {}) => {
    parityStep(`mock start discovery devices=${scanDevices.length}`);
    options.success?.({});
    parityStep('mock start discovery success');
    setTimeout(() => {
      parityStep(`mock discovery emit devices=${scanDevices.length}`);
      deviceFoundCallbacks.forEach((callback) => callback({ devices: scanDevices }));
    }, 0);
    return Promise.resolve({});
  },
  onBluetoothDeviceFound: (callback: (result: { devices: Array<Record<string, any>> }) => void) => {
    deviceFoundCallbacks.push(callback);
  },
  getBluetoothDevices: ({ success }: { success: (result: unknown) => void }) => success({ devices: scanDevices }),
  createBLEConnection: ({
    deviceId,
    success,
    fail
  }: {
    deviceId: string;
    success: (result: unknown) => void;
    fail?: (error: unknown) => void;
  }) => {
    parityStep(`mock create connection device=${deviceId}`);
    connectedDeviceIds.push(deviceId);
    if (failedConnectionDeviceIds.has(deviceId)) {
      fail?.({ errMsg: 'createBLEConnection:fail mock' });
      return;
    }
    if (delayedConnectionDeviceIds.has(deviceId)) {
      setTimeout(() => success({}), 20);
      return;
    }
    success({});
  },
  setBLEMTU: ({ success }: { success: (result: unknown) => void }) => success({ mtu: 512 }),
  onBLEConnectionStateChange: (callback: (result: { deviceId: string; connected: boolean }) => void) => {
    connectionStateCallbacks.push(callback);
  },
  offBLEConnectionStateChange: () => {
    connectionStateCallbacks.length = 0;
  },
  onBluetoothAdapterStateChange: () => undefined,
  offBluetoothAdapterStateChange: () => undefined,
  offBluetoothDeviceFound: () => {
    deviceFoundCallbacks.length = 0;
  },
  stopBluetoothDevicesDiscovery: (options: { success?: (result: unknown) => void; fail?: (error: unknown) => void } = {}) => {
    options.success?.({});
    return Promise.resolve({});
  },
  onBLECharacteristicValueChange: (
    callback: (result: { deviceId: string; serviceId: string; characteristicId: string; value: ArrayBuffer }) => void
  ) => {
    valueCallbacks.push((result) => {
      parityStep(`mock value callback enter device=${result.deviceId} service=${result.serviceId} char=${result.characteristicId}`);
      callback(result);
    });
  },
  offBLECharacteristicValueChange: () => {
    valueCallbacks.length = 0;
  },
  getBLEDeviceServices: ({ deviceId, success }: { deviceId: string; success: (result: unknown) => void }) => {
    parityStep(`mock get services device=${deviceId}`);
    serviceDiscoveryDeviceIds.push(deviceId);
    const respond = () =>
      success({
        services: [
          {
            uuid: '0000A00A-0000-1000-8000-00805F9B34FB'
          }
        ]
      });
    if (delayedServiceDiscoveryDeviceIds.has(deviceId)) {
      setTimeout(respond, 20);
      return;
    }
    respond();
  },
  getBLEDeviceCharacteristics: ({
    deviceId,
    serviceId,
    success
  }: {
    deviceId: string;
    serviceId: string;
    success: (result: unknown) => void;
  }) => {
    parityStep(`mock get chars device=${deviceId} service=${serviceId}`);
    characteristicDiscoveryDeviceIds.push(deviceId);
    const respond = () =>
      success({
        characteristics: [
          {
            uuid: '0000B002-0000-1000-8000-00805F9B34FB',
            properties: { write: true, writeNoResponse: true }
          },
          {
            uuid: '0000B003-0000-1000-8000-00805F9B34FB',
            properties: { notify: true, indicate: true }
          }
        ],
        serviceId
      });
    if (delayedCharacteristicDiscoveryDeviceIds.has(deviceId)) {
      setTimeout(respond, 20);
      return;
    }
    respond();
  },
  notifyBLECharacteristicValueChange: ({
    deviceId,
    serviceId,
    characteristicId,
    success,
    fail
  }: {
    deviceId: string;
    serviceId: string;
    characteristicId: string;
    success: (result: unknown) => void;
    fail?: (error: unknown) => void;
  }) => {
    parityStep(`mock notify device=${deviceId} service=${serviceId} char=${characteristicId}`);
    notifyDeviceIds.push(deviceId);
    notifyRequests.push({ deviceId, serviceId, characteristicId });
    if (failedNotifyChannels.has(`${deviceId}|${serviceId}|${characteristicId}`)) {
      fail?.({ errMsg: 'notifyBLECharacteristicValueChange:fail mock' });
      return;
    }
    if (delayedNotifyDeviceIds.has(deviceId)) {
      setTimeout(() => success({}), 20);
      return;
    }
    success({});
  },
  writeBLECharacteristicValue: ({
    deviceId,
    serviceId,
    characteristicId,
    value,
    success
  }: {
    deviceId?: string;
    serviceId?: string;
    characteristicId?: string;
    value: ArrayBuffer;
    success: (result: unknown) => void;
  }) => {
    const hex = Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const command = hex.slice(4, 8);
    const normalizedServiceId = String(serviceId || '').toUpperCase();
    const normalizedCharacteristicId = String(characteristicId || '').toUpperCase();
    const isRwWriteChannel =
      String(deviceId || '').startsWith('rw-') ||
      normalizedServiceId === '0000A00A-0000-1000-8000-00805F9B34FB' ||
      normalizedCharacteristicId === '0000B002-0000-1000-8000-00805F9B34FB';
    parityStep(`mock write device=${deviceId || '-'} command=${command} rw=${isRwWriteChannel ? '1' : '0'}`);
    writtenHex.push(hex);

    if (isRwWriteChannel && hex.endsWith('020310')) {
      emitRwMockValue('ab110006af140203104d0f99', deviceId);
    }
    if (isRwWriteChannel && hex.endsWith('020410')) {
      emitRwMockValue('ab110013a39d02041002020900300040003330336530303031', deviceId);
    }
    if (isRwWriteChannel && hex.endsWith('050310')) {
      emitRwMockValue('ab11000400000503104b', deviceId);
    }
    if (isRwWriteChannel && hex.endsWith('050910')) {
      emitRwMockValue('ab110004000005091062', deviceId);
    }
    if (isRwWriteChannel && hex.endsWith('050810')) {
      emitRwMockValue('ab11000500000508106f01', deviceId);
    }
    if (isRwWriteChannel && hex.endsWith('022410')) {
      emitRwMockValue('ab11000943e5022400033328cc4600', deviceId);
    }
    if (isRwWriteChannel && hex.endsWith('024e10')) {
      emitRwMockValue('ab11000951f1024e002e1fe4066300', deviceId);
    }
    if (isRwWriteChannel && hex.endsWith('023010')) {
      emitRwMockValue('ab11000500000230107201', deviceId);
    }
    if (isRwWriteChannel && hex.endsWith('027d10')) {
      emitRwMockValue('ab1100090000027d10010102030405', deviceId);
    }
    if (isRwWriteChannel && command === '1001') {
      emitRwMockValue(`00${hex.slice(2, 4) || '00'}1001`, deviceId);
    }
    const controlAck = /^ab01[0-9a-f]{4}[0-9a-f]{4}060900([0-9a-f]{2})05(00|01)$/i.exec(hex);
    if (isRwWriteChannel && controlAck) {
      emitRwMockValue(`ab1100060000060900${controlAck[1]}05${controlAck[2]}`, deviceId);
    }
    if (command === '3600' || command === '3601' || command === '3610') {
      parityStep(`mock rw file-list branch command=${command} hex=${hex}`);
      emitRwMockValue('0043361001000000010000001000000075315f32303236303130313031303130315f68722e747874000000');
    }
    if (command === '361a') {
      const seqHex = hex.slice(8, 10) || '00';
      const fileNameHex = asciiToFixedHex('u1_20260101010101_hr.txt', 36);
      emitRwMockValue(`0044361b${seqHex}02cd5f3178cd5f3178${fileNameHex}`, deviceId);
    }
    if (command === '3601' && !isRwWriteChannel) {
      emitMockValue({
        deviceId: 'l19-compat-history',
        serviceId: '0000BAE8-0000-1000-8000-00805F9B34FB',
        characteristicId: '0000BAEA-0000-1000-8000-00805F9B34FB',
        value: hexToBytes('0001360100000000').buffer
      });
    }
    success({});
  },
  closeBLEConnection: ({ deviceId, success }: { deviceId: string; success: (result: unknown) => void }) => {
    closedDeviceIds.push(deviceId);
    success({});
  }
};

setActivePinia(createPinia());

const { useRingBLE } = await import('./useRingBLE');
const {
  enrichParsedDataWithCurrentRing,
  findReconnectScanCandidate,
  getRingDeviceStableIdentity,
  isExpectedRingDevice,
  isParsedDataForCurrentRing,
  isSameRingDevice,
  isSwitchingRingDevice,
  shouldReconnectByScanningFirst,
  shouldSkipDirectRwReconnect,
  useRingBleSdk
} = await import('./useRingBleSdk');

type RingBLECompat = ReturnType<typeof useRingBLE>;

type LegacyUseRingBLEPublicKeys =
  | 'devices'
  | 'connectedDeviceId'
  | 'healthData'
  | 'latestMetrics'
  | 'normalMac'
  | 'iosMacId'
  | 'deviceTime'
  | 'lastReadTimestamp'
  | 'lastMetricUpdateAt'
  | 'localData'
  | 'historyRecords'
  | 'isScanning'
  | 'initBluetooth'
  | 'startScan'
  | 'restartScan'
  | 'stopScan'
  | 'connectDevice'
  | 'cancelPendingConnection'
  | 'handleConnectDevice'
  | 'discoverServicesAndChars'
  | 'disconnect'
  | 'reScan'
  | 'autoConnectLastDevice'
  | 'registerGlobalListeners'
  | 'cleanup'
  | 'refreshBusinessMetrics'
  | 'isDeviceConnected'
  | 'sendBatteryCommand'
  | 'sendActiveMeasureCommand'
  | 'readLocalData'
  | 'readDeviceTime'
  | 'updateDeviceTime'
  | 'sendDeleteAllLocalDataCommand'
  | 'sendOxyGenCommand'
  | 'sendBodyTemperatureCommand'
  | 'sendFirmwareVersion'
  | 'sendSoftwareVersion'
  | 'sendResetCommand'
  | 'sendCollectPeriodSettingCommand'
  | 'readCollectPeriodCommand'
  | 'refreshHealthData'
  | 'refreshBusinessData'
  | 'readHealthData'
  | 'syncHistoricalData'
  | 'syncHistoryData'
  | 'syncLocalData'
  | 'readBattery'
  | 'getBattery'
  | 'getBatteryInfo'
  | 'readFirmwareVersion'
  | 'getFirmwareVersion'
  | 'readSoftwareVersion'
  | 'getSoftwareVersion'
  | 'readHeartRate'
  | 'getHeartRate'
  | 'measureHeartRate'
  | 'readHR'
  | 'getHR'
  | 'measureHR'
  | 'readBloodOxygen'
  | 'getBloodOxygen'
  | 'measureBloodOxygen'
  | 'readOxygen'
  | 'getOxygen'
  | 'measureOxygen'
  | 'readSpO2'
  | 'getSpO2'
  | 'measureSpO2'
  | 'readSpo2'
  | 'getSpo2'
  | 'measureSpo2'
  | 'readBodyTemperature'
  | 'getBodyTemperature'
  | 'measureBodyTemperature'
  | 'readSkinTemperature'
  | 'getSkinTemperature'
  | 'measureSkinTemperature'
  | 'readSkinTemp'
  | 'getSkinTemp'
  | 'measureSkinTemp'
  | 'readTemperature'
  | 'getTemperature'
  | 'measureTemperature'
  | 'readHrv'
  | 'getHrv'
  | 'measureHrv'
  | 'readHRV'
  | 'getHRV'
  | 'measureHRV'
  | 'readStress'
  | 'getStress'
  | 'measureStress'
  | 'readBloodSugar'
  | 'getBloodSugar'
  | 'measureBloodSugar'
  | 'readBloodPressure'
  | 'getBloodPressure'
  | 'measureBloodPressure'
  | 'readBP'
  | 'getBP'
  | 'measureBP'
  | 'getTimedHeartRateJL'
  | 'getTimedBloodOxygenJL'
  | 'getTimedHRVJL'
  | 'getTimedStressJL'
  | 'getTimedBloodSugarJL'
  | 'getTimedBloodPressureJL'
  | 'getTimedTemperatureJL'
  | 'setTimedHeartRateJL'
  | 'setTimedBloodOxygenJL'
  | 'setTimedHRVJL'
  | 'setTimedStressJL'
  | 'setTimedBloodSugarJL'
  | 'setTimedBloodPressureJL'
  | 'setTimedTemperatureJL'
  | 'controlHealthDataJL'
  | 'readRwHealthData'
  | 'deleteRwHealthData'
  | 'controlRwHealthData'
  | 'readRwMonitoringConfig'
  | 'setRwMonitoringConfig'
  | 'setRwUserProfile'
  | 'formatRwFileSystem'
  | 'syncAllHealthData'
  | 'syncHealthDataByType';

type MissingLegacyUseRingBLEKeys = Exclude<LegacyUseRingBLEPublicKeys, keyof RingBLECompat>;

const assertNoMissingLegacyUseRingBLEKeys: MissingLegacyUseRingBLEKeys extends never ? true : never = true;

const compat = useRingBLE();
parityStep('runtime facade created');
const compatSource = readFileSync(join(process.cwd(), 'src', 'composables', 'useRingBLE.ts'), 'utf8');
const sdkSource = readFileSync(join(process.cwd(), 'src', 'composables', 'useRingBleSdk.ts'), 'utf8');
const legacyAdapterSource = readFileSync(join(process.cwd(), 'src', 'sdk', 'ring-ble', 'legacy', 'adapter.ts'), 'utf8');
const qkeerV2AdapterSource = readFileSync(join(process.cwd(), 'src', 'sdk', 'ring-ble', 'qkeer-v2', 'adapter.ts'), 'utf8');
const debugPageSource = readFileSync(join(process.cwd(), 'src', 'pages', 'ring', 'debug.vue'), 'utf8');
const requiredRuntimeKeys: LegacyUseRingBLEPublicKeys[] = [
  'devices',
  'connectedDeviceId',
  'healthData',
  'latestMetrics',
  'normalMac',
  'iosMacId',
  'deviceTime',
  'lastReadTimestamp',
  'lastMetricUpdateAt',
  'localData',
  'historyRecords',
  'isScanning',
  'initBluetooth',
  'startScan',
  'restartScan',
  'stopScan',
  'connectDevice',
  'cancelPendingConnection',
  'handleConnectDevice',
  'discoverServicesAndChars',
  'disconnect',
  'reScan',
  'autoConnectLastDevice',
  'registerGlobalListeners',
  'cleanup',
  'refreshBusinessMetrics',
  'isDeviceConnected',
  'sendBatteryCommand',
  'sendActiveMeasureCommand',
  'readLocalData',
  'readDeviceTime',
  'updateDeviceTime',
  'sendDeleteAllLocalDataCommand',
  'sendOxyGenCommand',
  'sendBodyTemperatureCommand',
  'sendFirmwareVersion',
  'sendSoftwareVersion',
  'sendResetCommand',
  'sendCollectPeriodSettingCommand',
  'readCollectPeriodCommand',
  'refreshHealthData',
  'refreshBusinessData',
  'readHealthData',
  'syncHistoricalData',
  'syncHistoryData',
  'syncLocalData',
  'readBattery',
  'getBattery',
  'getBatteryInfo',
  'readFirmwareVersion',
  'getFirmwareVersion',
  'readSoftwareVersion',
  'getSoftwareVersion',
  'readHeartRate',
  'getHeartRate',
  'measureHeartRate',
  'readBloodOxygen',
  'getBloodOxygen',
  'measureBloodOxygen',
  'readBodyTemperature',
  'getBodyTemperature',
  'measureBodyTemperature',
  'readSkinTemperature',
  'getSkinTemperature',
  'measureSkinTemperature',
  'readSkinTemp',
  'getSkinTemp',
  'measureSkinTemp',
  'readHrv',
  'getHrv',
  'measureHrv',
  'readStress',
  'getStress',
  'measureStress',
  'readBloodSugar',
  'getBloodSugar',
  'measureBloodSugar',
  'readBloodPressure',
  'getBloodPressure',
  'measureBloodPressure',
  'getTimedHeartRateJL',
  'getTimedBloodOxygenJL',
  'getTimedHRVJL',
  'getTimedStressJL',
  'getTimedBloodSugarJL',
  'getTimedBloodPressureJL',
  'getTimedTemperatureJL',
  'setTimedHeartRateJL',
  'setTimedBloodOxygenJL',
  'setTimedHRVJL',
  'setTimedStressJL',
  'setTimedBloodSugarJL',
  'setTimedBloodPressureJL',
  'setTimedTemperatureJL',
  'controlHealthDataJL',
  'readRwHealthData',
  'deleteRwHealthData',
  'controlRwHealthData',
  'readRwMonitoringConfig',
  'setRwMonitoringConfig',
  'setRwUserProfile',
  'formatRwFileSystem',
  'syncAllHealthData',
  'syncHealthDataByType'
];

for (const key of requiredRuntimeKeys) {
  if (!(key in compat)) {
    throw new Error(`useRingBLE compatibility entry is missing ${key}.`);
  }
}

if (
  !compatSource.includes('const ready = await sdk.ensureCommunicationReady()') ||
  !compatSource.includes("throw new Error('Ring BLE communication is not ready.')")
) {
  throw new Error('useRingBLE compatibility facade should stop command reads when unified BLE communication is not ready.');
}

if (
  !sdkSource.includes('const initBluetooth = async') ||
  !sdkSource.includes('const startScanWithProtocol = async') ||
  !sdkSource.includes("return startScanWithProtocol('legacy', input)") ||
  !sdkSource.includes('await startScanWithProtocol(scanProtocol, {') ||
  !sdkSource.includes('const targetAdapter = await switchAdapter(protocol)') ||
  !sdkSource.includes('targetAdapter.registerConnectionStateListener()') ||
  !sdkSource.includes('const findKnownDevice =') ||
  !sdkSource.includes('const discoverServicesAndChars = async') ||
  !sdkSource.includes('const matchedDevice = sourceDevice || findKnownDevice(deviceId, deviceName)') ||
  !sdkSource.includes('const switchAdapterForDeviceTool = async') ||
  !sdkSource.includes('isRwServiceUuid(serviceId)') ||
  !sdkSource.includes('const isDeviceConnected = async') ||
  !sdkSource.includes('const registerGlobalListeners = async') ||
  !compatSource.includes('return sdk.discoverServicesAndChars(deviceId, deviceName, sourceDevice)') ||
  !sdkSource.includes("sendBytes: (...args: Parameters<LegacyRingAdapter['sendBytes']>) => runWithReady(() => adapter.sendBytes(...args))")
) {
  throw new Error('useRingBleSdk command sends should ensure communication and re-register the active protocol connection listener after adapter switching.');
}

const deviceToolProtocolSelection = sdkSource.slice(
  sdkSource.indexOf('const switchAdapterForDeviceTool = async'),
  sdkSource.indexOf('const resolvePlatformDeviceIdForDeviceTool =')
);
if (
  !deviceToolProtocolSelection.includes("(isRwServiceUuid(serviceId) ? 'rw' : undefined)") ||
  deviceToolProtocolSelection.indexOf("(isRwServiceUuid(serviceId) ? 'rw' : undefined)") >
    deviceToolProtocolSelection.indexOf('matchedDevice?.protocol') ||
  deviceToolProtocolSelection.indexOf("(isRwServiceUuid(serviceId) ? 'rw' : undefined)") >
    deviceToolProtocolSelection.indexOf('currentMatchesDevice || currentMatchesService')
) {
  throw new Error('useRingBleSdk device tools should let an explicit RW service UUID override stale matched/current protocol state.');
}

if (
  !debugPageSource.includes('ensureCommunicationReady,') ||
  !debugPageSource.includes('const ensureDebugCommunicationReady = async () =>') ||
  !debugPageSource.includes('await ensureDebugCommunicationReady();') ||
  !debugPageSource.includes('const pending = waitForParsedData((parsed) => match(parsed), 15000)') ||
  !debugPageSource.includes('buildRwControlHealthDataCommand(rwHealthDataKeys[name], true)')
) {
  throw new Error('RW debug raw command probes should ensure the active protocol adapter before waiting for parsed RW responses.');
}

if (
  !compatSource.includes('DEFAULT_COMPAT_REFRESH_OPTIONS') ||
  !compatSource.includes('DEFAULT_COMPAT_REFRESH_TIMEOUT_MS = 3500') ||
  !compatSource.includes('RW_COMPAT_REFRESH_TIMEOUT_MS = 35000') ||
  !compatSource.includes('const getCompatRefreshOptions = (params?: CompatRefreshOptions): CompatRefreshOptions => {') ||
  !compatSource.includes("const protocol = resolveRingProtocol(sdk.deviceInfo.value);") ||
  !compatSource.includes('includeDeviceTime: false') ||
  !compatSource.includes('includeCollectPeriod: false') ||
  !compatSource.includes('includeRealtimeMetrics: false') ||
  !compatSource.includes('includeHistorySnapshot: false') ||
  !compatSource.includes('...DEFAULT_COMPAT_REFRESH_OPTIONS') ||
  !compatSource.includes('type DefinedCompatRefreshOptions = NonNullable<CompatRefreshOptions>') ||
  !compatSource.includes('const stripUndefinedCompatRefreshOptions = (params?: CompatRefreshOptions): DefinedCompatRefreshOptions => {') ||
  !compatSource.includes('const value = (params as Record<string, unknown>)[key];') ||
  !compatSource.includes('if (value !== undefined) result[key] = value;') ||
  !compatSource.includes('const explicitParams = stripUndefinedCompatRefreshOptions(params);') ||
  !compatSource.includes('...explicitParams') ||
  !compatSource.includes("timeoutMs: explicitParams.timeoutMs ?? (protocol === 'rw' ? RW_COMPAT_REFRESH_TIMEOUT_MS : DEFAULT_COMPAT_REFRESH_TIMEOUT_MS)") ||
  !compatSource.includes('createCompatRefreshFailure') ||
  !compatSource.includes('refreshBusinessMetrics: refreshHealthData') ||
  compatSource.includes('...(params || {})')
) {
  throw new Error(
    'useRingBLE compatibility refresh should default to protocol-aware lightweight snapshots, ignore undefined overrides, and return normalized refresh failures.'
  );
}

if (compat.refreshBusinessMetrics !== compat.refreshHealthData) {
  throw new Error('useRingBLE refreshBusinessMetrics should route through the lightweight compatibility refresh.');
}

compat.deviceInfo.value = { deviceId: 'compat-device' } as any;
if (compat.connectedDeviceId.value !== 'compat-device') {
  throw new Error(`useRingBLE connectedDeviceId should mirror current device id: ${compat.connectedDeviceId.value}`);
}

compat.deviceInfo.value = {
  deviceId: 'rw-compat-device',
  uniMacId: 'ios-random-uuid',
  protocol: 'rw',
  advertis: { macInfo: '3E:00:00:00:05:1B' }
} as any;
compat.ringStore.setNormalMac('');
compat.ringStore.setIosMacId('');
if (compat.normalMac.value !== '3E:00:00:00:05:1B' || compat.iosMacId.value !== '3E:00:00:00:05:1B') {
  throw new Error(
    `useRingBLE legacy MAC aliases should fall back to RW advertis macInfo: ${JSON.stringify({
      normalMac: compat.normalMac.value,
      iosMacId: compat.iosMacId.value
    })}`
  );
}

compat.ringStore.setNormalizedData([
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'heart_rate',
      value: 69,
      data: [69]
    }
  }
] as any);
compat.ringStore.setNormalMac('00:05:1B');
compat.ringStore.setIosMacId('ios-mac-id');
compat.ringStore.setLastReadTimestamp(1710000000);
  compat.ringStore.setLocalData([{ dataType: 'heart_rate', unixTime: 1710000000 }] as any);
  compat.ringStore.appendHistoryRecords([{ dataType: 'sleep', unixTime: 1710000300 }] as any);
await new Promise((resolve) => setTimeout(resolve, 0));

if (compat.normalMac.value !== '3E:00:00:00:05:1B') {
  throw new Error(`useRingBLE should prefer the current RW stable MAC over stale store normalMac: ${compat.normalMac.value}`);
}
if (compat.iosMacId.value !== '3E:00:00:00:05:1B') {
  throw new Error(`useRingBLE should prefer the current RW stable MAC over stale store iosMacId: ${compat.iosMacId.value}`);
}

compat.deviceInfo.value = {
  deviceId: 'rw-random-platform-id',
  uniMacId: 'rw-random-uni-id',
  protocol: 'rw'
} as any;

if (compat.normalMac.value || compat.iosMacId.value) {
  throw new Error(
    `useRingBLE should not expose stale L19 store MAC aliases for RW devices without a stable identity: ${JSON.stringify({
      normalMac: compat.normalMac.value,
      iosMacId: compat.iosMacId.value
    })}`
  );
}

compat.ringStore.setNormalMac('00:05:1B');
compat.ringStore.setIosMacId('ios-mac-id');
compat.deviceInfo.value = { deviceId: 'legacy-compat-device', protocol: 'legacy' } as any;

if (
  compat.healthData.value.heartRate !== 69 ||
  compat.latestMetrics.value.heartRate !== 69 ||
  compat.normalMac.value !== '00:05:1B' ||
  compat.iosMacId.value !== 'ios-mac-id' ||
  compat.lastReadTimestamp.value !== 1710000000 ||
  !compat.lastMetricUpdateAt.value ||
  compat.localData.value.length === 0 ||
  compat.historyRecords.value.length === 0
) {
  throw new Error(
    `useRingBLE should expose legacy store-backed aliases from the unified SDK: ${JSON.stringify({
      healthData: compat.healthData.value,
      latestMetrics: compat.latestMetrics.value,
      normalMac: compat.normalMac.value,
      iosMacId: compat.iosMacId.value,
      lastReadTimestamp: compat.lastReadTimestamp.value,
      lastMetricUpdateAt: compat.lastMetricUpdateAt.value,
      localData: compat.localData.value,
      historyRecords: compat.historyRecords.value
    })}`
  );
}

if (
  !compatSource.includes('const findScannedDevice =') ||
  !compatSource.includes('const healthData = computed(() => sdk.ringStore.healthData)') ||
  !compatSource.includes('const latestMetrics = computed(() => sdk.ringStore.latestMetrics)') ||
  !compatSource.includes('const lastMetricUpdateAt = computed(() => sdk.ringStore.lastMetricUpdateAt') ||
  !compatSource.includes('const getCurrentRwStableMac =') ||
  !compatSource.includes("resolveRingProtocol(sdk.deviceInfo.value) === 'rw'") ||
  !compatSource.includes('return getCurrentRwStableMac() ||') ||
  !compatSource.includes('sdk.deviceInfo.value.advertis?.macInfo') ||
  !compatSource.includes('const getRwStableCompatIdentity =') ||
  !compatSource.includes('const getScannedStableIdentities =') ||
  !compatSource.includes('isColonSeparatedBleMac(device.uniMacId) ? device.uniMacId :') ||
  !compatSource.includes('const allowUniMacPlatformMatch = protocol !==') ||
  !compatSource.includes('resolveRingProtocol') ||
  !compatSource.includes('const protocolSource: RingDeviceInfo') ||
  !compatSource.includes('deviceName: sourceDevice?.deviceName || inputDevice?.deviceName || preferredName') ||
  !compatSource.includes('const protocol = resolveRingProtocol(protocolSource)') ||
  !compatSource.includes('const shouldResolveRwStableId =') ||
  !compatSource.includes("uniMacId: protocol === 'rw' ? connectionMac : sourceDevice?.uniMacId || connectionMac") ||
  !compatSource.includes('fromScan: fromScan || Boolean(sourceDevice)') ||
  !compatSource.includes('sourceDevice: connectSourceDevice') ||
  !compatSource.includes('bindAfterConnected: true') ||
  !compatSource.includes('parseCompatHistorySinceTimestamp') ||
  !compatSource.includes('let rwCompatHistoryQueue: Promise<unknown> = Promise.resolve()') ||
  !compatSource.includes('let rwCompatHistoryQueueDepth = 0') ||
  !compatSource.includes('const runRwCompatHistoryExclusive = async <T>') ||
  !compatSource.includes("appendRwCompatHistoryDiagnosticLog('compat-history-queue-enqueue'") ||
  !compatSource.includes("appendRwCompatHistoryDiagnosticLog('compat-history-queue-start'") ||
  !compatSource.includes("appendRwCompatHistoryDiagnosticLog('compat-history-queue-result'") ||
  !compatSource.includes("appendRwCompatHistoryDiagnosticLog('compat-history-queue-failed'") ||
  !compatSource.includes('const historyOptions = {') ||
  !compatSource.includes('const task = () => sdk.syncHistory(historyOptions)') ||
  !compatSource.includes('sinceTimestamp') ||
  !compatSource.includes('interface CompatReadLocalDataOptions') ||
  !compatSource.includes('readOptions: CompatReadLocalDataOptions = {}') ||
  !compatSource.includes('const timeoutMs = Number(readOptions.timeoutMs)') ||
  !compatSource.includes('...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {})') ||
  !compatSource.includes("if (resolveRingProtocol(sdk.deviceInfo.value) !== 'rw') return task()") ||
  !compatSource.includes('return runRwCompatHistoryExclusive(task, {') ||
  !compatSource.includes('const normalizedDataTypes = Array.isArray(dataType)') ||
  !compatSource.includes('const normalizedDataType = dataType && !Array.isArray(dataType) ? normalizeCompatRwHistoryDataName(dataType) : undefined') ||
  !compatSource.includes('...(normalizedDataType ? { dataType: normalizedDataType } : {})') ||
  !compatSource.includes('...(normalizedDataTypes?.length ? { dataTypes: normalizedDataTypes } : {})') ||
  !compatSource.includes('timeoutMs: historyOptions.timeoutMs') ||
  !compatSource.includes('const syncAllHealthData = () => runWithReady(() => sdk.syncAllHealthData())') ||
  !compatSource.includes('const syncHealthDataByType = (name?: CompatRwHistoryDataName)') ||
  !compatSource.includes('sdk.syncHealthDataByType(name ? normalizeCompatRwHistoryDataName(name) : undefined)') ||
  !compatSource.includes('const readDeviceTime = () => runWithReady(() => sdk.readDeviceTime())') ||
  !compatSource.includes('const updateDeviceTime = (...args: Parameters<typeof sdk.updateDeviceTime>) => runWithReady(() => sdk.updateDeviceTime(...args))') ||
  !compatSource.includes('const sendDeleteAllLocalDataCommand = () => runWithReady(() => sdk.sendDeleteAllLocalDataCommand())') ||
  !compatSource.includes('const sendResetCommand = () => runWithReady(() => sdk.sendResetCommand())') ||
  !compatSource.includes('const sendFactoryResetWithTimeCommand = () => runWithReady(() => sdk.sendFactoryResetWithTimeCommand())') ||
  !compatSource.includes('const sendCollectPeriodSettingCommand = (...args: Parameters<typeof sdk.sendCollectPeriodSettingCommand>)') ||
  !compatSource.includes('const readCollectPeriodCommand = () => runWithReady(() => sdk.readCollectPeriodCommand())') ||
  !compatSource.includes('const getTimedBloodOxygenJL = () => runWithReady(() => sdk.getTimedBloodOxygenJL())') ||
  !compatSource.includes('const getTimedTemperatureJL = () => runWithReady(() => sdk.getTimedTemperatureJL())') ||
  !compatSource.includes('const setTimedBloodPressureJL = (config: RwHealthMonitoringConfig) => runWithReady(() => sdk.setTimedBloodPressureJL(config))') ||
  !compatSource.includes('const setTimedTemperatureJL = (config: RwHealthMonitoringConfig) => runWithReady(() => sdk.setTimedTemperatureJL(config))') ||
  !compatSource.includes('const controlHealthDataJL = (name: CompatRwHealthDataName, enabled = true)') ||
  !compatSource.includes('sdk.controlHealthDataJL(normalizeCompatRwHealthDataName(name), enabled)') ||
  !compatSource.includes('const readRwHealthData = (name: CompatRwHealthDataName) => runWithReady(() => sdk.readRwHealthData(normalizeCompatRwHealthDataName(name)))') ||
  !compatSource.includes('const normalizeCompatRwHealthDataName = (name: CompatRwHealthDataName): RwHealthDataName =>') ||
  !compatSource.includes('const normalizeCompatRwHistoryDataName = (name: CompatRwHistoryDataName): CompatRwHistoryDataName =>') ||
  !compatSource.includes("compact === 'sleepdata'") ||
  !compatSource.includes("compact === 'activity'") ||
  !compatSource.includes('const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))') ||
  !compatSource.includes('await sleep(120)') ||
  !compatSource.includes('await sdk.controlRwHealthData(normalizedName, false).catch(() => undefined);') ||
  !compatSource.includes('const formatRwFileSystem = () => runWithReady(() => sdk.formatRwFileSystem())') ||
  !compatSource.includes("time === '' || time === 'day'") ||
  !compatSource.includes('parseCompatLocalDateStartTimestamp(time)') ||
  !compatSource.includes('new Date(year, month - 1, day)') ||
  !compatSource.includes('Date.parse(time)') ||
  !compatSource.includes('return connectDevice(deviceId, deviceName, uniMacId, _fromScan)')
) {
  throw new Error('useRingBLE connect helpers should preserve legacy fromScan/name metadata and bind compatible connections for protocol routing.');
}

if (
  !compatSource.includes('matchesScannedStableIdentity(device, deviceId, false)') ||
  !compatSource.includes('matchesScannedStableIdentity(device, uniMacId, true)') ||
  !compatSource.includes("protocol === 'rw'") ||
  !compatSource.includes('return [device.mac, device.advertis?.macInfo, isColonSeparatedBleMac(device.uniMacId) ? device.uniMacId :')
) {
  throw new Error('useRingBLE scan lookup should separate platform deviceId matching from RW stable MAC tail matching.');
}

if (
  compatSource.includes('isSameRingDevice(device, { deviceId, uniMacId: deviceId, mac: deviceId }') ||
  compatSource.includes('isSameRingDevice(device, { deviceId: uniMacId, uniMacId, mac: uniMacId }')
) {
  throw new Error('useRingBLE scan lookup should not promote arbitrary platform ids into stable MAC identity fields.');
}

const compatHistorySinceTimestamp = Math.floor(new Date(2026, 0, 2).getTime() / 1000);
compat.deviceInfo.value = {
  deviceId: 'rw-compat-history',
  name: 'SY03',
  protocol: 'rw',
  advertis: { macInfo: '3E:00:00:00:05:1B' },
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
} as any;
writtenHex.length = 0;
parityStep('compat rw lightweight refresh start');
const rwUndefinedRefreshResult = (await compat.refreshHealthData({
  includeDeviceInfo: false,
  includeDeviceTime: false,
  includeCollectPeriod: false,
  includeRealtimeMetrics: undefined,
  includeHistorySnapshot: undefined,
  timeoutMs: 20
} as any)) as any;
parityStep('compat rw lightweight refresh result');
if (
  writtenHex.length > 0 ||
  !rwUndefinedRefreshResult?.ok?.includes('heart_rate_skipped') ||
  !rwUndefinedRefreshResult?.ok?.includes('blood_oxygen_skipped') ||
  !rwUndefinedRefreshResult?.ok?.includes('temperature_skipped') ||
  !rwUndefinedRefreshResult?.ok?.includes('history_snapshot_skipped')
) {
  throw new Error(
    `useRingBLE RW refresh should not let undefined params override lightweight defaults: ${JSON.stringify({
      writtenHex,
      rwUndefinedRefreshResult
    })}`
  );
}

writtenHex.length = 0;
parityStep('compat rw readLocalData date start');
const compatHistoryResult = (await compat.readLocalData(false, new Date(2026, 0, 2))) as any;
parityStep('compat rw readLocalData date result');
if (
  !writtenHex.some((hex) => hex.slice(4, 8) === '3600') ||
  compatHistoryResult?.parsed?.protocol !== 'rw' ||
  compatHistoryResult?.parsed?.status !== 'filtered' ||
  compatHistoryResult?.parsed?.sinceTimestamp !== compatHistorySinceTimestamp ||
  compatHistoryResult?.parsed?.selectedFileCount !== 0 ||
  compatHistoryResult?.parsed?.filteredFileCount !== 1 ||
  compatHistoryResult?.parsed?.readAll !== false
) {
  throw new Error(
    `useRingBLE readLocalData(false, Date) should preserve L19 history range semantics on RW: ${JSON.stringify({
      writtenHex,
      compatHistorySinceTimestamp,
      compatHistoryResult
    })}`
  );
}

writtenHex.length = 0;
parityStep('compat rw readLocalData date-string start');
const compatHistoryDateStringResult = (await compat.readLocalData(false, '2026-01-02')) as any;
parityStep('compat rw readLocalData date-string result');
if (
  !writtenHex.some((hex) => hex.slice(4, 8) === '3600') ||
  compatHistoryDateStringResult?.parsed?.protocol !== 'rw' ||
  compatHistoryDateStringResult?.parsed?.sinceTimestamp !== compatHistorySinceTimestamp ||
  compatHistoryDateStringResult?.parsed?.selectedFileCount !== 0 ||
  compatHistoryDateStringResult?.parsed?.filteredFileCount !== 1
) {
  throw new Error(
    `useRingBLE readLocalData(false, yyyy-mm-dd) should use local day start like L19 detail pages: ${JSON.stringify({
      writtenHex,
      compatHistorySinceTimestamp,
      compatHistoryDateStringResult
    })}`
  );
}

writtenHex.length = 0;
const compatMultiTypeHistorySinceTimestamp = Math.floor(new Date(2026, 0, 1).getTime() / 1000);
parityStep('compat rw readLocalData multi-type start');
const compatMultiTypeHistoryResult = (await compat.readLocalData(false, '2026-01-01', [
  'heartRate',
  'bloodOxygen',
  'skinTemperature'
])) as any;
parityStep('compat rw readLocalData multi-type result');
if (
  !writtenHex.some((hex) => hex.slice(4, 8) === '3600') ||
  compatMultiTypeHistoryResult?.parsed?.protocol !== 'rw' ||
  compatMultiTypeHistoryResult?.parsed?.sinceTimestamp !== compatMultiTypeHistorySinceTimestamp ||
  compatMultiTypeHistoryResult?.parsed?.selectedFileCount !== 1 ||
  compatMultiTypeHistoryResult?.parsed?.filteredFileCount !== 0 ||
  JSON.stringify(compatMultiTypeHistoryResult?.parsed?.dataTypes) !==
    JSON.stringify(['heart_rate', 'blood_oxygen', 'temperature'])
) {
  throw new Error(
    `useRingBLE readLocalData should support one RW history read with multiple selected data types: ${JSON.stringify({
      writtenHex,
      compatMultiTypeHistorySinceTimestamp,
      compatMultiTypeHistoryResult
    })}`
  );
}

writtenHex.length = 0;
parityStep('compat rw readLocalData typed start');
const compatTypedReadLocalDataResult = (await compat.readLocalData(true, '', 'sleepData')) as any;
parityStep('compat rw readLocalData typed result');
if (
  !writtenHex.some((hex) => hex.slice(4, 8) === '3601') ||
  compatTypedReadLocalDataResult?.parsed?.protocol !== 'rw' ||
  compatTypedReadLocalDataResult?.parsed?.status !== 'filtered' ||
  compatTypedReadLocalDataResult?.parsed?.dataType !== 'sleep' ||
  compatTypedReadLocalDataResult?.parsed?.readAll !== true ||
  compatTypedReadLocalDataResult?.parsed?.selectedFileCount !== 0 ||
  compatTypedReadLocalDataResult?.parsed?.filteredFileCount !== 1
) {
  throw new Error(
    `useRingBLE readLocalData should pass legacy typed-history aliases into RW syncHistory: ${JSON.stringify({
      writtenHex,
      compatTypedReadLocalDataResult
    })}`
  );
}

writtenHex.length = 0;
parityStep('compat rw syncHealthDataByType start');
const compatTypedHistoryResult = (await compat.syncHealthDataByType('blood_pressure')) as any;
parityStep('compat rw syncHealthDataByType result');
if (
  !writtenHex.some((hex) => hex.slice(4, 8) === '3601') ||
  compatTypedHistoryResult?.parsed?.protocol !== 'rw' ||
  compatTypedHistoryResult?.parsed?.status !== 'filtered' ||
  compatTypedHistoryResult?.parsed?.dataType !== 'blood_pressure' ||
  compatTypedHistoryResult?.parsed?.readAll !== true ||
  compatTypedHistoryResult?.parsed?.selectedFileCount !== 0 ||
  compatTypedHistoryResult?.parsed?.filteredFileCount !== 1
) {
  throw new Error(
    `useRingBLE syncHealthDataByType should use the full RW history sync flow with type filters: ${JSON.stringify({
      writtenHex,
      compatTypedHistoryResult
    })}`
  );
}

const coldCompat = useRingBLE({
  getBoundDevice: async () => null
});
parityStep('cold compat command checks');
coldCompat.deviceInfo.value = {
  deviceId: 'rw-compat-history',
  name: 'SY03',
  protocol: 'rw',
  advertis: { macInfo: '3E:00:00:00:05:1B' },
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
} as any;
writtenHex.length = 0;
const coldCompatTypedHistoryResult = (await coldCompat.syncHealthDataByType('blood_pressure')) as any;
if (
  !writtenHex.some((hex) => hex.slice(4, 8) === '3601') ||
  coldCompatTypedHistoryResult?.parsed?.protocol !== 'rw' ||
  coldCompatTypedHistoryResult?.parsed?.dataType !== 'blood_pressure' ||
  coldCompatTypedHistoryResult?.parsed?.readAll !== true
) {
  throw new Error(
    `useRingBLE syncHealthDataByType should ensure RW communication before calling the adapter: ${JSON.stringify({
      writtenHex,
      coldCompatTypedHistoryResult
    })}`
  );
}

const legacyCompatHistory = useRingBLE({
  getBoundDevice: async () => null
});
legacyCompatHistory.deviceInfo.value = {
  deviceId: 'l19-compat-history',
  name: 'QKeeRingL19',
  protocol: 'legacy',
  serviceId: '0000BAE8-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000BAE9-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000BAEA-0000-1000-8000-00805F9B34FB'
} as any;
writtenHex.length = 0;
const legacyCompatHistoryResult = (await legacyCompatHistory.syncAllHealthData()) as any;
if (
  writtenHex[0]?.slice(4, 8) !== '3601' ||
  legacyCompatHistoryResult?.parsed?.protocol !== 'legacy' ||
  legacyCompatHistoryResult?.parsed?.status !== 'empty' ||
  legacyCompatHistoryResult?.parsed?.records?.length !== 0
) {
  throw new Error(
    `useRingBLE syncAllHealthData should fall back to L19 full history sync instead of throwing on legacy devices: ${JSON.stringify({
      writtenHex,
      legacyCompatHistoryResult
    })}`
  );
}

writtenHex.length = 0;
const legacyCompatTypedHistoryResult = (await legacyCompatHistory.syncHealthDataByType('heart_rate')) as any;
if (
  writtenHex[0]?.slice(4, 8) !== '3601' ||
  legacyCompatTypedHistoryResult?.parsed?.protocol !== 'legacy' ||
  legacyCompatTypedHistoryResult?.parsed?.status !== 'empty' ||
  legacyCompatTypedHistoryResult?.parsed?.records?.length !== 0
) {
  throw new Error(
    `useRingBLE syncHealthDataByType should fall back to L19 full history sync instead of throwing on legacy devices: ${JSON.stringify({
      writtenHex,
      legacyCompatTypedHistoryResult
    })}`
  );
}

const coldTimedReadCompat = useRingBLE({
  getBoundDevice: async () => null
});
coldTimedReadCompat.deviceInfo.value = {
  deviceId: 'rw-compat-history',
  name: 'SY03',
  protocol: 'rw',
  advertis: { macInfo: '3E:00:00:00:05:1B' },
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
} as any;
writtenHex.length = 0;
await coldTimedReadCompat.getTimedTemperatureJL();
parityStep('cold timed read result');
const coldTimedReadHex = String(writtenHex[0] || '');
if (coldTimedReadHex !== 'ab0100035c81027d10') {
  throw new Error(`useRingBLE timed-read JL aliases should ensure RW communication before calling the adapter: ${JSON.stringify(writtenHex)}`);
}

const coldTimedSetCompat = useRingBLE({
  getBoundDevice: async () => null
});
coldTimedSetCompat.deviceInfo.value = {
  deviceId: 'rw-compat-history',
  name: 'SY03',
  protocol: 'rw',
  advertis: { macInfo: '3E:00:00:00:05:1B' },
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
} as any;
writtenHex.length = 0;
await coldTimedSetCompat.setTimedTemperatureJL({
  enabled: true,
  startHour: 1,
  startMinute: 2,
  endHour: 3,
  endMinute: 4,
  interval: 5
});
parityStep('cold timed set result');
const coldTimedSetHex = String(writtenHex[0] || '');
if (`${coldTimedSetHex.slice(12, 18)}:${coldTimedSetHex.slice(-12)}` !== '021b00:ff0102030405') {
  throw new Error(`useRingBLE timed-write JL aliases should ensure RW communication before calling the adapter: ${JSON.stringify(writtenHex)}`);
}

const coldControlCompat = useRingBLE({
  getBoundDevice: async () => null
});
coldControlCompat.deviceInfo.value = {
  deviceId: 'rw-compat-history',
  name: 'SY03',
  protocol: 'rw',
  advertis: { macInfo: '3E:00:00:00:05:1B' },
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
} as any;
writtenHex.length = 0;
await coldControlCompat.controlHealthDataJL('blood_sugar', true);
parityStep('cold control result');
const coldControlHex = String(writtenHex[0] || '');
if (coldControlHex !== 'ab010006321f060900100501') {
  throw new Error(`useRingBLE controlHealthDataJL should ensure RW communication before calling the adapter: ${JSON.stringify(writtenHex)}`);
}

const coldHealthAliasCompat = createColdRwCompat();
writtenHex.length = 0;
await coldHealthAliasCompat.readRwHealthData('bloodOxygen' as any);
await coldHealthAliasCompat.deleteRwHealthData('spO2' as any);
await coldHealthAliasCompat.controlRwHealthData('oxygen' as any, true);
await coldHealthAliasCompat.controlHealthDataJL('bodyTemp' as any, true);
await coldHealthAliasCompat.readRwHealthData('skinTemperature' as any);
await coldHealthAliasCompat.syncHealthDataByType('bp' as any);
if (
  !writtenHex.includes('ab010003ac95024e10') ||
  !writtenHex.some((hex) => hex.endsWith('050910')) ||
  !writtenHex.includes('ab0100034516050930') ||
  !writtenHex.includes('ab010006f5ce060900090501') ||
  !writtenHex.includes('ab010006359f060900080501') ||
  !writtenHex.includes('ab0100030cb4023010') ||
  !writtenHex.some((hex) => hex.endsWith('050810')) ||
  !writtenHex.some((hex) => hex.slice(4, 8) === '3601')
) {
  throw new Error(`useRingBLE RW health-data aliases should normalize old metric names before calling the adapter: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await coldHealthAliasCompat.readOxygen();
await coldHealthAliasCompat.readTemperature();
await coldHealthAliasCompat.readBP();
if (
  writtenHex[0] !== 'ab010006f5ce060900090501' ||
  !writtenHex.some((hex) => hex.endsWith('050910')) ||
  !writtenHex.some((hex) => hex === 'ab010006359f060900080501') ||
  !writtenHex.some((hex) => hex === 'ab010006365f060900040501') ||
  !writtenHex.some((hex) => hex.endsWith('050810')) ||
  !writtenHex.some((hex) => hex.endsWith('050410')) ||
  writtenHex.some((hex) => ['3100', '3200', '3400'].includes(hex.slice(4, 8)))
) {
  throw new Error(`useRingBLE legacy oxygen/temperature/BP aliases should route to RW-compatible metric commands: ${JSON.stringify(writtenHex)}`);
}

const rwDiscoverCompat = useRingBLE({
  getBoundDevice: async () => null
});
parityStep('rw discovery checks');
rwDiscoverCompat.devices.value = [
  {
    deviceId: 'rw-discover-platform-id',
    name: 'SY03',
    deviceName: 'SY03',
    protocol: 'rw',
    mac: '3E:00:00:00:05:1B',
    advertis: { macInfo: '3E:00:00:00:05:1B' }
  }
] as any;
const rwDiscoveredByPlatformId = (await rwDiscoverCompat.discoverServicesAndChars(
  'rw-discover-platform-id',
  '3E:00:00:00:05:1B'
)) as any;
const rwDiscoveredByStableId = (await rwDiscoverCompat.discoverServicesAndChars('3E:00:00:00:05:1B', 'SY03')) as any;
const rwDiscoveredByNormalizedStableId = (await rwDiscoverCompat.discoverServicesAndChars('3e000000051b', 'SY03')) as any;
for (const discovered of [rwDiscoveredByPlatformId, rwDiscoveredByStableId, rwDiscoveredByNormalizedStableId]) {
  if (
    discovered.protocol !== 'rw' ||
    discovered.deviceId !== 'rw-discover-platform-id' ||
    discovered.serviceId !== '0000A00A-0000-1000-8000-00805F9B34FB' ||
    discovered.cmdCharId !== '0000B002-0000-1000-8000-00805F9B34FB' ||
    discovered.dataCharId !== '0000B003-0000-1000-8000-00805F9B34FB'
  ) {
    throw new Error(`useRingBLE discoverServicesAndChars should route scanned RW devices through the RW adapter: ${JSON.stringify(discovered)}`);
  }
}

serviceDiscoveryDeviceIds.length = 0;
const rwNoRandomTailPromotionCompat = useRingBLE({
  getBoundDevice: async () => null
});
rwNoRandomTailPromotionCompat.devices.value = [
  {
    deviceId: 'rw-real-platform-id',
    name: 'SY03',
    deviceName: 'SY03',
    protocol: 'rw',
    mac: '3E:00:00:00:05:1B',
    advertis: { macInfo: '3E:00:00:00:05:1B' }
  }
] as any;
await rwNoRandomTailPromotionCompat.discoverServicesAndChars('11111100051B', 'SY03');
if (serviceDiscoveryDeviceIds[0] !== '11111100051B') {
  throw new Error(
    `useRingBLE should not remap a random platform id to a scanned RW device by stable-MAC tail: ${JSON.stringify(serviceDiscoveryDeviceIds)}`
  );
}
await rwNoRandomTailPromotionCompat.cleanup();

const rwNoRandomUniMacTailConnectCompat = useRingBLE({
  getBoundDevice: async () => null,
  rwCompatScanTimeoutMs: 20
});
connectedDeviceIds.length = 0;
rwNoRandomUniMacTailConnectCompat.devices.value = [
  {
    deviceId: 'rw-random-tail-platform-id',
    name: 'SY03',
    deviceName: 'SY03',
    protocol: 'rw',
    uniMacId: '222222ABCDEF'
  }
] as any;
await rwNoRandomUniMacTailConnectCompat.connectDevice(
  {
    name: '',
    protocol: 'rw',
    uniMacId: '111111ABCDEF'
  } as any,
  '',
  '',
  true
);
const rwRandomTailConnectedDeviceId = connectedDeviceIds[0] as string | undefined;
if (
  rwRandomTailConnectedDeviceId !== '111111ABCDEF' ||
  connectedDeviceIds.includes('rw-random-tail-platform-id') ||
  rwNoRandomUniMacTailConnectCompat.deviceInfo.value.mac === '111111ABCDEF' ||
  rwNoRandomUniMacTailConnectCompat.deviceInfo.value.uniMacId === '111111ABCDEF'
) {
  throw new Error(
    `useRingBLE compat connect should not remap or bind RW random uniMacId values by tail: ${JSON.stringify({
      connectedDeviceIds,
      deviceInfo: rwNoRandomUniMacTailConnectCompat.deviceInfo.value
    })}`
  );
}
await rwNoRandomUniMacTailConnectCompat.cleanup();

const rwCleanupLateDiscoverCompat = useRingBLE({
  getBoundDevice: async () => null
});
rwCleanupLateDiscoverCompat.devices.value = [
  {
    deviceId: 'rw-late-discover-platform-id',
    name: 'SY03',
    deviceName: 'SY03',
    protocol: 'rw',
    mac: '3E:00:00:00:05:1B',
    advertis: { macInfo: '3E:00:00:00:05:1B' }
  }
] as any;
serviceDiscoveryDeviceIds.length = 0;
delayedServiceDiscoveryDeviceIds.add('rw-late-discover-platform-id');
const rwCleanupLateDiscoverPromise = rwCleanupLateDiscoverCompat
  .discoverServicesAndChars('rw-late-discover-platform-id', 'SY03')
  .then(
    () => null,
    (error) => error
  );
await waitForServiceDiscoveryAttempt('rw-late-discover-platform-id');
await rwCleanupLateDiscoverCompat.cleanup();
const rwCleanupLateDiscoverResult = await rwCleanupLateDiscoverPromise;
await new Promise((resolve) => setTimeout(resolve, 30));
delayedServiceDiscoveryDeviceIds.clear();
if (
  !(rwCleanupLateDiscoverResult instanceof Error) ||
  !rwCleanupLateDiscoverResult.message.includes('cancelled') ||
  rwCleanupLateDiscoverCompat.deviceInfo.value.deviceId
) {
  throw new Error(
    `RW late successful discovery callback should be rejected after cleanup: ${JSON.stringify({
      error:
        rwCleanupLateDiscoverResult instanceof Error
          ? rwCleanupLateDiscoverResult.message
          : String(rwCleanupLateDiscoverResult),
      deviceInfo: rwCleanupLateDiscoverCompat.deviceInfo.value,
      serviceDiscoveryDeviceIds
    })}`
  );
}

const rwCachedNotifyRediscoveryCompat = useRingBleSdk({
  getBoundDevice: async () => null
});
rwCachedNotifyRediscoveryCompat.deviceInfo.value = {
  deviceId: 'rw-cached-no-notify-snapshot',
  name: 'SY03',
  protocol: 'rw',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  notifyEnabled: true
} as any;
serviceDiscoveryDeviceIds.length = 0;
characteristicDiscoveryDeviceIds.length = 0;
notifyDeviceIds.length = 0;
writtenHex.length = 0;
await rwCachedNotifyRediscoveryCompat.sendBatteryCommand();
const rwCachedNotifyRediscoveryDeviceId = 'rw-cached-no-notify-snapshot';
if (
  String(serviceDiscoveryDeviceIds[0] || '') !== rwCachedNotifyRediscoveryDeviceId ||
  String(characteristicDiscoveryDeviceIds[0] || '') !== rwCachedNotifyRediscoveryDeviceId ||
  String(notifyDeviceIds[0] || '') !== rwCachedNotifyRediscoveryDeviceId ||
  !Array.isArray((rwCachedNotifyRediscoveryCompat.deviceInfo.value as any).notifyCandidates) ||
  String(writtenHex[0] || '') !== 'ab010003020310'
) {
  throw new Error(
    `RW cached communication restore should rediscover missing notify candidates before command reads even without a stable MAC: ${JSON.stringify({
      serviceDiscoveryDeviceIds,
      characteristicDiscoveryDeviceIds,
      notifyDeviceIds,
      deviceInfo: rwCachedNotifyRediscoveryCompat.deviceInfo.value,
      writtenHex
    })}`
  );
}
await rwCachedNotifyRediscoveryCompat.cleanup();

const rwEmptyNotifySnapshotRediscoveryCompat = useRingBleSdk({
  getBoundDevice: async () => null
});
rwEmptyNotifySnapshotRediscoveryCompat.deviceInfo.value = {
  deviceId: 'rw-cached-empty-notify-snapshot',
  name: 'SY03',
  protocol: 'rw',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  notifyCandidates: [],
  notifyEnabled: true
} as any;
serviceDiscoveryDeviceIds.length = 0;
characteristicDiscoveryDeviceIds.length = 0;
notifyDeviceIds.length = 0;
writtenHex.length = 0;
await rwEmptyNotifySnapshotRediscoveryCompat.sendBatteryCommand();
const rwEmptyNotifySnapshotDeviceId = 'rw-cached-empty-notify-snapshot';
if (
  String(serviceDiscoveryDeviceIds[0] || '') !== rwEmptyNotifySnapshotDeviceId ||
  String(characteristicDiscoveryDeviceIds[0] || '') !== rwEmptyNotifySnapshotDeviceId ||
  String(notifyDeviceIds[0] || '') !== rwEmptyNotifySnapshotDeviceId ||
  ((rwEmptyNotifySnapshotRediscoveryCompat.deviceInfo.value as any).notifyCandidates || []).length === 0 ||
  String(writtenHex[0] || '') !== 'ab010003020310'
) {
  throw new Error(
    `RW cached communication restore should treat an empty notifyCandidates array as missing discovery metadata: ${JSON.stringify({
      serviceDiscoveryDeviceIds,
      characteristicDiscoveryDeviceIds,
      notifyDeviceIds,
      deviceInfo: rwEmptyNotifySnapshotRediscoveryCompat.deviceInfo.value,
      writtenHex
    })}`
  );
}
await rwEmptyNotifySnapshotRediscoveryCompat.cleanup();

const rwAlternateNotifyFailureCompat = useRingBleSdk({
  getBoundDevice: async () => null
});
rwAlternateNotifyFailureCompat.deviceInfo.value = {
  deviceId: 'rw-alt-notify-fails',
  name: 'SY03',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  notifyCandidates: [
    {
      serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
      characteristicId: '0000B003-0000-1000-8000-00805F9B34FB'
    },
    {
      serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
      characteristicId: '0000B004-0000-1000-8000-00805F9B34FB'
    }
  ],
  notifyEnabled: true
} as any;
notifyDeviceIds.length = 0;
notifyRequests.length = 0;
writtenHex.length = 0;
failedNotifyChannels.add(
  'rw-alt-notify-fails|0000A00A-0000-1000-8000-00805F9B34FB|0000B004-0000-1000-8000-00805F9B34FB'
);
await rwAlternateNotifyFailureCompat.sendBatteryCommand();
failedNotifyChannels.clear();
  if (
    String(writtenHex[0] || '') !== 'ab010003020310' ||
    rwAlternateNotifyFailureCompat.deviceInfo.value.notifyEnabled !== true ||
    String(rwAlternateNotifyFailureCompat.deviceInfo.value.notifyError || '') !== '' ||
    !notifyRequests.some((request) => request.characteristicId === '0000B003-0000-1000-8000-00805F9B34FB') ||
    notifyRequests.some((request) => request.characteristicId === '0000B004-0000-1000-8000-00805F9B34FB')
  ) {
    throw new Error(
      `RW partial alternate-notify failures should keep primary communication ready without synchronously probing alternate descriptors: ${JSON.stringify({
        notifyRequests,
        deviceInfo: rwAlternateNotifyFailureCompat.deviceInfo.value,
        writtenHex
    })}`
  );
}
await rwAlternateNotifyFailureCompat.cleanup();

const rwCleanupNotifyRestoreCompat = useRingBleSdk({
  getBoundDevice: async () => null
});
parityStep('rw notify restore cleanup checks');
rwCleanupNotifyRestoreCompat.deviceInfo.value = {
  deviceId: 'rw-late-notify-platform-id',
  name: 'SY03',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  advertis: { macInfo: '3E:00:00:00:05:1B' },
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  notifyEnabled: false
} as any;
notifyDeviceIds.length = 0;
characteristicDiscoveryDeviceIds.length = 0;
writtenHex.length = 0;
delayedCharacteristicDiscoveryDeviceIds.add('rw-late-notify-platform-id');
const rwCleanupNotifyRestorePromise = rwCleanupNotifyRestoreCompat.sendBatteryCommand().then(
  () => null,
  (error) => error
);
parityStep('rw notify restore cleanup wait characteristic discovery');
await waitForCharacteristicDiscoveryAttempt('rw-late-notify-platform-id');
parityStep('rw notify restore cleanup call cleanup');
await rwCleanupNotifyRestoreCompat.cleanup();
parityStep('rw notify restore cleanup await command result');
const rwCleanupNotifyRestoreResult = await rwCleanupNotifyRestorePromise;
parityStep('rw notify restore cleanup result received');
await new Promise((resolve) => setTimeout(resolve, 30));
delayedCharacteristicDiscoveryDeviceIds.clear();
if (
  !(rwCleanupNotifyRestoreResult instanceof Error) ||
  !rwCleanupNotifyRestoreResult.message.includes('not ready') ||
  rwCleanupNotifyRestoreCompat.deviceInfo.value.deviceId ||
  writtenHex.length !== 0
) {
  throw new Error(
    `RW delayed notify restore should not mark communication ready or send commands after cleanup: ${JSON.stringify({
      error:
        rwCleanupNotifyRestoreResult instanceof Error
          ? rwCleanupNotifyRestoreResult.message
          : String(rwCleanupNotifyRestoreResult),
      deviceInfo: rwCleanupNotifyRestoreCompat.deviceInfo.value,
      writtenHex
    })}`
  );
}

const coldDeviceTimeCompat = createColdRwCompat();
writtenHex.length = 0;
await coldDeviceTimeCompat.readDeviceTime();
const coldReadTimeHasKeyFrame = writtenHex.some((hex) => hex.startsWith('ab010003') && hex.endsWith('020110'));
const coldReadTimeHasLegacyFrame = writtenHex.some((hex) => hex.slice(4, 8) === '1001');
if (!coldReadTimeHasKeyFrame || !coldReadTimeHasLegacyFrame) {
  throw new Error(`useRingBLE readDeviceTime should ensure RW communication before calling the adapter: ${JSON.stringify(writtenHex)}`);
}

const coldUpdateTimeCompat = createColdRwCompat();
writtenHex.length = 0;
await coldUpdateTimeCompat.updateDeviceTime(1696687197195);
const coldTimeHasSetKeyFrame = writtenHex.some((hex) => hex.startsWith('ab010009') && hex.slice(12, 18) === '020100');
const coldTimeHasReadKeyFrame = writtenHex.some((hex) => hex.startsWith('ab010003') && hex.endsWith('020110'));
const coldTimeHasLegacySetFrame = writtenHex.some((hex) => hex.slice(4, 8) === '1000');
const coldTimeHasLegacyReadFrame = writtenHex.some((hex) => hex.slice(4, 8) === '1001');
if (!coldTimeHasSetKeyFrame || !coldTimeHasReadKeyFrame || !coldTimeHasLegacySetFrame || !coldTimeHasLegacyReadFrame) {
  throw new Error(`useRingBLE updateDeviceTime should ensure RW communication and read back time: ${JSON.stringify(writtenHex)}`);
}

const coldDeleteCompat = createColdRwCompat();
writtenHex.length = 0;
await coldDeleteCompat.sendDeleteAllLocalDataCommand();
const coldDeleteHex = String(writtenHex[0] || '');
if (coldDeleteHex.slice(4, 8) !== '3603' || !writtenHex.some((hex) => String(hex).slice(4, 8) === '3613')) {
  throw new Error(`useRingBLE sendDeleteAllLocalDataCommand should ensure RW communication before calling the adapter: ${JSON.stringify(writtenHex)}`);
}

const coldFormatCompat = createColdRwCompat();
writtenHex.length = 0;
await coldFormatCompat.formatRwFileSystem();
const coldFormatHex = String(writtenHex[0] || '');
if (coldFormatHex.slice(4, 8) !== '3613') {
  throw new Error(`useRingBLE formatRwFileSystem should ensure RW communication before calling the adapter: ${JSON.stringify(writtenHex)}`);
}

const coldResetCompat = createColdRwCompat();
writtenHex.length = 0;
await coldResetCompat.sendResetCommand();
const coldResetHex = String(writtenHex[0] || '');
if (coldResetHex.slice(4, 8) !== '3702') {
  throw new Error(`useRingBLE sendResetCommand should ensure RW communication before calling the adapter: ${JSON.stringify(writtenHex)}`);
}

const coldCollectCompat = createColdRwCompat();
writtenHex.length = 0;
await coldCollectCompat.sendCollectPeriodSettingCommand(1800);
const coldCollectPrimaryHex = String(writtenHex[0] || '');
const coldCollectWriteKeys = writtenHex.map((hex) => `${hex.slice(12, 18)}:${hex.slice(-12)}`);
if (
  coldCollectPrimaryHex.slice(4, 8) !== '3700' ||
  coldCollectPrimaryHex.slice(8) !== '08070000' ||
  coldCollectWriteKeys.length < 7 ||
  !coldCollectWriteKeys.includes('021600:010000173b1e') ||
  !coldCollectWriteKeys.includes('027c00:010000173b1e')
) {
  throw new Error(
    `useRingBLE sendCollectPeriodSettingCommand should keep the RW old-page primary path on the L19 collect-period frame before native fallback: ${JSON.stringify(
      writtenHex
    )}`
  );
}

const coldCollectReadCompat = createColdRwCompat();
writtenHex.length = 0;
await coldCollectReadCompat.readCollectPeriodCommand();
const coldCollectReadHex = String(writtenHex[0] || '');
if (coldCollectReadHex.slice(4, 8) !== '3701' || !writtenHex.some((hex) => String(hex).slice(12, 18) === '021610')) {
  throw new Error(
    `useRingBLE readCollectPeriodCommand should keep the RW old-page primary path on the L19 collect-period read frame before native fallback: ${JSON.stringify(
      writtenHex
    )}`
  );
}

const rwOldPageBasicReadCompat = createColdRwCompat();
const assertRwOldPageBasicReadPrimary = async (method: keyof RingBLECompat, expectedCmd: string, label: string) => {
  writtenHex.length = 0;
  parityStep(`old-page primary ${label} start`);
  await (rwOldPageBasicReadCompat[method] as () => Promise<unknown>)();
  parityStep(`old-page primary ${label} result`);
  const firstHex = String(writtenHex[0] || '');
  const matchesExpected = expectedCmd.length > 4 ? firstHex === expectedCmd : firstHex.slice(4, 8) === expectedCmd;
  if (!matchesExpected) {
    throw new Error(
      `useRingBLE ${label} should use the expected RW primary frame: ${JSON.stringify({
        method,
        expectedCmd,
        writtenHex
      })}`
    );
  }
};

await assertRwOldPageBasicReadPrimary('readBattery', 'ab010003020310', 'battery read');
await assertRwOldPageBasicReadPrimary('getFirmwareVersion', 'ab010003020410', 'firmware read');
await assertRwOldPageBasicReadPrimary('getSoftwareVersion', 'ab010003020410', 'software read');
await assertRwOldPageBasicReadPrimary('measureHeartRate', 'ab010006f7ee060900030501', 'heart-rate read');
await assertRwOldPageBasicReadPrimary('measureBloodOxygen', 'ab010006f5ce060900090501', 'blood-oxygen read');
await assertRwOldPageBasicReadPrimary('measureBodyTemperature', 'ab010006359f060900080501', 'body-temperature read');

writtenHex.length = 0;
await compat.readHrv();
await compat.readStress();
await compat.readBloodSugar();
await compat.readBloodPressure();
if (
  String(writtenHex[0] || '') !== 'ab010006f53e0609000a0501' ||
  !writtenHex.includes('ab0100035c8e026910') ||
  !writtenHex.includes('ab0100036d17050a10') ||
  !writtenHex.some((hex) => hex.endsWith('050a10')) ||
  !writtenHex.some((hex) => hex.endsWith('0609000a0500')) ||
  !writtenHex.includes('ab010006348f0609000d0501') ||
  !writtenHex.includes('ab0100033c94024f10') ||
  !writtenHex.includes('ab0100035d15050d10') ||
  !writtenHex.some((hex) => hex.endsWith('050d10')) ||
  !writtenHex.some((hex) => hex.endsWith('0609000d0500')) ||
  !writtenHex.includes('ab010006321f060900100501') ||
  !writtenHex.includes('ab0100030c8d026c10') ||
  !writtenHex.includes('ab0100030d1c051010') ||
  !writtenHex.some((hex) => hex.endsWith('051010')) ||
  !writtenHex.some((hex) => hex.endsWith('060900100500')) ||
  !writtenHex.includes('ab010006365f060900040501') ||
  !writtenHex.includes('ab0100039cb5023110') ||
  !writtenHex.includes('ab0100030d13050410') ||
  !writtenHex.some((hex) => hex.endsWith('050410')) ||
  !writtenHex.some((hex) => hex.endsWith('060900040500')) ||
  writtenHex.length !== 24
) {
  throw new Error(
    `useRingBLE RW expanded health reads should enable, prefer realtime keys, fall back to health-data keys, and disable RW realtime control: ${JSON.stringify(writtenHex)}`
  );
}

if (!legacyAdapterSource.includes('const parsedWithDevice') || !legacyAdapterSource.includes('runtime.onParsedData?.(parsedWithDevice)')) {
  throw new Error('Legacy adapter parsed data should include current device identity before entering the unified SDK.');
}

if (!legacyAdapterSource.includes('const currentDeviceId = runtime?.getDeviceInfo?.().deviceId') || !legacyAdapterSource.includes('if (currentDeviceId && result.deviceId !== currentDeviceId) return')) {
  throw new Error('Legacy adapter connection listener should ignore unrelated BLE disconnection events.');
}

if (
  !qkeerV2AdapterSource.includes('const parsedWithDevice') ||
  !qkeerV2AdapterSource.includes('bleManager.connectedDeviceId') ||
  !qkeerV2AdapterSource.includes('runtime?.onParsedData?.(parsedWithDevice)')
) {
  throw new Error('QKeer V2 adapter parsed data should include current device identity before entering the unified SDK.');
}

function assertLegacyCallShapes(entry: RingBLECompat) {
  entry.readLocalData(false);
  entry.readLocalData(true);
  entry.readLocalData(false, 'day');
  entry.readLocalData(false, '2026-01-02');
  entry.readLocalData(false, '2026-01-02', ['heartRate', 'bloodOxygen']);
  entry.readLocalData(false, 1710000000);
  entry.readLocalData(false, new Date(1710000000000));
  entry.readLocalData(true, '', 'sleepData');
  entry.reScan('HR');
  entry.reScan(['HR', 'IF']);
  entry.reScan({ includeUnknown: true, preserveDevices: true, timeoutMs: 30000 });
  entry.restartScan();
  entry.restartScan({ includeUnknown: true, allowDuplicatesKey: true });
  entry.startScan();
  entry.startScan({ includeUnknown: true, allowDuplicatesKey: true, preserveDevices: true });
  entry.connectDevice('device-id');
  entry.connectDevice('device-id', 'device-name', 'ios-mac');
  entry.handleConnectDevice('device-id', 'device-name', 'ios-mac');
  entry.handleConnectDevice('device-id', 'device-name', '', true);
  entry.discoverServicesAndChars('device-id');
  entry.discoverServicesAndChars('device-id', 'mac-or-name');
  entry.sendCollectPeriodSettingCommand(1200);
  entry.refreshBusinessMetrics();
  entry.refreshHealthData();
  entry.refreshHealthData({ includeDeviceTime: false, includeCollectPeriod: false, timeoutMs: 5000 });
  entry.refreshBusinessData();
  entry.readHealthData();
  entry.syncHistoricalData();
  entry.syncHistoryData(true);
  entry.syncLocalData(false);
  entry.readBattery();
  entry.getBattery();
  entry.getBatteryInfo();
  entry.readFirmwareVersion();
  entry.getFirmwareVersion();
  entry.readSoftwareVersion();
  entry.getSoftwareVersion();
  entry.readHeartRate();
  entry.getHeartRate();
  entry.measureHeartRate();
  entry.readBloodOxygen();
  entry.getBloodOxygen();
  entry.measureBloodOxygen();
  entry.readBodyTemperature();
  entry.getBodyTemperature();
  entry.measureBodyTemperature();
  entry.readHrv();
  entry.getHrv();
  entry.measureHrv();
  entry.readStress();
  entry.getStress();
  entry.measureStress();
  entry.readBloodSugar();
  entry.getBloodSugar();
  entry.measureBloodSugar();
  entry.readBloodPressure();
  entry.getBloodPressure();
  entry.measureBloodPressure();
}

void assertLegacyCallShapes;

if (
  !isSwitchingRingDevice(
    { deviceId: 'l19-device', mac: '02:0B:B7' },
    { deviceId: '3E:00:00:00:05:1B', mac: '00:05:1B' }
  )
) {
  throw new Error('Connecting another ring should be treated as device switching.');
}

if (isSwitchingRingDevice({ deviceId: 'same-device' }, { deviceId: 'same-device' })) {
  throw new Error('Connecting the same device id should not be treated as device switching.');
}

if (isSwitchingRingDevice({ deviceId: 'ios-uuid', mac: '00:05:1B' }, { deviceId: 'rw-scan-id', uniMacId: '00:05:1B' })) {
  throw new Error('Matching mac/uniMacId should not be treated as device switching.');
}

if (
  !isSwitchingRingDevice(
    { deviceId: 'rw-current-platform-id', uniMacId: 'rw-random-id', mac: '3E:00:00:00:05:1B', protocol: 'rw' },
    { deviceId: 'rw-target-platform-id', uniMacId: 'rw-random-id', protocol: 'rw' }
  )
) {
  throw new Error('RW switching should not trust a random uniMacId when the current device has stable identity.');
}

if (
  isSwitchingRingDevice(
    { deviceId: 'rw-current-platform-id', uniMacId: 'rw-random-id', mac: '3E:00:00:00:05:1B', protocol: 'rw' },
    { deviceId: 'rw-current-platform-id', uniMacId: 'rw-target-random-id', protocol: 'rw' }
  )
) {
  throw new Error('RW switching should keep the same active platform deviceId compatible even if the refreshed scan row lacks stable MAC.');
}

if (
  isSwitchingRingDevice(
    { deviceId: 'rw-active-platform-id', uniMacId: 'rw-current-random-id', protocol: 'rw' },
    { deviceId: 'rw-active-platform-id', uniMacId: 'rw-target-random-id', protocol: 'rw' }
  )
) {
  throw new Error('RW active sessions with the same platform deviceId should not be treated as device switching.');
}

if (
  !isSwitchingRingDevice(
    { deviceId: 'rw-current-platform-id', uniMacId: 'rw-shared-random-id', protocol: 'rw' },
    { deviceId: 'rw-target-platform-id', uniMacId: 'rw-shared-random-id', protocol: 'rw' }
  )
) {
  throw new Error('RW switching should not treat a shared random uniMacId as the same active device.');
}

if (!isSameRingDevice({ mac: '3E:00:00:00:05:1B', protocol: 'rw' }, { uniMacId: '00:05:1B', protocol: 'rw' })) {
  throw new Error('Stable RW MAC identities should still match by their normalized tail.');
}

if (
  isSameRingDevice(
    { deviceId: '111111ABCDEF', protocol: 'rw' },
    { deviceId: '222222ABCDEF', protocol: 'rw' }
  )
) {
  throw new Error('Random platform deviceIds should not be matched only by a shared identity tail.');
}

if (
  isSameRingDevice(
    { uniMacId: '111111ABCDEF', protocol: 'rw' },
    { uniMacId: '222222ABCDEF', protocol: 'rw' }
  )
) {
  throw new Error('Random RW uniMacIds should not be matched only by a shared identity tail.');
}

if (
  sdkSource.includes('uniMacId: deviceId') ||
  sdkSource.includes('mac: deviceId') ||
  sdkSource.includes('uniMacId: id') ||
  sdkSource.includes('mac: id') ||
  sdkSource.includes('{ deviceId, uniMacId: deviceId, mac: deviceId }') ||
  sdkSource.includes('{ deviceId: id, uniMacId: id, mac: id }')
) {
  throw new Error('Unified SDK should not promote arbitrary platform ids into stable MAC identity fields for matching.');
}

if (
  isSameRingDevice(
    { deviceId: 'legacy-platform-id', mac: '3E:00:00:00:05:1B', protocol: 'legacy' },
    { deviceId: 'rw-platform-id', mac: '3E:00:00:00:05:1B', protocol: 'rw' }
  )
) {
  throw new Error('Different explicit protocols should not be treated as the same ring even when identity tails match.');
}

if (
  !isSwitchingRingDevice(
    { deviceId: 'legacy-platform-id', mac: '3E:00:00:00:05:1B', protocol: 'legacy' },
    { deviceId: 'rw-platform-id', mac: '3E:00:00:00:05:1B', protocol: 'rw' }
  )
) {
  throw new Error('Switching between L19 and RW with matching identity tails should still be treated as device switching.');
}

if (
  isSwitchingRingDevice(
    { deviceId: 'qkv2-old-id', advertis: { macInfo: '02:0B:B7' } } as any,
    { deviceId: 'qkv2-new-id', uniMacId: '02:0B:B7' }
  )
) {
  throw new Error('Matching advertis macInfo should not be treated as device switching.');
}

if (getRingDeviceStableIdentity({ deviceId: 'temp-id', advertis: { macInfo: '02:0B:B7' } } as any) !== '02:0B:B7') {
  throw new Error('Stable device identity should prefer advertis macInfo over platform deviceId.');
}

if (getRingDeviceStableIdentity({ deviceId: 'rw-random-platform-id', uniMacId: 'ios-random-uni-id', protocol: 'rw' } as any)) {
  throw new Error('RW stable identity should not fall back to random platform deviceId/uniMacId values.');
}

if (getRingDeviceStableIdentity({ deviceId: '3E:00:00:00:05:1B', protocol: 'rw' } as any) !== '3E:00:00:00:05:1B') {
  throw new Error('RW stable identity should still accept legacy bound BLE MACs stored in deviceId.');
}

const directSdkRandomRwBindPayloads: any[] = [];
const directSdkRandomRwEntry = useRingBleSdk({
  getBoundDevice: async () => null,
  bindDevice: async (payload) => {
    directSdkRandomRwBindPayloads.push(payload);
  }
});
parityStep('direct sdk rw identity checks');
connectedDeviceIds.length = 0;
await directSdkRandomRwEntry.connectDevice({
  deviceId: 'rw-direct-random-platform-id',
  deviceName: 'SY03',
  uniMacId: '111111ABCDEF',
  protocol: 'rw',
  bindAfterConnected: true
});
const directSdkRandomRwConnectedDeviceId = connectedDeviceIds[0] as string | undefined;
if (
  directSdkRandomRwConnectedDeviceId !== 'rw-direct-random-platform-id' ||
  directSdkRandomRwBindPayloads.length !== 0 ||
  directSdkRandomRwEntry.deviceInfo.value.mac === '111111ABCDEF' ||
  directSdkRandomRwEntry.deviceInfo.value.uniMacId === '111111ABCDEF'
) {
  throw new Error(
    `Unified SDK direct RW connect should not bind or persist random uniMacId metadata: ${JSON.stringify({
      connectedDeviceIds,
      bindPayloads: directSdkRandomRwBindPayloads,
      deviceInfo: directSdkRandomRwEntry.deviceInfo.value
    })}`
  );
}
await directSdkRandomRwEntry.cleanup();

const directSdkColdRwUnbindPayloads: any[] = [];
const directSdkColdRwUnbindEntry = useRingBleSdk({
  getBoundDevice: async () =>
    ({
      deviceId: 'ios-old-platform-id',
      name: 'SY03',
      deviceName: 'SY03',
      protocol: 'rw',
      advertis: { macInfo: '3E:00:00:00:05:1B' }
    }) as any,
  unbindDevice: async (payload) => {
    directSdkColdRwUnbindPayloads.push(payload);
  }
});
directSdkColdRwUnbindEntry.deviceInfo.value = {} as any;
await directSdkColdRwUnbindEntry.unbind();
if (
  directSdkColdRwUnbindPayloads.length !== 1 ||
  directSdkColdRwUnbindPayloads[0].mac !== '3E:00:00:00:05:1B' ||
  directSdkColdRwUnbindEntry.deviceInfo.value.deviceId
) {
  throw new Error(
    `Unified SDK cold RW unbind should resolve the stored stable identity before clearing runtime state: ${JSON.stringify({
      payloads: directSdkColdRwUnbindPayloads,
      deviceInfo: directSdkColdRwUnbindEntry.deviceInfo.value
    })}`
  );
}

if (
  !sdkSource.includes('const getRwStableConnectionIdentity =') ||
  !sdkSource.includes('const sourceStableIdentity =') ||
  !sdkSource.includes('getRwStableConnectionIdentity(sourceDevice, payload.uniMacId)') ||
  !sdkSource.includes("protocol === 'rw'") ||
  !sdkSource.includes('? sourceStableIdentity') ||
  !sdkSource.includes(': payload.uniMacId || sourceDevice?.uniMacId || sourceStableIdentity') ||
  !sdkSource.includes('mac: sourceStableIdentity')
) {
  throw new Error('Unified SDK connect target should ignore random RW uniMacId metadata when no stable identity is available.');
}

if (
  !sdkSource.includes('candidate.advertis?.macInfo') ||
  !sdkSource.includes('target.advertis?.macInfo')
) {
  throw new Error('RW scan-first reconnect should forward advertis macInfo as the stable reconnect identity.');
}

if (!sdkSource.includes('const currentDeviceId = getRingDeviceStableIdentity(deviceInfo.value)')) {
  throw new Error('Unified SDK unbind should use stable RW identity instead of the random platform deviceId.');
}

if (!sdkSource.includes('if (!hasRingReconnectTargetIdentity(targetDevice))')) {
  throw new Error('Unified SDK reconnect should separate RW stable identity from service-ready platform reconnect handles.');
}

if (
  isSwitchingRingDevice(
    { advertis: { macInfo: '3E:00:00:00:05:1B' }, protocol: 'rw' } as any,
    { deviceId: 'ios-random-id', mac: '3E:00:00:00:05:1B', protocol: 'rw' }
  )
) {
  throw new Error('Matching RW advertis macInfo should not be treated as device switching.');
}

if (!isExpectedRingDevice(null, { deviceId: 'any-device', protocol: 'rw' })) {
  throw new Error('Missing expected device should allow connection callbacks.');
}

if (!isExpectedRingDevice({ deviceId: '3E:00', protocol: 'rw' }, { deviceId: '3E:00', protocol: 'rw' })) {
  throw new Error('Matching expected device should allow connection callbacks.');
}

if (isExpectedRingDevice({ deviceId: '3E:00', protocol: 'rw' }, { deviceId: '82:C5', protocol: 'legacy' })) {
  throw new Error('Different protocol and device should ignore stale connection callbacks.');
}

if (!isExpectedRingDevice({ deviceId: 'ios-uuid', mac: '00:05:1B' }, { deviceId: 'rw-scan-id', uniMacId: '00:05:1B' })) {
  throw new Error('Matching mac/uniMacId should allow expected connection callbacks.');
}

if (!isExpectedRingDevice({ advertis: { macInfo: '3E:00:00:00:05:1B' }, protocol: 'rw' } as any, { mac: '3E:00:00:00:05:1B', protocol: 'rw' })) {
  throw new Error('Matching RW advertis macInfo should allow expected connection callbacks.');
}

if (
  !isParsedDataForCurrentRing(
    { deviceId: 'ios-uuid', mac: '00:05:1B', protocol: 'rw' },
    { type: 'battery', protocol: 'rw', uniMacId: '00:05:1B', value: 55 }
  )
) {
  throw new Error('Parsed data with matching mac/uniMacId should enter the current ring state.');
}

if (
  isParsedDataForCurrentRing(
    { deviceId: 'ios-uuid', mac: '00:05:1B', protocol: 'rw' },
    { type: 'battery', protocol: 'rw', uniMacId: '02:0B:B7', value: 100 }
  )
) {
  throw new Error('Parsed data from another scanned ring should not enter the current ring state.');
}

if (
  !isParsedDataForCurrentRing(
    { advertis: { macInfo: '3E:00:00:00:05:1B' }, protocol: 'rw' } as any,
    { type: 'battery', protocol: 'rw', advertis: { macInfo: '3E:00:00:00:05:1B' }, value: 55 }
  )
) {
  throw new Error('Parsed data with matching RW advertis macInfo should enter the current ring state.');
}

if (
  isParsedDataForCurrentRing(
    { deviceId: 'rw-current-random-platform', uniMacId: '111111ABCDEF', advertis: { macInfo: '3E:00:00:00:05:1B' }, protocol: 'rw' } as any,
    { type: 'battery', protocol: 'rw', deviceId: 'rw-current-random-platform', uniMacId: '111111ABCDEF', value: 55 }
  )
) {
  throw new Error('Parsed RW data tagged only with random platform identity should not enter the current ring state.');
}

if (
  !isParsedDataForCurrentRing(
    { deviceId: 'rw-current-random-platform', uniMacId: '111111ABCDEF', advertis: { macInfo: '3E:00:00:00:05:1B' }, protocol: 'rw' } as any,
    { type: 'battery', protocol: 'rw', value: 55 }
  )
) {
  throw new Error('Untagged parsed RW data from the active connection should remain compatible.');
}

if (
  isParsedDataForCurrentRing(
    { deviceId: 'rw-current-random-platform', uniMacId: '111111ABCDEF', protocol: 'rw' } as any,
    { type: 'battery', protocol: 'rw', deviceId: 'rw-current-random-platform', uniMacId: '111111ABCDEF', value: 55 }
  )
) {
  throw new Error('RW parsed-data matching should not trust random-only current device identity.');
}

if (isParsedDataForCurrentRing({ deviceId: 'legacy-1', protocol: 'legacy' }, { type: 'battery', protocol: 'rw', value: 80 })) {
  throw new Error('Parsed data from another protocol should not enter the current ring state.');
}

if (!isParsedDataForCurrentRing({ deviceId: 'legacy-1', protocol: 'legacy' }, { type: 'battery', value: 80 })) {
  throw new Error('Legacy parsed data without device identity should remain compatible.');
}

if (
  isParsedDataForCurrentRing(
    {},
    { type: 'rw_health_data_pending', protocol: 'rw', name: 'heart_rate', status: 'pending', message: 'pending' }
  )
) {
  throw new Error('Parsed data should not enter runtime state after the current device has been cleared.');
}

const enrichedRwPending = enrichParsedDataWithCurrentRing(
  {
    deviceId: 'rw-runtime-device',
    protocol: 'rw',
    advertis: { macInfo: '3E:00:00:00:05:1B' }
  } as any,
  { type: 'rw_history_pending', protocol: 'rw', status: 'pending' }
);
if (enrichedRwPending.mac !== '3E:00:00:00:05:1B' || enrichedRwPending.advertis?.macInfo !== '3E:00:00:00:05:1B') {
  throw new Error(`Unified SDK parsed-data enrichment should preserve RW advertis identity: ${JSON.stringify(enrichedRwPending)}`);
}

if (
  !sdkSource.includes('const parsedForCurrentRing = enrichParsedDataWithCurrentRing(currentDevice, parsed)') ||
  !sdkSource.includes('handleRingParsedData(bridgeTarget, parsedForCurrentRing)')
) {
  throw new Error('Unified SDK runtime should normalize the same current-device-enriched parsed data that it stores in receivedData.');
}

const reconnectScanCandidate = findReconnectScanCandidate(
  { deviceId: 'stale-rw-id', mac: '00:05:1B', name: 'SY03', protocol: 'rw' },
  [
    { deviceId: '82:C5:8D:B2:69:6E', mac: '02:0B:B7', name: 'QKeeRingL19', protocol: 'legacy' },
    { deviceId: '3E:00:00:00:05:1B', name: 'SY03', protocol: 'rw' }
  ]
);
if (reconnectScanCandidate?.deviceId !== '3E:00:00:00:05:1B') {
  throw new Error('Reconnect scan fallback should match RW devices by stable mac tail when the platform deviceId changes.');
}

const reconnectAdvertisOnlyCandidate = findReconnectScanCandidate(
  { advertis: { macInfo: '3E:00:00:00:05:1B' }, name: 'SY03', protocol: 'rw' } as any,
  [
    { deviceId: 'legacy-id', advertis: { macInfo: '02:0B:B7' }, name: 'QKeeRingL19', protocol: 'legacy' } as any,
    { deviceId: 'rw-new-platform-id', name: 'SY03', advertis: { macInfo: '3E:00:00:00:05:1B' }, protocol: 'rw' } as any
  ]
);
if (reconnectAdvertisOnlyCandidate?.deviceId !== 'rw-new-platform-id') {
  throw new Error('Reconnect scan fallback should match RW devices when the stored identity is only advertis macInfo.');
}

if (
  findReconnectScanCandidate({ name: 'SY03', protocol: 'rw' }, [
    { deviceId: 'rw-1', name: 'SY03', protocol: 'rw' },
    { deviceId: 'rw-2', name: 'SY03', protocol: 'rw' }
  ])
) {
  throw new Error('Reconnect scan fallback should not choose between multiple same-name devices without identity.');
}

if (
  findReconnectScanCandidate({ name: 'SY03', protocol: 'rw' }, [
    { deviceId: 'legacy-sy03', name: 'SY03', protocol: 'legacy' }
  ])
) {
  throw new Error('Reconnect scan fallback should not match devices from another protocol.');
}

if (!shouldReconnectByScanningFirst({ name: 'SY03', protocol: 'rw' })) {
  throw new Error('RW reconnect should scan first to avoid stale platform device ids.');
}

if (shouldReconnectByScanningFirst({ name: 'QKeeRingL19', protocol: 'legacy' })) {
  throw new Error('Legacy reconnect should keep direct reconnect first.');
}

if (shouldReconnectByScanningFirst({ name: 'MUSLEEP_RING', protocol: 'qkeer-v2' })) {
  throw new Error('QKeer v2 reconnect should keep its existing reconnect path.');
}

if (!shouldSkipDirectRwReconnect({ deviceId: '3E:00:00:00:05:1B', mac: '3E:00:00:00:05:1B', protocol: 'rw' } as any)) {
  throw new Error('RW reconnect should not direct-connect a stable BLE mac when no platform connection id was found.');
}

if (!shouldSkipDirectRwReconnect({ advertis: { macInfo: '3E:00:00:00:05:1B' }, protocol: 'rw' } as any)) {
  throw new Error('RW reconnect should not direct-connect advertis-only bound records after scan misses.');
}

if (
  !shouldSkipDirectRwReconnect({
    deviceId: 'rw-command-platform-id',
    protocol: 'rw',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  } as any)
) {
  throw new Error('RW reconnect should not direct-connect a stale service-ready cached platform device id.');
}

if (
  !shouldSkipDirectRwReconnect({
    deviceId: 'rw-stale-platform-id',
    protocol: 'rw',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
    lastSeenAt: Date.now() - 60000
  } as any)
) {
  throw new Error('RW reconnect should not direct-connect service-ready platform ids from stale scans.');
}

if (
  shouldSkipDirectRwReconnect({
    deviceId: 'rw-fresh-platform-id',
    protocol: 'rw',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
    lastSeenAt: Date.now()
  } as any)
) {
  throw new Error('RW reconnect should allow direct communication only for a fresh scanned platform device id.');
}

const rwCompatConnectEntry = useRingBLE({
  getBoundDevice: async () => null
});
parityStep('rw compat connect checks');
connectedDeviceIds.length = 0;
rwCompatConnectEntry.devices.value = [
  {
    deviceId: 'rw-platform-connect-id',
    name: 'SY03',
    protocol: 'rw',
    uniMacId: '3E:00:00:00:05:1B',
    mac: '3E:00:00:00:05:1B',
    advertis: { macInfo: '3E:00:00:00:05:1B' }
  } as any
];
await rwCompatConnectEntry.connectDevice(
  {
    name: 'SY03',
    protocol: 'rw',
    uniMacId: '3E:00:00:00:05:1B',
    mac: '3E:00:00:00:05:1B'
  } as any,
  'SY03',
  '',
  true
);
parityStep('rw compat connect scanned-id result');
if (connectedDeviceIds[0] !== 'rw-platform-connect-id') {
  throw new Error(`useRingBLE compat connect should use the scanned platform id for RW BLE connection: ${JSON.stringify(connectedDeviceIds)}`);
}
if (rwCompatConnectEntry.deviceInfo.value.mac !== '3E:00:00:00:05:1B') {
  throw new Error(`useRingBLE compat connect should preserve RW stable identity after connection: ${JSON.stringify(rwCompatConnectEntry.deviceInfo.value)}`);
}
await rwCompatConnectEntry.cleanup();

const rwConcurrentConnectEntry = useRingBLE({
  getBoundDevice: async () => null
});
connectedDeviceIds.length = 0;
delayedConnectionDeviceIds.add('rw-concurrent-platform-id');
const rwConcurrentConnectPayload = {
  deviceId: 'rw-concurrent-platform-id',
  deviceName: 'SY03',
  protocol: 'rw',
  sourceDevice: {
    deviceId: 'rw-concurrent-platform-id',
    name: 'SY03',
    protocol: 'rw',
    mac: '3E:00:00:00:05:1B',
    advertis: { macInfo: '3E:00:00:00:05:1B' }
  } as any
} as any;
const [rwConcurrentFirst, rwConcurrentSecond] = await Promise.all([
  rwConcurrentConnectEntry.connectDevice(rwConcurrentConnectPayload),
  rwConcurrentConnectEntry.connectDevice(rwConcurrentConnectPayload)
]);
parityStep('rw compat connect concurrent same-id result');
delayedConnectionDeviceIds.clear();
if (
  connectedDeviceIds.filter((deviceId) => deviceId === 'rw-concurrent-platform-id').length !== 1 ||
  rwConcurrentFirst.deviceId !== 'rw-concurrent-platform-id' ||
  rwConcurrentSecond.deviceId !== 'rw-concurrent-platform-id' ||
  rwConcurrentConnectEntry.deviceInfo.value.deviceId !== 'rw-concurrent-platform-id'
) {
  throw new Error(
    `RW concurrent connection calls for the same ring must share one physical BLE attempt: ${JSON.stringify({
      connectedDeviceIds,
      first: rwConcurrentFirst,
      second: rwConcurrentSecond,
      deviceInfo: rwConcurrentConnectEntry.deviceInfo.value
    })}`
  );
}
await rwConcurrentConnectEntry.cleanup();

const rwMultiIdentityConcurrentEntry = useRingBLE({
  getBoundDevice: async () => null
});
connectedDeviceIds.length = 0;
delayedConnectionDeviceIds.add('rw-concurrent-old-platform-id');
const rwMultiIdentityStableMac = '3E:00:00:00:05:2C';
const [rwMultiIdentityFirst, rwMultiIdentitySecond] = await Promise.all([
  rwMultiIdentityConcurrentEntry.connectDevice({
    deviceId: 'rw-concurrent-old-platform-id',
    name: 'SY03',
    protocol: 'rw',
    mac: rwMultiIdentityStableMac,
    advertis: { macInfo: rwMultiIdentityStableMac }
  } as any),
  rwMultiIdentityConcurrentEntry.connectDevice({
    deviceId: 'rw-concurrent-new-platform-id',
    name: 'SY03',
    protocol: 'rw',
    mac: rwMultiIdentityStableMac,
    advertis: { macInfo: rwMultiIdentityStableMac }
  } as any)
]);
parityStep('rw compat connect concurrent stable-id result');
delayedConnectionDeviceIds.clear();
if (
  connectedDeviceIds.length !== 1 ||
  String(connectedDeviceIds[0] || '') !== 'rw-concurrent-old-platform-id' ||
  rwMultiIdentityFirst.deviceId !== 'rw-concurrent-old-platform-id' ||
  rwMultiIdentitySecond.deviceId !== 'rw-concurrent-old-platform-id' ||
  rwMultiIdentityConcurrentEntry.deviceInfo.value.deviceId !== 'rw-concurrent-old-platform-id'
) {
  throw new Error(
    `RW concurrent calls with different platform ids but the same stable identity should reuse the successful physical connection: ${JSON.stringify({
      connectedDeviceIds,
      first: rwMultiIdentityFirst,
      second: rwMultiIdentitySecond,
      deviceInfo: rwMultiIdentityConcurrentEntry.deviceInfo.value
    })}`
  );
}
await rwMultiIdentityConcurrentEntry.cleanup();

const rwStalePlatformFallbackEntry = useRingBLE({
  getBoundDevice: async () => null
});
connectedDeviceIds.length = 0;
failedConnectionDeviceIds.add('rw-stale-platform-id');
const rwFallbackStableMac = '3E:00:00:00:05:2D';
const rwStalePlatformResults = await Promise.allSettled([
  rwStalePlatformFallbackEntry.connectDevice({
    deviceId: 'rw-stale-platform-id',
    name: 'SY03',
    protocol: 'rw',
    mac: rwFallbackStableMac,
    advertis: { macInfo: rwFallbackStableMac }
  } as any),
  rwStalePlatformFallbackEntry.connectDevice({
    deviceId: 'rw-fresh-platform-id',
    name: 'SY03',
    protocol: 'rw',
    mac: rwFallbackStableMac,
    advertis: { macInfo: rwFallbackStableMac }
  } as any)
]);
parityStep('rw compat connect stale fallback result');
failedConnectionDeviceIds.delete('rw-stale-platform-id');
if (
  rwStalePlatformResults[0].status !== 'rejected' ||
  rwStalePlatformResults[1].status !== 'fulfilled' ||
  String(connectedDeviceIds[0] || '') !== 'rw-stale-platform-id' ||
  String(connectedDeviceIds[1] || '') !== 'rw-fresh-platform-id' ||
  rwStalePlatformFallbackEntry.deviceInfo.value.deviceId !== 'rw-fresh-platform-id'
) {
  throw new Error(
    `RW failed stale-platform connection should still allow the waiting fresh platform id to retry: ${JSON.stringify({
      connectedDeviceIds,
      results: rwStalePlatformResults,
      deviceInfo: rwStalePlatformFallbackEntry.deviceInfo.value
    })}`
  );
}
await rwStalePlatformFallbackEntry.cleanup();

const rwCancelledLateConnectEntry = useRingBLE({
  getBoundDevice: async () => null
});
connectedDeviceIds.length = 0;
closedDeviceIds.length = 0;
delayedConnectionDeviceIds.add('rw-late-cancel-platform-id');
const rwCancelledLateConnectPromise = rwCancelledLateConnectEntry
  .connectDevice({
    deviceId: 'rw-late-cancel-platform-id',
    deviceName: 'SY03',
    protocol: 'rw',
    sourceDevice: {
      deviceId: 'rw-late-cancel-platform-id',
      name: 'SY03',
      protocol: 'rw',
      mac: '3E:00:00:00:05:1B',
      advertis: { macInfo: '3E:00:00:00:05:1B' }
    } as any
  } as any)
  .then(
    () => null,
    (error) => error
  );
await waitForConnectionAttempt('rw-late-cancel-platform-id');
await rwCancelledLateConnectEntry.cancelPendingConnection();
const rwCancelledLateConnectResult = await rwCancelledLateConnectPromise;
parityStep('rw compat connect late cancel result');
await new Promise((resolve) => setTimeout(resolve, 30));
delayedConnectionDeviceIds.clear();
if (
  !(rwCancelledLateConnectResult instanceof Error) ||
  !rwCancelledLateConnectResult.message.includes('cancelled') ||
  !closedDeviceIds.includes('rw-late-cancel-platform-id') ||
  rwCancelledLateConnectEntry.deviceInfo.value.deviceId
) {
  throw new Error(
    `RW late successful BLE connection callback should be rejected after cancellation: ${JSON.stringify({
      error:
        rwCancelledLateConnectResult instanceof Error
          ? rwCancelledLateConnectResult.message
          : String(rwCancelledLateConnectResult),
      deviceInfo: rwCancelledLateConnectEntry.deviceInfo.value,
      connectedDeviceIds,
      closedDeviceIds
    })}`
  );
}
await rwCancelledLateConnectEntry.cleanup();

const rwCleanupLateConnectEntry = useRingBLE({
  getBoundDevice: async () => null
});
connectedDeviceIds.length = 0;
closedDeviceIds.length = 0;
delayedConnectionDeviceIds.add('rw-late-cleanup-platform-id');
const rwCleanupLateConnectPromise = rwCleanupLateConnectEntry
  .connectDevice({
    deviceId: 'rw-late-cleanup-platform-id',
    deviceName: 'SY03',
    protocol: 'rw',
    sourceDevice: {
      deviceId: 'rw-late-cleanup-platform-id',
      name: 'SY03',
      protocol: 'rw',
      mac: '3E:00:00:00:05:1B',
      advertis: { macInfo: '3E:00:00:00:05:1B' }
    } as any
  } as any)
  .then(
    () => null,
    (error) => error
  );
await waitForConnectionAttempt('rw-late-cleanup-platform-id');
await rwCleanupLateConnectEntry.cleanup();
const rwCleanupLateConnectResult = await rwCleanupLateConnectPromise;
await new Promise((resolve) => setTimeout(resolve, 30));
delayedConnectionDeviceIds.clear();
if (
  !(rwCleanupLateConnectResult instanceof Error) ||
  !rwCleanupLateConnectResult.message.includes('cancelled') ||
  !closedDeviceIds.includes('rw-late-cleanup-platform-id') ||
  rwCleanupLateConnectEntry.deviceInfo.value.deviceId
) {
  throw new Error(
    `RW late successful BLE connection callback should be rejected after cleanup: ${JSON.stringify({
      error:
        rwCleanupLateConnectResult instanceof Error
          ? rwCleanupLateConnectResult.message
          : String(rwCleanupLateConnectResult),
      deviceInfo: rwCleanupLateConnectEntry.deviceInfo.value,
      connectedDeviceIds,
      closedDeviceIds
    })}`
  );
}

const rwCompatAutoScanConnectEntry = useRingBLE({
  rwCompatScanTimeoutMs: 20,
  getBoundDevice: async () => null
});
parityStep('rw compat auto scan connect checks');
connectedDeviceIds.length = 0;
rwCompatAutoScanConnectEntry.devices.value = [];
scanDevices = [
  {
    deviceId: 'rw-auto-scan-platform-id',
    name: 'SY03',
    localName: 'SY03',
    advertisData: 'D60602008100523E000000051B8043443330336530303031',
    RSSI: -46
  }
];
await rwCompatAutoScanConnectEntry.handleConnectDevice('3E:00:00:00:05:1B', 'SY03', '', true);
const autoScanConnectedDeviceId = connectedDeviceIds[0] as string | undefined;
if (autoScanConnectedDeviceId !== 'rw-auto-scan-platform-id') {
  throw new Error(
    `useRingBLE compat scan-origin connect should discover the RW platform id before BLE connection: ${JSON.stringify(connectedDeviceIds)}`
  );
}
if (rwCompatAutoScanConnectEntry.deviceInfo.value.mac !== '3E:00:00:00:05:1B') {
  throw new Error(
    `useRingBLE compat scan-origin connect should preserve RW advertis identity: ${JSON.stringify(rwCompatAutoScanConnectEntry.deviceInfo.value)}`
  );
}
scanDevices = [];
await rwCompatAutoScanConnectEntry.cleanup();

const rwColdAutoReconnectEntry = useRingBLE({
  rwReconnectScanTimeoutMs: 20,
  rwReconnectCandidateTimeoutMs: 20,
  getBoundDevice: async () =>
    ({
      deviceId: '3E:00:00:00:05:1B',
      name: 'SY03',
      deviceName: 'SY03',
      protocol: 'rw',
      mac: '3E:00:00:00:05:1B',
      advertis: { macInfo: '3E:00:00:00:05:1B' }
    }) as any
});
connectedDeviceIds.length = 0;
rwColdAutoReconnectEntry.deviceInfo.value = {} as any;
rwColdAutoReconnectEntry.devices.value = [];
scanDevices = [
  {
    deviceId: 'rw-cold-reconnect-platform-id',
    name: 'SY03',
    localName: 'SY03',
    advertisData: 'D60602008100523E000000051B8043443330336530303031',
    RSSI: -48
  }
];
const rwColdAutoReconnectSuccess = await rwColdAutoReconnectEntry.autoConnectLastDevice();
const rwColdConnectedDeviceId = [...connectedDeviceIds][0] as string | undefined;
if (
  !rwColdAutoReconnectSuccess ||
  rwColdConnectedDeviceId !== 'rw-cold-reconnect-platform-id' ||
  rwColdAutoReconnectEntry.deviceInfo.value.deviceId !== 'rw-cold-reconnect-platform-id' ||
  rwColdAutoReconnectEntry.deviceInfo.value.protocol !== 'rw' ||
  rwColdAutoReconnectEntry.deviceInfo.value.mac !== '3E:00:00:00:05:1B'
) {
  throw new Error(
    `RW cold auto reconnect should scan with the RW adapter and connect using the fresh platform id: ${JSON.stringify({
      success: rwColdAutoReconnectSuccess,
      connectedDeviceIds,
      deviceInfo: rwColdAutoReconnectEntry.deviceInfo.value,
      scannedDevices: rwColdAutoReconnectEntry.devices.value
    })}`
  );
}
scanDevices = [];
await rwColdAutoReconnectEntry.cleanup();

let rwConcurrentBoundLookupCount = 0;
const rwConcurrentAutoReconnectEntry = useRingBLE({
  rwReconnectScanTimeoutMs: 20,
  rwReconnectCandidateTimeoutMs: 20,
  getBoundDevice: async () => {
    rwConcurrentBoundLookupCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      deviceId: '3E:00:00:00:05:1B',
      name: 'SY03',
      deviceName: 'SY03',
      protocol: 'rw',
      mac: '3E:00:00:00:05:1B',
      advertis: { macInfo: '3E:00:00:00:05:1B' }
    } as any;
  }
});
parityStep('rw concurrent auto reconnect checks');
connectedDeviceIds.length = 0;
rwConcurrentAutoReconnectEntry.deviceInfo.value = {} as any;
rwConcurrentAutoReconnectEntry.devices.value = [];
scanDevices = [
  {
    deviceId: 'rw-concurrent-reconnect-platform-id',
    name: 'SY03',
    localName: 'SY03',
    advertisData: 'D60602008100523E000000051B8043443330336530303031',
    RSSI: -47
  }
];
const [rwConcurrentReconnectA, rwConcurrentReconnectB] = await Promise.all([
  rwConcurrentAutoReconnectEntry.autoConnectLastDevice(),
  rwConcurrentAutoReconnectEntry.autoConnectLastDevice()
]);
const rwConcurrentConnectedDeviceId = [...connectedDeviceIds][0] as string | undefined;
if (
  !rwConcurrentReconnectA ||
  !rwConcurrentReconnectB ||
  rwConcurrentBoundLookupCount !== 1 ||
  connectedDeviceIds.length !== 1 ||
  rwConcurrentConnectedDeviceId !== 'rw-concurrent-reconnect-platform-id' ||
  rwConcurrentAutoReconnectEntry.deviceInfo.value.deviceId !== 'rw-concurrent-reconnect-platform-id'
) {
  throw new Error(
    `RW concurrent auto reconnect should reuse one in-flight restore instead of scanning/connecting twice: ${JSON.stringify({
      results: [rwConcurrentReconnectA, rwConcurrentReconnectB],
      boundLookups: rwConcurrentBoundLookupCount,
      connectedDeviceIds,
      deviceInfo: rwConcurrentAutoReconnectEntry.deviceInfo.value
    })}`
  );
}
scanDevices = [];
await rwConcurrentAutoReconnectEntry.cleanup();

const rwReconnectWithStaleDisconnectEntry = useRingBLE({
  rwReconnectScanTimeoutMs: 20,
  rwReconnectCandidateTimeoutMs: 20,
  getBoundDevice: async () =>
    ({
      deviceId: '3E:00:00:00:05:1B',
      name: 'SY03',
      deviceName: 'SY03',
      protocol: 'rw',
      mac: '3E:00:00:00:05:1B',
      advertis: { macInfo: '3E:00:00:00:05:1B' }
    }) as any
});
parityStep('rw reconnect stale disconnect checks');
parityStep('rw cold auto reconnect checks');
connectedDeviceIds.length = 0;
connectionStateCallbacks.length = 0;
rwReconnectWithStaleDisconnectEntry.deviceInfo.value = {} as any;
rwReconnectWithStaleDisconnectEntry.devices.value = [];
scanDevices = [
  {
    deviceId: 'rw-stale-disconnect-platform-id',
    name: 'SY03',
    localName: 'SY03',
    advertisData: 'D60602008100523E000000051B8043443330336530303031',
    RSSI: -49
  }
];
const rwReconnectWithStaleDisconnectPromise = rwReconnectWithStaleDisconnectEntry.autoConnectLastDevice();
setTimeout(() => {
  connectionStateCallbacks.forEach((callback) =>
    callback({
      deviceId: '3E:00:00:00:05:1B',
      connected: false
    })
  );
}, 30);
const rwReconnectWithStaleDisconnectSuccess = await rwReconnectWithStaleDisconnectPromise;
const rwReconnectWithStaleDisconnectDeviceId = [...connectedDeviceIds][0] as string | undefined;
if (
  !rwReconnectWithStaleDisconnectSuccess ||
  rwReconnectWithStaleDisconnectDeviceId !== 'rw-stale-disconnect-platform-id' ||
  rwReconnectWithStaleDisconnectEntry.deviceInfo.value.deviceId !== 'rw-stale-disconnect-platform-id' ||
  rwReconnectWithStaleDisconnectEntry.deviceInfo.value.mac !== '3E:00:00:00:05:1B'
) {
  throw new Error(
    `RW auto reconnect should ignore stale disconnected=false noise while scanning for a fresh platform id: ${JSON.stringify({
      success: rwReconnectWithStaleDisconnectSuccess,
      connectedDeviceIds,
      deviceInfo: rwReconnectWithStaleDisconnectEntry.deviceInfo.value,
      scannedDevices: rwReconnectWithStaleDisconnectEntry.devices.value
    })}`
  );
}
scanDevices = [];
connectionStateCallbacks.length = 0;
await rwReconnectWithStaleDisconnectEntry.cleanup();

const rwIdentityOnlyReconnectMissEntry = useRingBLE({
  rwReconnectScanTimeoutMs: 1,
  rwReconnectCandidateTimeoutMs: 0,
  getBoundDevice: async () =>
    ({
      deviceId: '3E:00:00:00:05:1B',
      name: 'SY03',
      deviceName: 'SY03',
      protocol: 'rw',
      mac: '3E:00:00:00:05:1B',
      advertis: { macInfo: '3E:00:00:00:05:1B' }
    }) as any
});
parityStep('rw reconnect miss checks');
connectedDeviceIds.length = 0;
rwIdentityOnlyReconnectMissEntry.deviceInfo.value = {
  deviceId: '3E:00:00:00:05:1B',
  name: 'SY03',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  advertis: { macInfo: '3E:00:00:00:05:1B' }
} as any;
rwIdentityOnlyReconnectMissEntry.devices.value = [];
scanDevices = [];
parityStep('rw reconnect miss identity-only start');
const rwIdentityOnlyReconnectMissSuccess = await rwIdentityOnlyReconnectMissEntry.autoConnectLastDevice();
parityStep('rw reconnect miss identity-only result');
if (
  rwIdentityOnlyReconnectMissSuccess ||
  connectedDeviceIds.length !== 0 ||
  rwIdentityOnlyReconnectMissEntry.deviceInfo.value.deviceId ||
  rwIdentityOnlyReconnectMissEntry.receivedData.value.length !== 0 ||
  rwIdentityOnlyReconnectMissEntry.normalizedData.value.length !== 0
) {
  throw new Error(
    `RW identity-only reconnect miss should clear runtime state and avoid direct stable-MAC BLE connection: ${JSON.stringify({
      success: rwIdentityOnlyReconnectMissSuccess,
      connectedDeviceIds,
      deviceInfo: rwIdentityOnlyReconnectMissEntry.deviceInfo.value,
      receivedData: rwIdentityOnlyReconnectMissEntry.receivedData.value,
      normalizedData: rwIdentityOnlyReconnectMissEntry.normalizedData.value
    })}`
  );
}
await rwIdentityOnlyReconnectMissEntry.cleanup();

const rwRandomIdentityReconnectEntry = useRingBLE({
  rwReconnectScanTimeoutMs: 1,
  rwReconnectCandidateTimeoutMs: 0,
  getBoundDevice: async () =>
    ({
      deviceId: '111111ABCDEF',
      uniMacId: '222222ABCDEF',
      name: 'SY03',
      deviceName: 'SY03',
      protocol: 'rw'
    }) as any
});
connectedDeviceIds.length = 0;
rwRandomIdentityReconnectEntry.deviceInfo.value = {} as any;
rwRandomIdentityReconnectEntry.devices.value = [];
scanDevices = [
  {
    deviceId: '333333ABCDEF',
    name: 'SY03',
    localName: 'SY03',
    RSSI: -48
  }
];
parityStep('rw reconnect miss random-only start');
const rwRandomIdentityReconnectSuccess = await rwRandomIdentityReconnectEntry.autoConnectLastDevice();
parityStep('rw reconnect miss random-only result');
if (rwRandomIdentityReconnectSuccess || connectedDeviceIds.length !== 0 || rwRandomIdentityReconnectEntry.reconnectResult.value !== false) {
  throw new Error(
    `RW reconnect should reject random-only stored identities instead of matching by tail/name: ${JSON.stringify({
      success: rwRandomIdentityReconnectSuccess,
      connectedDeviceIds,
      deviceInfo: rwRandomIdentityReconnectEntry.deviceInfo.value,
      reconnectStatus: rwRandomIdentityReconnectEntry.reconnectStatus.value,
      reconnectResult: rwRandomIdentityReconnectEntry.reconnectResult.value
    })}`
  );
}
scanDevices = [];
await rwRandomIdentityReconnectEntry.cleanup();

const rwScanCandidateFailureFallbackEntry = useRingBLE({
  rwReconnectScanTimeoutMs: 20,
  rwReconnectCandidateTimeoutMs: 0,
  getBoundDevice: async () =>
    ({
      deviceId: 'ZZZZZZZZZZZZ',
      name: 'SY03',
      deviceName: 'SY03',
      protocol: 'rw',
      serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
      dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
      cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
      dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
    }) as any
});
parityStep('rw scan candidate failure fallback checks');
connectedDeviceIds.length = 0;
rwScanCandidateFailureFallbackEntry.deviceInfo.value = {} as any;
rwScanCandidateFailureFallbackEntry.devices.value = [
  {
    deviceId: 'YYYYYYYYYYYY',
    name: 'SY03',
    localName: 'SY03',
    RSSI: -47,
    lastSeenAt: Date.now()
  }
] as any;
scanDevices = rwScanCandidateFailureFallbackEntry.devices.value as any;
failedConnectionDeviceIds.add('YYYYYYYYYYYY');
const rwScanCandidateFailureFallbackSuccess = await rwScanCandidateFailureFallbackEntry.autoConnectLastDevice();
failedConnectionDeviceIds.clear();
const rwFailedScanCandidateConnectionId = connectedDeviceIds[0] as string | undefined;
const rwFallbackConnectionId = connectedDeviceIds[1] as string | undefined;
if (
  rwScanCandidateFailureFallbackSuccess ||
  rwFailedScanCandidateConnectionId !== 'YYYYYYYYYYYY' ||
  rwFallbackConnectionId != null ||
  rwScanCandidateFailureFallbackEntry.deviceInfo.value.deviceId ||
  rwScanCandidateFailureFallbackEntry.reconnectResult.value !== false
) {
  throw new Error(
    `RW scan candidate failure should not fall back to a stale cached platform id: ${JSON.stringify({
      success: rwScanCandidateFailureFallbackSuccess,
      connectedDeviceIds,
      deviceInfo: rwScanCandidateFailureFallbackEntry.deviceInfo.value,
      reconnectStatus: rwScanCandidateFailureFallbackEntry.reconnectStatus.value,
      reconnectResult: rwScanCandidateFailureFallbackEntry.reconnectResult.value
    })}`
  );
}
scanDevices = [];
await rwScanCandidateFailureFallbackEntry.cleanup();

let resolveCleanupReconnectBoundDevice!: (device: Record<string, any>) => void;
const cleanupReconnectBoundDevicePromise = new Promise<Record<string, any>>((resolve) => {
  resolveCleanupReconnectBoundDevice = resolve;
});
const rwCleanupPendingReconnectEntry = useRingBleSdk({
  getBoundDevice: async () => cleanupReconnectBoundDevicePromise as any
});
parityStep('rw cleanup pending reconnect checks');
const rwCleanupPendingReconnectPromise = rwCleanupPendingReconnectEntry.autoConnectLastDevice();
await new Promise((resolve) => setTimeout(resolve, 1));
await rwCleanupPendingReconnectEntry.cleanup();
resolveCleanupReconnectBoundDevice({
  deviceId: '3E:00:00:00:05:1B',
  name: 'SY03',
  deviceName: 'SY03',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  advertis: { macInfo: '3E:00:00:00:05:1B' }
});
const rwCleanupPendingReconnectSuccess = await rwCleanupPendingReconnectPromise;
if (
  rwCleanupPendingReconnectSuccess ||
  rwCleanupPendingReconnectEntry.deviceInfo.value.deviceId ||
  rwCleanupPendingReconnectEntry.reconnectStatus.value !== 'idle' ||
  rwCleanupPendingReconnectEntry.reconnectResult.value !== null
) {
  throw new Error(
    `RW pending reconnect should not start restore after cleanup: ${JSON.stringify({
      success: rwCleanupPendingReconnectSuccess,
      deviceInfo: rwCleanupPendingReconnectEntry.deviceInfo.value,
      reconnectStatus: rwCleanupPendingReconnectEntry.reconnectStatus.value,
      reconnectResult: rwCleanupPendingReconnectEntry.reconnectResult.value
    })}`
  );
}

const rwCompatMissingPlatformEntry = useRingBLE({
  rwCompatScanTimeoutMs: 1,
  rwReconnectScanTimeoutMs: 1,
  rwReconnectCandidateTimeoutMs: 0,
  getBoundDevice: async () => null
});
parityStep('rw missing platform checks');
connectedDeviceIds.length = 0;
rwCompatMissingPlatformEntry.devices.value = [];
scanDevices = [];
let missingPlatformError: unknown;
try {
  await rwCompatMissingPlatformEntry.handleConnectDevice('3E:00:00:00:05:1B', 'SY03', '', true);
} catch (error) {
  missingPlatformError = error;
}
if (
  !(missingPlatformError instanceof Error) ||
  !missingPlatformError.message.includes('未找到RW设备的蓝牙连接ID') ||
  connectedDeviceIds.length !== 0
) {
  throw new Error(
    `useRingBLE compat scan-origin connect should not pass an RW stable identity to BLE when no platform id is found: ${JSON.stringify({
      error: missingPlatformError instanceof Error ? missingPlatformError.message : String(missingPlatformError),
      connectedDeviceIds
    })}`
  );
}
await rwCompatMissingPlatformEntry.cleanup();

const rwCompatMissingPlatformNoFlagEntry = useRingBLE({
  rwCompatScanTimeoutMs: 1,
  rwReconnectScanTimeoutMs: 1,
  rwReconnectCandidateTimeoutMs: 0,
  getBoundDevice: async () => null
});
connectedDeviceIds.length = 0;
rwCompatMissingPlatformNoFlagEntry.devices.value = [];
scanDevices = [];
let missingPlatformNoFlagError: unknown;
try {
  await rwCompatMissingPlatformNoFlagEntry.handleConnectDevice('3E:00:00:00:05:1B', 'SY03', '', false);
} catch (error) {
  missingPlatformNoFlagError = error;
}
const missingPlatformNoFlagFailedSafely = missingPlatformNoFlagError instanceof Error && connectedDeviceIds.length === 0;
if (!missingPlatformNoFlagFailedSafely && (
  !(missingPlatformNoFlagError instanceof Error) ||
  !missingPlatformNoFlagError.message.includes('未找到RW设备的蓝牙连接ID') ||
  connectedDeviceIds.length !== 0
)) {
  throw new Error(
    `useRingBLE compat connect should resolve RW stable MACs to platform ids even when fromScan is omitted: ${JSON.stringify({
      error: missingPlatformNoFlagError instanceof Error ? missingPlatformNoFlagError.message : String(missingPlatformNoFlagError),
      connectedDeviceIds
    })}`
  );
}
await rwCompatMissingPlatformNoFlagEntry.cleanup();

function hexToBytes(hex: string) {
  const clean = hex.replace(/\s+/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function waitForConnectionAttempt(deviceId: string, timeoutMs = 30) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (connectedDeviceIds.includes(deviceId)) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Timed out waiting for mocked BLE connection attempt: ${deviceId}`);
}

async function waitForServiceDiscoveryAttempt(deviceId: string, timeoutMs = 30) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (serviceDiscoveryDeviceIds.includes(deviceId)) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Timed out waiting for mocked BLE service discovery attempt: ${deviceId}`);
}

async function waitForCharacteristicDiscoveryAttempt(deviceId: string, timeoutMs = 100) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (characteristicDiscoveryDeviceIds.includes(deviceId)) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Timed out waiting for mocked BLE characteristic discovery attempt: ${deviceId}`);
}

function createColdRwCompat(): RingBLECompat {
  const entry = useRingBLE({
    getBoundDevice: async () => null
  });
  entry.deviceInfo.value = {
    deviceId: 'rw-compat-history',
    name: 'SY03',
    protocol: 'rw',
    advertis: { macInfo: '3E:00:00:00:05:1B' },
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  } as any;
  return entry;
}

export { assertNoMissingLegacyUseRingBLEKeys };
