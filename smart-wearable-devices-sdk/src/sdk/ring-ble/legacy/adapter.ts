import type { RingBleAdapter, RingBleRuntime, RingBleState, RingDeviceInfo, RingParsedData } from '../types';
import type { RwHealthMonitoringConfig, RwUserProfile } from '../rw/protocol';
import { parseQkeerV2AdvertisInfo, parseRwAdvertisInfo, resolveRingProtocol } from '../protocolRegistry';
import { LegacyRingCommand } from './commands';
import { parseLegacyRingData } from './parser';
import {
  buildLegacyCommandByName,
  buildLegacyCommandBytes,
  concatBytes,
  getLegacyPlatformType,
  getTodayZeroTimestamp,
  type LegacyCommandPayload,
  numberToUint32LE,
  numberToUint64LE
} from './protocol';

export interface LegacyRingAdapter extends RingBleAdapter {
  initBluetooth: () => Promise<unknown>;
  openBluetoothAdapter: () => Promise<unknown>;
  registerConnectionStateListener: (options?: LegacyConnectionStateOptions) => void;
  checkBluetoothState: () => Promise<boolean>;
  startScan: (options?: LegacyScanOptions) => Promise<unknown>;
  stopScan: () => Promise<unknown>;
  setMTU: (deviceId: string, mtu?: number) => Promise<unknown>;
  connectDevice: (deviceId: string, deviceName?: string, sourceDevice?: RingDeviceInfo) => Promise<RingDeviceInfo>;
  connectAndDiscover: (deviceId: string, deviceName?: string, sourceDevice?: RingDeviceInfo) => Promise<RingDeviceInfo>;
  discoverServicesAndChars: (deviceId: string, deviceName?: string, sourceDevice?: RingDeviceInfo) => Promise<RingDeviceInfo>;
  enableNotify: (deviceId: string, serviceId: string, characteristicId: string) => Promise<unknown>;
  checkByRSSI: (deviceId: string) => Promise<boolean>;
  isDeviceConnected: (deviceId: string, serviceId: string) => Promise<boolean>;
  cacheServiceId: (mac: string, serviceId: string) => void;
  getCachedServiceId: (mac: string) => string;
  disconnect: (deviceId?: string) => Promise<unknown>;
  cleanup: () => Promise<void>;
  sendBytes: (bytes: Uint8Array, label?: string) => Promise<unknown>;
  sendCommand: (cmd: number, subcmd: number, payload?: LegacyCommandPayload) => Promise<unknown>;
  sendNamedCommand: (command: LegacyRingCommand, payload?: LegacyCommandPayload) => Promise<unknown>;
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number, options?: { replayRecent?: boolean }) => Promise<RingParsedData>;
  setupDataListener: () => void;
  clearDataListener: () => void;
  sendBatteryCommand: () => Promise<unknown>;
  sendActiveMeasureCommand: () => Promise<unknown>;
  sendOxyGenCommand: () => Promise<unknown>;
  sendBodyTemperatureCommand: () => Promise<unknown>;
  sendFirmwareVersion: () => Promise<unknown>;
  sendSoftwareVersion: () => Promise<unknown>;
  sendReadLocalDataCommand: (sinceTimestamp?: number, readAll?: boolean) => Promise<unknown>;
  readLocalData: (options?: LegacyReadLocalDataOptions) => Promise<unknown>;
  readDeviceTime: () => Promise<unknown>;
  updateDeviceTime: (timestampMs?: number, timezone?: number) => Promise<unknown>;
  sendCollectPeriodSettingCommand: (seconds?: number) => Promise<unknown>;
  readCollectPeriodCommand: () => Promise<unknown>;
  sendResetCommand: () => Promise<unknown>;
  sendFactoryResetWithTimeCommand: () => Promise<unknown>;
  sendDeleteAllLocalDataCommand: () => Promise<unknown>;
  readRwHealthData?: (name: RwHealthDataName) => Promise<unknown>;
  deleteRwHealthData?: (name: RwHealthDataName) => Promise<unknown>;
  controlRwHealthData?: (name: RwHealthDataName, enabled?: boolean) => Promise<unknown>;
  readRwMonitoringConfig?: (name: RwMonitoringName) => Promise<unknown>;
  setRwMonitoringConfig?: (name: RwMonitoringName, config: RwHealthMonitoringConfig) => Promise<unknown>;
  setRwUserProfile?: (profile: RwUserProfile) => Promise<unknown>;
  formatRwFileSystem?: () => Promise<unknown>;
  getTimedHeartRateJL?: () => Promise<unknown>;
  getTimedBloodOxygenJL?: () => Promise<unknown>;
  getTimedHRVJL?: () => Promise<unknown>;
  getTimedStressJL?: () => Promise<unknown>;
  getTimedBloodSugarJL?: () => Promise<unknown>;
  getTimedBloodPressureJL?: () => Promise<unknown>;
  getTimedTemperatureJL?: () => Promise<unknown>;
  setTimedHeartRateJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  setTimedBloodOxygenJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  setTimedHRVJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  setTimedStressJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  setTimedBloodSugarJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  setTimedBloodPressureJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  setTimedTemperatureJL?: (config: RwHealthMonitoringConfig) => Promise<unknown>;
  controlHealthDataJL?: (name: RwHealthDataName, enabled?: boolean) => Promise<unknown>;
  syncAllHealthData?: () => Promise<unknown>;
  syncHealthDataByType?: (name?: RwHistoryDataName) => Promise<unknown>;
}

export type RwHealthDataName =
  | 'heart_rate'
  | 'heartRate'
  | 'heart-rate'
  | 'heartrate'
  | 'hr'
  | 'temperature'
  | 'bodyTemperature'
  | 'body-temperature'
  | 'bodyTemp'
  | 'body-temp'
  | 'skinTemperature'
  | 'skin-temperature'
  | 'skinTemp'
  | 'skin-temp'
  | 'blood_oxygen'
  | 'bloodOxygen'
  | 'blood-oxygen'
  | 'oxygen'
  | 'spo2'
  | 'spO2'
  | 'SpO2'
  | 'SPO2'
  | 'blood_sugar'
  | 'bloodSugar'
  | 'blood-sugar'
  | 'glucose'
  | 'hrv'
  | 'stress'
  | 'blood_pressure'
  | 'bloodPressure'
  | 'blood-pressure'
  | 'bp';
export type RwHistoryDataName =
  | RwHealthDataName
  | 'summary'
  | 'lastData'
  | 'last-data'
  | 'lastSnapshot'
  | 'last-snapshot'
  | 'snapshot'
  | 'vital'
  | 'vitals'
  | 'vitalSigns'
  | 'vital-signs'
  | 'sleep'
  | 'sleepData'
  | 'sleep-data'
  | 'sleepDetail'
  | 'sleep-detail'
  | 'sleepDetails'
  | 'sleep-details'
  | 'step'
  | 'steps'
  | 'stepCount'
  | 'step-count'
  | 'sport'
  | 'activity'
  | 'dailyActivity'
  | 'daily-activity'
  | 'dailyHealth'
  | 'daily-health';
export type RwMonitoringName = RwHealthDataName;

export interface LegacyScanOptions {
  prefixes?: string[];
  timeoutMs?: number;
  allowDuplicatesKey?: boolean;
  includeUnknown?: boolean;
  preserveDevices?: boolean;
}

export interface LegacyConnectionStateOptions {
  onConnected?: (deviceId: string) => void;
  onDisconnected?: (deviceId: string) => void;
}

export interface LegacyReadLocalDataOptions {
  readAll?: boolean;
  sinceTimestamp?: number;
  time?: 'day' | string;
  dataType?: string;
  dataTypes?: string[];
}

const DEFAULT_SCAN_PREFIXES = ['HR', 'IF', 'QKeeRing', 'PPlus'];
const LEGACY_SERVICE_MARKERS = ['BAE8', '4F05-4503-8E65-3AF1F7329D1F'];
const SERVICE_CACHE_KEY = 'deviceServiceCache';

type BluetoothDeviceFoundCallback = Parameters<typeof uni.onBluetoothDeviceFound>[0];

const offBluetoothDeviceFound = (callback: BluetoothDeviceFoundCallback) => {
  (uni.offBluetoothDeviceFound as unknown as (callback: BluetoothDeviceFoundCallback) => void)(callback);
};

const ensureWriteDevice = (runtime: RingBleRuntime) => {
  const deviceInfo = runtime.getDeviceInfo();
  const { deviceId, serviceId, cmdCharId } = deviceInfo;

  if (!deviceId || !serviceId || !cmdCharId) {
    throw new Error('Ring BLE device is not ready for command writes.');
  }

  return { deviceId, serviceId, cmdCharId };
};

const isTargetDevice = (name: string | undefined, prefixes: string[]) => {
  if (!name) return false;
  return prefixes.some((prefix) => name.startsWith(prefix));
};

const getMacFromAdvertisData = (buffer?: ArrayBuffer) => {
  if (!buffer || buffer.byteLength < 6) return '';

  const hexArr = Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, '0').toUpperCase());
  return hexArr.slice(-6).reverse().join(':');
};

const getAdvertisHex = (value?: ArrayBuffer | string | number[]) => {
  if (!value) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, '').toUpperCase();
  if (Array.isArray(value)) {
    return value.map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
};

export const getScannedDeviceMergeKeys = (device: RingDeviceInfo) => {
  const name = `${device.displayName || device.name || device.localName || device.bleName || ''}`.trim().toUpperCase();
  const protocol = device.protocol || resolveRingProtocol(device);
  const advertisHex = getAdvertisHex(device.advertisData);
  const advertisTail = advertisHex.slice(-24);
  const serviceIds = [
    device.serviceId,
    ...(Array.isArray(device.advertisServiceUUIDs) ? device.advertisServiceUUIDs : []),
    ...(Array.isArray(device.advertisServiceUUIDsList) ? device.advertisServiceUUIDsList : [])
  ]
    .filter(Boolean)
    .map((value) => `${value}`.toUpperCase())
    .join('|');

  return [
    device.deviceId ? `device:${device.deviceId}` : '',
    device.uniMacId ? `mac:${device.uniMacId}` : '',
    device.mac ? `mac:${device.mac}` : '',
    device.advertis?.macInfo ? `mac:${device.advertis.macInfo}` : '',
    advertisTail ? `adv:${protocol}:${advertisTail}` : '',
    name && advertisTail ? `name-adv:${protocol}:${name}:${advertisTail}` : '',
    !device.deviceId && name && serviceIds ? `name-service:${protocol}:${name}:${serviceIds}` : ''
  ].filter(Boolean);
};

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, message: string) => {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))]);
};

export const createLegacyRingAdapter = (state: RingBleState, runtime?: RingBleRuntime): LegacyRingAdapter => {
  let scanTimeout: ReturnType<typeof setTimeout> | null = null;
  let scanPollTimer: ReturnType<typeof setInterval> | null = null;
  let scanPrefixes = DEFAULT_SCAN_PREFIXES;
  let includeUnknownScanDevices = false;
  const parsedWaiters: Array<{
    predicate: (parsed: RingParsedData) => boolean;
    resolve: (parsed: RingParsedData) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  const openBluetoothAdapter = () => {
    return new Promise<unknown>((resolve, reject) => {
      uni.openBluetoothAdapter({
        success: resolve,
        fail: reject
      });
    });
  };

  const registerConnectionStateListener = (options: LegacyConnectionStateOptions = {}) => {
    uni.offBLEConnectionStateChange();
    uni.onBLEConnectionStateChange((result) => {
      if (result.connected) {
        options.onConnected?.(result.deviceId);
        return;
      }

      const currentDeviceId = runtime?.getDeviceInfo?.().deviceId;
      if (currentDeviceId && result.deviceId !== currentDeviceId) return;

      clearDataListener();
      options.onDisconnected?.(result.deviceId);
      runtime?.onDisconnected?.(result);
    });

    (uni.offBluetoothAdapterStateChange as unknown as (() => void) | undefined)?.();
    uni.onBluetoothAdapterStateChange?.((result) => {
      runtime?.onBluetoothReadyChange?.(Boolean(result.available));
      if (result.available) return;

      void stopScan();
      clearDataListener();
      runtime?.onDisconnected?.({
        reason: 'bluetooth_adapter_unavailable',
        available: false,
        discovering: result.discovering
      });
    });
  };

  const initBluetooth = async () => {
    const result = await openBluetoothAdapter();
    registerConnectionStateListener();
    return result;
  };

  const checkBluetoothState = () => {
    return new Promise<boolean>((resolve) => {
      uni.getBluetoothAdapterState({
        success: (stateResult) => resolve(Boolean(stateResult.available)),
        fail: () => resolve(false)
      });
    });
  };

  const mergeScannedDevices = (devices: any[]) => {
    if (!state.isScanning.value || !Array.isArray(devices)) return;
    const platform = uni.getSystemInfoSync().platform?.toLowerCase?.() || '';

    devices.forEach((device: any) => {
      const name = device.name || device.localName;
      const protocol = resolveRingProtocol(device);
      if (!includeUnknownScanDevices && protocol === 'legacy' && !isTargetDevice(name, scanPrefixes)) return;

      const parsedMac = getMacFromAdvertisData(device.advertisData);
      const uniMacId = parsedMac || (platform.includes('ios') ? device.uniMacId : undefined);
      const advertis =
        protocol === 'qkeer-v2'
          ? device.advertis || parseQkeerV2AdvertisInfo(device) || undefined
          : protocol === 'rw'
            ? device.advertis || parseRwAdvertisInfo(device) || undefined
            : device.advertis;
      const matchedDevice = {
        ...device,
        displayName: name,
        protocol,
        advertis,
        uniMacId,
        mac: device.mac || advertis?.macInfo,
        lastSeenAt: Date.now()
      };
      const matchedKeys = getScannedDeviceMergeKeys(matchedDevice);
      const existingIndex = state.devices.value.findIndex((item) => {
        const itemKeys = getScannedDeviceMergeKeys(item);
        return itemKeys.some((key) => matchedKeys.includes(key));
      });

      if (existingIndex >= 0) {
        const previous = state.devices.value[existingIndex];
        state.devices.value.splice(existingIndex, 1, {
          ...previous,
          ...matchedDevice,
          displayName: matchedDevice.displayName || previous.displayName,
          name: matchedDevice.name || previous.name,
          localName: matchedDevice.localName || previous.localName,
          protocol: matchedDevice.protocol === 'legacy' ? previous.protocol || matchedDevice.protocol : matchedDevice.protocol,
          uniMacId: matchedDevice.uniMacId || previous.uniMacId
        });
        return;
      }

      state.devices.value.push(matchedDevice);
    });
  };

  const handleDeviceFound = (result: any) => {
    mergeScannedDevices(result?.devices);
  };

  const stopScan = () => {
    return new Promise<unknown>((resolve) => {
      if (scanTimeout) {
        clearTimeout(scanTimeout);
        scanTimeout = null;
      }
      if (scanPollTimer) {
        clearInterval(scanPollTimer);
        scanPollTimer = null;
      }

      offBluetoothDeviceFound(handleDeviceFound);

      if (!state.isScanning.value) {
        resolve(undefined);
        return;
      }

      uni.stopBluetoothDevicesDiscovery({
        success: (result) => {
          state.isScanning.value = false;
          resolve(result);
        },
        fail: (error) => {
          state.isScanning.value = false;
          resolve(error);
        }
      });
    });
  };

  const startScan = (options: LegacyScanOptions = {}) => {
    if (state.isScanning.value) return Promise.resolve(undefined);

    scanPrefixes = options.prefixes?.length ? options.prefixes : DEFAULT_SCAN_PREFIXES;
    includeUnknownScanDevices = Boolean(options.includeUnknown);
    if (!options.preserveDevices) state.devices.value = [];
    state.isScanning.value = true;
    offBluetoothDeviceFound(handleDeviceFound);
    if (scanPollTimer) {
      clearInterval(scanPollTimer);
      scanPollTimer = null;
    }

    scanTimeout = setTimeout(() => {
      void stopScan();
    }, options.timeoutMs ?? 20000);

    return new Promise<unknown>((resolve, reject) => {
      uni.startBluetoothDevicesDiscovery({
        allowDuplicatesKey: options.allowDuplicatesKey ?? true,
        success: (result) => {
          uni.onBluetoothDeviceFound(handleDeviceFound);
          scanPollTimer = setInterval(() => {
            uni.getBluetoothDevices({
              success: (devicesResult) => mergeScannedDevices(devicesResult.devices),
              fail: () => undefined
            });
          }, 1500);
          resolve(result);
        },
        fail: (error) => {
          state.isScanning.value = false;
          offBluetoothDeviceFound(handleDeviceFound);
          if (scanTimeout) {
            clearTimeout(scanTimeout);
            scanTimeout = null;
          }
          if (scanPollTimer) {
            clearInterval(scanPollTimer);
            scanPollTimer = null;
          }
          reject(error);
        }
      });
    });
  };

  const setMTU = (deviceId: string, mtu = 247) => {
    if (uni.getSystemInfoSync().platform !== 'android') return Promise.resolve(undefined);

    return new Promise<unknown>((resolve) => {
      uni.setBLEMTU({
        deviceId,
        mtu,
        success: resolve,
        fail: (error) => resolve({ ignoredMtuError: error })
      });
    });
  };

  const connectDevice = (deviceId: string, deviceName = '') => {
    return new Promise<RingDeviceInfo>((resolve, reject) => {
      uni.createBLEConnection({
        deviceId,
        timeout: 10000,
        success: () => {
          const delay = /ios/i.test(uni.getSystemInfoSync().system || '') ? 1000 : 1500;
          setTimeout(() => resolve({ deviceId, name: deviceName, protocol: 'legacy' }), delay);
        },
        fail: reject
      });
    });
  };

  const connectAndDiscover = async (deviceId: string, deviceName = '') => {
    await connectDevice(deviceId, deviceName);
    await setMTU(deviceId);
    return discoverServicesAndChars(deviceId, deviceName);
  };

  const enableNotify = (deviceId: string, serviceId: string, characteristicId: string) => {
    return new Promise<unknown>((resolve, reject) => {
      uni.notifyBLECharacteristicValueChange({
        deviceId,
        serviceId,
        characteristicId,
        state: true,
        success: resolve,
        fail: reject
      });
    });
  };

  const cacheServiceId = (mac: string, serviceId: string) => {
    if (!mac || !serviceId) return;

    const cache = uni.getStorageSync(SERVICE_CACHE_KEY) || {};
    cache[mac] = serviceId;
    uni.setStorageSync(SERVICE_CACHE_KEY, cache);
  };

  const getCachedServiceId = (mac: string) => {
    const cache = uni.getStorageSync(SERVICE_CACHE_KEY) || {};
    return cache[mac] || '';
  };

  const discoverServicesAndChars = async (deviceId: string, deviceName = '') => {
    const serviceResult: any = await withTimeout(
      new Promise((resolve, reject) => uni.getBLEDeviceServices({ deviceId, success: resolve, fail: reject })),
      10000,
      'Get BLE services timeout.'
    );

    if (!Array.isArray(serviceResult.services)) {
      throw new Error('BLE services are unavailable.');
    }

    const service = serviceResult.services.find((item: any) => {
      const uuid = `${item.uuid || ''}`.toUpperCase();
      return LEGACY_SERVICE_MARKERS.every((marker) => uuid.includes(marker));
    });

    if (!service?.uuid) {
      throw new Error('Legacy ring service was not found.');
    }

    const serviceId = service.uuid;
    const characteristicResult: any = await new Promise((resolve, reject) => {
      uni.getBLEDeviceCharacteristics({
        deviceId,
        serviceId,
        success: resolve,
        fail: reject
      });
    });

    if (!Array.isArray(characteristicResult.characteristics)) {
      throw new Error('BLE characteristics are unavailable.');
    }

    let cmdCharId = '';
    let dataCharId = '';

    for (const characteristic of characteristicResult.characteristics) {
      if (!cmdCharId && (characteristic.properties?.write || characteristic.properties?.writeWithoutResponse)) {
        cmdCharId = characteristic.uuid;
      }

      if (!dataCharId && characteristic.properties?.notify) {
        dataCharId = characteristic.uuid;
      }

      if (cmdCharId && dataCharId) break;
    }

    if (!cmdCharId) throw new Error('Writable command characteristic was not found.');
    if (!dataCharId) throw new Error('Notify data characteristic was not found.');

    await enableNotify(deviceId, serviceId, dataCharId);

    const deviceInfo = {
      deviceId,
      name: deviceName,
      serviceId,
      cmdCharId,
      dataCharId,
      protocol: 'legacy' as const
    };

    runtime?.onDeviceReady?.(deviceInfo);
    cacheServiceId(deviceId, serviceId);
    setupDataListener(deviceInfo);

    return deviceInfo;
  };

  const checkByRSSI = (deviceId: string) => {
    return new Promise<boolean>((resolve) => {
      uni.getBLEDeviceRSSI({
        deviceId,
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    });
  };

  const isDeviceConnected = (deviceId: string, serviceId: string) => {
    return new Promise<boolean>((resolve) => {
      uni.getConnectedBluetoothDevices({
        services: [serviceId],
        success: (result) => {
          const connected = result.devices.some((device) => device.deviceId === deviceId);
          if (connected) {
            resolve(true);
            return;
          }

          void checkByRSSI(deviceId).then(resolve);
        },
        fail: () => resolve(false)
      });
    });
  };

  const disconnect = (targetDeviceId?: string) => {
    const deviceId = targetDeviceId || runtime?.getDeviceInfo().deviceId;
    clearDataListener();

    if (!deviceId) return Promise.resolve(undefined);

    return new Promise<unknown>((resolve) => {
      uni.closeBLEConnection({
        deviceId,
        success: resolve,
        fail: resolve
      });
    });
  };

  const cleanup = async () => {
    await stopScan();
    clearDataListener();
    uni.offBLEConnectionStateChange();
    (uni.offBluetoothAdapterStateChange as unknown as (() => void) | undefined)?.();
  };

  const sendBytes = (bytes: Uint8Array) => {
    if (!runtime) {
      return Promise.reject(new Error('Legacy ring adapter runtime is not configured.'));
    }

    const { deviceId, serviceId, cmdCharId } = ensureWriteDevice(runtime);

    return new Promise<unknown>((resolve, reject) => {
      uni.writeBLECharacteristicValue({
        deviceId,
        serviceId,
        characteristicId: cmdCharId,
        value: bytes.buffer as any,
        success: resolve,
        fail: (error) => {
          runtime.onDisconnected?.(error);
          reject(error);
        }
      });
    });
  };

  const sendCommand = (cmd: number, subcmd: number, payload?: LegacyCommandPayload) => {
    return sendBytes(buildLegacyCommandBytes(cmd, subcmd, { payload }));
  };

  const sendNamedCommand = (command: LegacyRingCommand, payload?: LegacyCommandPayload) => {
    return sendBytes(buildLegacyCommandByName(command, { payload }));
  };

  const sendReadLocalDataCommand = (sinceTimestamp = 0, readAll = true) => {
    const subcmd = readAll ? 0x01 : 0x00;
    return sendCommand(0x36, subcmd, numberToUint32LE(sinceTimestamp));
  };

  const readLocalData = (options: LegacyReadLocalDataOptions = {}) => {
    const readAll = options.readAll ?? false;
    let sinceTimestamp = options.sinceTimestamp;

    if (sinceTimestamp === undefined) {
      sinceTimestamp = readAll ? 0 : getTodayZeroTimestamp();
    }

    return sendReadLocalDataCommand(sinceTimestamp, readAll);
  };

  const readDeviceTime = () => {
    return sendCommand(0x10, 0x01);
  };

  const updateDeviceTime = async (timestampMs = Date.now(), timezone = 8) => {
    const payload = concatBytes(numberToUint64LE(timestampMs), new Uint8Array([timezone & 0xff]));
    await sendBytes(buildLegacyCommandBytes(0x10, 0x00, { frameType: 0x01, payload }));
    return new Promise<unknown>((resolve) => {
      setTimeout(() => resolve(readDeviceTime()), 500);
    });
  };

  const sendFactoryResetWithTimeCommand = () => {
    const payload = concatBytes(numberToUint64LE(Date.now()), new Uint8Array([0x08, getLegacyPlatformType()]));
    return sendCommand(0xa0, 0x00, payload);
  };

  const waitForParsedData = (predicate: (parsed: RingParsedData) => boolean, timeoutMs = 15000) => {
    const promise = new Promise<RingParsedData>((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = parsedWaiters.indexOf(waiter);
          if (index >= 0) parsedWaiters.splice(index, 1);
          reject(new Error('Timed out waiting for ring data.'));
        }, timeoutMs)
      };

      parsedWaiters.push(waiter);
    });
    promise.catch(() => undefined);
    return promise;
  };

  const setupDataListener = (device?: RingDeviceInfo) => {
    if (!runtime) return;

    const { deviceId, serviceId, dataCharId } = device || runtime.getDeviceInfo();
    if (!deviceId || !serviceId || !dataCharId) return;

    uni.onBLECharacteristicValueChange((result) => {
      if (result.deviceId !== deviceId || result.serviceId !== serviceId || result.characteristicId !== dataCharId) return;

      const parsed = parseLegacyRingData(new Uint8Array(result.value));
      if (parsed) {
        const parsedWithDevice = {
          ...parsed,
          protocol: 'legacy' as const,
          deviceId,
          deviceName: device?.name
        };

        for (const waiter of [...parsedWaiters]) {
          if (!waiter.predicate(parsedWithDevice)) continue;

          clearTimeout(waiter.timer);
          const index = parsedWaiters.indexOf(waiter);
          if (index >= 0) parsedWaiters.splice(index, 1);
          waiter.resolve(parsedWithDevice);
        }
        runtime.onParsedData?.(parsedWithDevice);
      }
    });
  };

  const clearDataListener = () => {
    for (const waiter of parsedWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Ring data listener was cleared.'));
    }
    uni.offBLECharacteristicValueChange();
  };

  return {
    protocol: 'legacy',
    state,
    initBluetooth,
    openBluetoothAdapter,
    registerConnectionStateListener,
    checkBluetoothState,
    startScan,
    stopScan,
    setMTU,
    connectDevice,
    connectAndDiscover,
    discoverServicesAndChars,
    enableNotify,
    checkByRSSI,
    isDeviceConnected,
    cacheServiceId,
    getCachedServiceId,
    disconnect,
    cleanup,
    sendBytes,
    sendCommand,
    sendNamedCommand,
    waitForParsedData,
    setupDataListener,
    clearDataListener,
    sendBatteryCommand: () => sendNamedCommand(LegacyRingCommand.Battery),
    sendActiveMeasureCommand: () => sendNamedCommand(LegacyRingCommand.ActiveMeasure, 0x1e),
    sendOxyGenCommand: () => sendNamedCommand(LegacyRingCommand.BloodOxygen, 0x1e),
    sendBodyTemperatureCommand: () => sendNamedCommand(LegacyRingCommand.BodyTemperature, 0x00),
    sendFirmwareVersion: () => sendNamedCommand(LegacyRingCommand.HardwareVersion),
    sendSoftwareVersion: () => sendNamedCommand(LegacyRingCommand.SoftwareVersion),
    sendReadLocalDataCommand,
    readLocalData,
    readDeviceTime,
    updateDeviceTime,
    sendCollectPeriodSettingCommand: (seconds = 1200) => sendNamedCommand(LegacyRingCommand.SetCollectPeriod, numberToUint32LE(seconds)),
    readCollectPeriodCommand: () => sendNamedCommand(LegacyRingCommand.ReadCollectPeriod),
    sendResetCommand: () => sendNamedCommand(LegacyRingCommand.FactoryReset),
    sendFactoryResetWithTimeCommand,
    sendDeleteAllLocalDataCommand: () => sendNamedCommand(LegacyRingCommand.DeleteAllLocalData)
  };
};
