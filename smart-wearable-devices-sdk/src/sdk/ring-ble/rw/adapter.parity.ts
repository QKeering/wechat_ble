import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRwRingAdapter, getRwScannedDeviceMergeKeys } from './adapter';
import { getLegacyCommandPacket, LegacyRingCommand } from '../legacy/commands';
import { concatBytes, numberToUint32LE, numberToUint64LE } from '../legacy/protocol';

const parityDebug = process.env.RW_ADAPTER_PARITY_DEBUG === '1';
const parityStep = (name: string) => {
  if (parityDebug) console.log(`[rw-adapter.parity] ${name}`);
};

const readProjectSource = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

const extractLegacyAdapterInterfaceKeys = () => {
  const source = readProjectSource('src', 'sdk', 'ring-ble', 'legacy', 'adapter.ts');
  const match = source.match(/export interface LegacyRingAdapter extends RingBleAdapter \{([\s\S]*?)\n\}/);
  if (!match) throw new Error('Unable to find LegacyRingAdapter interface for RW parity verification.');
  return [...match[1].matchAll(/\n\s+([A-Za-z0-9_]+)\??:/g)].map((item) => item[1]);
};

const extractMainAdapterReturnKeys = (source: string, protocol: string) => {
  const returnIndex = source.indexOf(`return {\n    protocol: '${protocol}'`);
  const returnEnd = source.indexOf('\n  };', returnIndex);
  if (returnIndex < 0 || returnEnd < 0) {
    throw new Error(`Unable to find ${protocol} adapter return object for parity verification.`);
  }
  const body = source.slice(returnIndex, returnEnd);
  return [
    ...new Set(
      body
        .split(/\r?\n/)
        .map((line) => line.match(/^ {4}([A-Za-z0-9_]+)\s*(?::|,|$)/)?.[1])
        .filter((key): key is string => Boolean(key))
    )
  ];
};

const legacyAdapterInterfaceKeys = extractLegacyAdapterInterfaceKeys();
const legacyAdapterSource = readProjectSource('src', 'sdk', 'ring-ble', 'legacy', 'adapter.ts');
const rwAdapterSource = readProjectSource('src', 'sdk', 'ring-ble', 'rw', 'adapter.ts');
const rwReadmeSource = readProjectSource('src', 'sdk', 'ring-ble', 'rw', 'README.md');
const rwAdapterReturnKeys = extractMainAdapterReturnKeys(rwAdapterSource, 'rw');
const missingRwAdapterKeys = legacyAdapterInterfaceKeys.filter((key) => !rwAdapterReturnKeys.includes(key));

if (missingRwAdapterKeys.length > 0) {
  throw new Error(`RW adapter should expose every LegacyRingAdapter method used by L19 callers: ${missingRwAdapterKeys.join(', ')}`);
}

if (
  !legacyAdapterSource.includes('export type RwHistoryDataName =') ||
  !legacyAdapterSource.includes('syncHealthDataByType?: (name?: RwHistoryDataName) => Promise<unknown>;') ||
  !rwAdapterSource.includes('const syncHealthDataByType = (_name?: RwHistoryDataName) =>')
) {
  throw new Error('RW history sync should use RwHistoryDataName so old sleep/activity pages can request typed history.');
}

if (
  !rwAdapterSource.includes("rwBleLog('tx'") ||
  !rwAdapterSource.includes('...(label ? { label } : {})') ||
  !rwAdapterSource.includes('`battery/${item.label}`') ||
  !rwAdapterSource.includes('`${normalizedName}/app-sdk-ab-crc-health-read`') ||
  !rwAdapterSource.includes('`${normalizedName}/ab-no-crc-health-read`') ||
  !rwAdapterSource.includes('writeCandidates') ||
  !rwAdapterSource.includes("rwBleLog('discovery-ready'") ||
  !rwAdapterSource.includes("rwBleLog('scan-start'") ||
  !rwAdapterSource.includes("rwBleLog('scan-found'") ||
  !rwAdapterSource.includes('const RW_CREATE_CONNECTION_TIMEOUT_MS = 20000;') ||
  !rwAdapterSource.includes('const RW_CREATE_CONNECTION_RETRY_DELAYS_MS = [0, 900, 1800];') ||
  !rwAdapterSource.includes('const RW_CREATE_CONNECTION_ADAPTER_RESET_DELAY_MS = 1200;') ||
  !rwAdapterSource.includes("rwBleLog('connect-start'") ||
  !rwAdapterSource.includes("rwBleLog('connect-retry-cleanup'") ||
  !rwAdapterSource.includes("rwBleLog('connect-adapter-reset-start'") ||
  !rwAdapterSource.includes("rwBleLog('connect-adapter-reset-done'") ||
  !rwAdapterSource.includes('closeBluetoothAdapterQuietly') ||
  !rwAdapterSource.includes('resetBluetoothAdapterForReconnect') ||
  !rwAdapterSource.includes('isTransientCreateConnectionFailure') ||
  !rwAdapterSource.includes('timeout: RW_CREATE_CONNECTION_TIMEOUT_MS') ||
  !rwAdapterSource.includes("rwBleLog('connect-created'") ||
  !rwAdapterSource.includes("rwBleLog('connect-fail'") ||
  !rwAdapterSource.includes("rwBleLog('connect-discover-fail'") ||
  !rwAdapterSource.includes("rwBleLog('connection-state-ignored'") ||
  !rwAdapterSource.includes('summarizeScanDeviceForRwBleLog') ||
  !rwAdapterSource.includes('selectedWriteCharId') ||
  !rwAdapterSource.includes('selectedNotifyCharId') ||
  !rwAdapterSource.includes('BLE_HEART_RATE_SERVICE_UUID') ||
  !rwAdapterSource.includes('BLE_PULSE_OXIMETER_SERVICE_UUID') ||
  !rwAdapterSource.includes('BLE_DEVICE_INFORMATION_SERVICE_UUID') ||
  !rwAdapterSource.includes('standard-heart-rate-rx') ||
  !rwAdapterSource.includes('standard-pulse-oximeter-rx') ||
  !rwAdapterSource.includes('standard-device-info-rx') ||
  !rwAdapterSource.includes('parseBluetoothSfloat') ||
  !rwAdapterSource.includes('parseCompactPulseOximeterValue') ||
  !rwAdapterSource.includes('findStandardDeviceInformationCharacteristics') ||
  !rwAdapterSource.includes('const RW_DIAGNOSTIC_NOISY_EVENT_THROTTLE_MS = 5000') ||
  !rwAdapterSource.includes('const RW_DIAGNOSTIC_NOISY_EVENTS = new Set') ||
  !rwAdapterSource.includes('resolveRwDiagnosticLogDetails(event, details)') ||
  !rwAdapterSource.includes('suppressedSinceLastLog') ||
  !rwAdapterSource.includes('const RW_RECENT_PARSED_CACHE_TTL_MS = 5000') ||
  !rwAdapterSource.includes('const RW_RECENT_PARSED_CACHE_MAX_COUNT = 40') ||
  !rwAdapterSource.includes("rwBleLog('wait-cache-hit'") ||
  !rwAdapterSource.includes('options?.replayRecent ? takeRecentParsedData(predicate) : null') ||
  !rwAdapterSource.includes('resolveParsedWaiters(parsedVariants)') ||
  !rwAdapterSource.includes('recentParsedData.splice(0)') ||
  !rwAdapterSource.includes("rwBleLog('tx-alt-probe'") ||
  !rwAdapterSource.includes("globalThis.console?.['log']") ||
  !rwAdapterSource.includes('probeAlternateWriteCandidates(primary.bytes, primaryLabel,') ||
  !rwAdapterSource.includes('sendSequentialWithAlternateProbe') ||
  !rwAdapterSource.includes('const RW_ALT_WRITE_PROBE_TIMEOUT_MS = 650') ||
  !rwAdapterSource.includes('const RW_PRIMARY_RESPONSE_TIMEOUT_MS = 2500') ||
  !rwAdapterSource.includes('const getRwQuickResponseTimeoutMs = () => (isNodeRuntime() ? 220 : RW_PRIMARY_RESPONSE_TIMEOUT_MS)') ||
  !rwAdapterSource.includes('const isRwCompatibilityFallbackEnabled = () => true;') ||
  !rwAdapterSource.includes("rwBleLog('battery-primary-timeout'") ||
  !rwAdapterSource.includes("rwBleLog('firmware-primary-timeout'") ||
  !rwAdapterSource.includes('const getSequentialProbeTimeoutMs =') ||
  !rwAdapterSource.includes('if (isNodeRuntime()) return getRwQuickResponseTimeoutMs();') ||
  !rwAdapterSource.includes('getSequentialProbeTimeoutMs(commands.length, delayMs, alternateCandidateCount)') ||
  !rwAdapterSource.includes('let writeQueue: Promise<unknown> = Promise.resolve();') ||
  !rwAdapterSource.includes('const enqueueWrite = <T>(task: () => Promise<T>) =>') ||
  !rwAdapterSource.includes('RW_SERVICE_UUIDS.some((serviceId) => sameUuid(serviceId, candidate.serviceId))') ||
  !rwAdapterSource.includes('battery-fallback-no-rx') ||
  rwAdapterSource.includes("'/l19-primary'") ||
  rwAdapterSource.includes('active_measure/l19-primary') ||
  rwAdapterSource.includes('blood_oxygen/l19-primary') ||
  rwAdapterSource.includes('temperature/l19-primary')
) {
  throw new Error('RW vConsole diagnostics should keep semantic tx labels and serialized writes without L19 realtime probes for SY03 commands.');
}

if (
  !rwAdapterSource.includes('const RW_REALTIME_ALIAS_TTL_MS = 35000') ||
  !rwAdapterSource.includes('const RW_ACTIVE_MEASURE_REALTIME_KEY_MAP: Record<RwActiveMeasureAliasName, RwKey[]>') ||
  !rwAdapterSource.includes('const RW_ACTIVE_MEASURE_CONTROL_KEY_MAP: Record<RwActiveMeasureAliasName, RwHealthDataControlKey>') ||
  !rwAdapterSource.includes('heart_rate: [RwKey.HeartRate, RwKey.AppRealTimeHeartRate]') ||
  !rwAdapterSource.includes('heart_rate: RwHealthDataControlKey.HeartRate') ||
  !rwAdapterSource.includes('hrv: [RwKey.Hrv, RwKey.AppRealTimeHrv]') ||
  !rwAdapterSource.includes('hrv: RwHealthDataControlKey.Hrv') ||
  !rwAdapterSource.includes('stress: [RwKey.Stress, RwKey.AppRealTimeStress]') ||
  !rwAdapterSource.includes('stress: RwHealthDataControlKey.Stress') ||
  !rwAdapterSource.includes('active_OxyGenMeasure: [RwKey.BloodOxygen, RwKey.AppRealTimeBloodOxygen]') ||
  !rwAdapterSource.includes('active_OxyGenMeasure: RwHealthDataControlKey.BloodOxygen') ||
  !rwAdapterSource.includes('active_Temperature: [RwKey.Temperature, RwKey.AppRealTimeTemperature]') ||
  !rwAdapterSource.includes('active_Temperature: RwHealthDataControlKey.Temperature') ||
  !rwAdapterSource.includes('isRwRealtimeMetricKey(parsed, expectedKey)') ||
  !rwAdapterSource.includes('isRwMetricControlFailure(parsed, expectedControlKey)') ||
  !rwAdapterSource.includes("parsed.type !== 'rw_health_data_control_ack' || !isRwMetricFailureStatus(parsed)") ||
  !rwAdapterSource.includes("parsed.name === 'heart_rate' && isRwRealtimeMetricKey(parsed, RW_ACTIVE_MEASURE_REALTIME_KEY_MAP.heart_rate)") ||
  !rwAdapterSource.includes("parsed.name === 'heart_rate' && isRwMetricControlFailure(parsed, RW_ACTIVE_MEASURE_CONTROL_KEY_MAP.heart_rate)") ||
  rwAdapterSource.includes('`${normalizedName}/direct-read`') ||
  rwAdapterSource.includes('RW_REALTIME_FOLLOW_UP_DELAYS_MS') ||
  rwAdapterSource.includes('RW_VARIANT_FOLLOW_UP_DELAYS_MS') ||
  rwAdapterSource.includes('scheduleRwMetricFollowUpReads') ||
  rwAdapterSource.includes('scheduleRwVariantFollowUpReads') ||
  rwAdapterSource.includes('follow-up-direct-read') ||
  rwAdapterSource.includes('app-realtime-read-continue') ||
  rwAdapterSource.includes("'read-rw-health-data'") ||
  rwAdapterSource.includes("'control-rw-health-data'")
) {
  throw new Error('RW reads should remain one-shot and must not create delayed command storms or standard GATT side reads.');
}

if (
  !rwReadmeSource.includes('RW realtime measurement now stays on the RW control plus no-CRC `0x05xx` health-data read path') ||
  !rwReadmeSource.includes('health-data heart-rate read `ab010003050310`') ||
  !rwReadmeSource.includes('health-data blood-oxygen read `ab010003050910`') ||
  !rwReadmeSource.includes('health-data temperature read `ab010003050810`') ||
  !rwReadmeSource.includes('no-CRC `0x050A/0x050D/0x0510/0x0504` health-data read') ||
  rwReadmeSource.includes('first tries the historical L19 `cmd 0x31') ||
  rwReadmeSource.includes('first tries the historical L19 `cmd 0x32') ||
  rwReadmeSource.includes('first tries the historical L19 `cmd 0x34') ||
  rwReadmeSource.includes('control+direct-read pair')
) {
  throw new Error('RW README must document that realtime measurements use no-CRC health-data keys and must not restore L19 realtime probes.');
}

const sy03FirstKeys = getRwScannedDeviceMergeKeys({
  deviceId: 'ios-random-1',
  name: 'SY03',
  protocol: 'rw',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  advertisData: 'D60602008100523E000000051B8043443330336530303031'
});

const sy03SecondKeys = getRwScannedDeviceMergeKeys({
  deviceId: 'ios-random-2',
  localName: 'SY03',
  protocol: 'rw',
  advertisData: 'D60602008100523E000000051B8043443330336530303031'
});

if (!sy03FirstKeys.some((key) => sy03SecondKeys.includes(key))) {
  throw new Error(`RW scan records with changing platform ids should merge by advertis identity: ${JSON.stringify({ sy03FirstKeys, sy03SecondKeys })}`);
}

const bh3Keys = getRwScannedDeviceMergeKeys({
  deviceId: 'bh3',
  name: 'BH3',
  protocol: 'rw',
  advertisData: 'D6060200810052351000001191804344433303353130303030'
});

if (sy03FirstKeys.some((key) => bh3Keys.includes(key))) {
  throw new Error(`Different RW devices should not share scan merge keys: ${JSON.stringify({ sy03FirstKeys, bh3Keys })}`);
}

const rwRandomUniMacKeys = getRwScannedDeviceMergeKeys({
  deviceId: 'ios-random-3',
  uniMacId: '111111ABCDEF',
  name: 'SY03',
  protocol: 'rw'
});

if (rwRandomUniMacKeys.includes('mac:111111ABCDEF')) {
  throw new Error(`RW scan merge keys should not treat random uniMacId values as stable MACs: ${JSON.stringify(rwRandomUniMacKeys)}`);
}

const rwColonUniMacKeys = getRwScannedDeviceMergeKeys({
  deviceId: 'ios-random-4',
  uniMacId: '3E:00:00:00:05:1B',
  name: 'SY03',
  protocol: 'rw'
});

if (!rwColonUniMacKeys.includes('mac:3E:00:00:00:05:1B')) {
  throw new Error(`RW scan merge keys should still keep legacy colon-form MAC values: ${JSON.stringify(rwColonUniMacKeys)}`);
}

const foundCallbacks: Array<(result: { devices: any[] }) => void> = [];
const valueCallbacks: Array<(result: { deviceId: string; serviceId: string; characteristicId: string; value: ArrayBuffer }) => void> = [];
const adapterStateCallbacks: Array<(result: { available: boolean; discovering: boolean }) => void> = [];
const connectionStateCallbacks: Array<(result: { deviceId: string; connected: boolean }) => void> = [];
const discoveryRequests: Array<{ allowDuplicatesKey?: boolean }> = [];
const writtenHex: string[] = [];
const writeRecords: Array<{ deviceId: string; serviceId: string; characteristicId: string; hex: string }> = [];
const mtuRequests: Array<{ deviceId: string; mtu: number }> = [];
const closedDeviceIds: string[] = [];
const notifyRequests: Array<{ deviceId: string; serviceId: string; characteristicId: string; state: boolean }> = [];
const readRequests: Array<{ deviceId: string; serviceId: string; characteristicId: string }> = [];
const readyDevices: any[] = [];
const storage: Record<string, any> = {};
const synchronousWriteResponses: Record<string, string> = {};
let rssiAvailable = true;
let connectedDevices: Array<{ deviceId: string }> = [];
let writeShouldFail = false;
let discoveryShouldFail = false;
let mtuShouldFail = false;
const getConnectionStateCallbackCount = () => connectionStateCallbacks.length;
const getWrittenRwTimeFrames = () => writtenHex.filter((hex) => hex.slice(4, 8) === '1000' || hex.slice(4, 8) === '1001');
(globalThis as any).uni = {
  getSystemInfoSync: () => ({ platform: 'android', system: 'Android 14', uniPlatform: 'mp-weixin' }),
  getStorageSync: (key: string) => storage[key],
  setStorageSync: (key: string, value: unknown) => {
    storage[key] = value;
  },
  openBluetoothAdapter: ({ success }: { success: (result: unknown) => void }) => success({}),
  closeBluetoothAdapter: ({ success }: { success: (result: unknown) => void; fail: (error: unknown) => void }) => success({}),
  offBLEConnectionStateChange: () => {
    connectionStateCallbacks.length = 0;
  },
  onBLEConnectionStateChange: (callback: (result: { deviceId: string; connected: boolean }) => void) => {
    connectionStateCallbacks.push(callback);
  },
  offBluetoothAdapterStateChange: () => {
    adapterStateCallbacks.length = 0;
  },
  onBluetoothAdapterStateChange: (callback: (result: { available: boolean; discovering: boolean }) => void) => {
    adapterStateCallbacks.push(callback);
  },
  offBluetoothDeviceFound: () => {
    foundCallbacks.length = 0;
  },
  onBluetoothDeviceFound: (callback: (result: { devices: any[] }) => void) => {
    foundCallbacks.push(callback);
  },
  onBLECharacteristicValueChange: (callback: (result: { deviceId: string; serviceId: string; characteristicId: string; value: ArrayBuffer }) => void) => {
    valueCallbacks.push(callback);
  },
  offBLECharacteristicValueChange: () => {
    valueCallbacks.length = 0;
  },
  startBluetoothDevicesDiscovery: ({
    allowDuplicatesKey,
    success,
    fail
  }: {
    allowDuplicatesKey?: boolean;
    success: (result: unknown) => void;
    fail: (error: unknown) => void;
  }) => {
    discoveryRequests.push({ allowDuplicatesKey });
    if (discoveryShouldFail) {
      fail(new Error('discovery failed'));
      return;
    }
    success({});
  },
  stopBluetoothDevicesDiscovery: ({ success }: { success: (result: unknown) => void }) => success({}),
  getBluetoothDevices: ({ success }: { success: (result: { devices: any[] }) => void; fail: (error: unknown) => void }) =>
    success({
      devices: [
        {
          deviceId: 'rw-polled-device',
          name: 'SY03',
          RSSI: -66,
          advertisData: 'D60602008100523E000000052A8043443330336530303031',
          advertisServiceUUIDs: ['0000180D-0000-1000-8000-00805F9B34FB']
        }
      ]
    }),
  createBLEConnection: ({ success }: { deviceId: string; timeout: number; success: (result: unknown) => void; fail: (error: unknown) => void }) =>
    success({}),
  getBLEDeviceServices: ({ deviceId, success }: { deviceId: string; success: (result: unknown) => void; fail: (error: unknown) => void }) =>
    success({
      services:
        deviceId === 'rw-standard-battery'
          ? [
              { uuid: '0000A00A-0000-1000-8000-00805F9B34FB' },
              { uuid: '0000180F-0000-1000-8000-00805F9B34FB' }
            ]
          : deviceId === 'rw-standard-vitals'
            ? [
                { uuid: '0000A00A-0000-1000-8000-00805F9B34FB' },
                { uuid: '0000180A-0000-1000-8000-00805F9B34FB' },
                { uuid: '0000180D-0000-1000-8000-00805F9B34FB' },
                { uuid: '00001822-0000-1000-8000-00805F9B34FB' }
              ]
          : deviceId === 'rw-multi-service' || deviceId === 'rw-failing-first-service'
            ? [
                { uuid: '0000B00B-0000-1000-8000-00805F9B34FB' },
                { uuid: '0000A00A-0000-1000-8000-00805F9B34FB' }
              ]
            : [{ uuid: '0000A00A-0000-1000-8000-00805F9B34FB' }]
    }),
  getBLEDeviceCharacteristics: ({
    deviceId,
    serviceId,
    success,
    fail
  }: {
    deviceId: string;
    serviceId: string;
    success: (result: unknown) => void;
    fail: (error: unknown) => void;
  }) => {
    if (deviceId === 'rw-failing-first-service' && serviceId === '0000B00B-0000-1000-8000-00805F9B34FB') {
      fail(new Error('characteristics unavailable'));
      return;
    }

    if (deviceId === 'rw-standard-battery' && serviceId === '0000180F-0000-1000-8000-00805F9B34FB') {
      success({
        characteristics: [
          {
            uuid: '00002A19-0000-1000-8000-00805F9B34FB',
            properties: { read: true }
          }
        ],
        serviceId
      });
      return;
    }

    if (deviceId === 'rw-standard-vitals' && serviceId === '0000180D-0000-1000-8000-00805F9B34FB') {
      success({
        characteristics: [
          {
            uuid: '00002A37-0000-1000-8000-00805F9B34FB',
            properties: { notify: true, read: true }
          }
        ],
        serviceId
      });
      return;
    }

    if (deviceId === 'rw-standard-vitals' && serviceId === '0000180A-0000-1000-8000-00805F9B34FB') {
      success({
        characteristics: [
          {
            uuid: '00002A26-0000-1000-8000-00805F9B34FB',
            properties: { read: true }
          },
          {
            uuid: '00002A27-0000-1000-8000-00805F9B34FB',
            properties: { read: true }
          },
          {
            uuid: '00002A28-0000-1000-8000-00805F9B34FB',
            properties: { read: true }
          }
        ],
        serviceId
      });
      return;
    }

    if (deviceId === 'rw-standard-vitals' && serviceId === '00001822-0000-1000-8000-00805F9B34FB') {
      success({
        characteristics: [
          {
            uuid: '00002A5F-0000-1000-8000-00805F9B34FB',
            properties: { notify: true, read: true }
          }
        ],
        serviceId
      });
      return;
    }

    if (deviceId === 'rw-multi-service' && serviceId === '0000B00B-0000-1000-8000-00805F9B34FB') {
      success({
        characteristics: [
          {
            uuid: '0000B002-0000-1000-8000-00805F9B34FB',
            properties: { write: true, writeNoResponse: true }
          },
          {
            uuid: '0000C999-0000-1000-8000-00805F9B34FB',
            properties: { notify: true }
          }
        ],
        serviceId
      });
      return;
    }

    if (deviceId === 'rw-multi-service' && serviceId === '0000A00A-0000-1000-8000-00805F9B34FB') {
      success({
        characteristics: [
          {
            uuid: '0000B003-0000-1000-8000-00805F9B34FB',
            properties: { notify: true }
          }
        ],
        serviceId
      });
      return;
    }

    if (deviceId === 'rw-alt-write-probe' || deviceId === 'rw-alt-fallback-write-probe') {
      success({
        characteristics: [
          {
            uuid: '0000C001-0000-1000-8000-00805F9B34FB',
            properties: { write: true, writeNoResponse: true }
          },
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
      });
      return;
    }

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
    });
  },
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
    fail: (error: unknown) => void;
  }) => {
    notifyRequests.push({ deviceId, serviceId, characteristicId, state });
    success({});
  },
  setBLEMTU: ({
    deviceId,
    mtu,
    success,
    fail
  }: {
    deviceId: string;
    mtu: number;
    success: (result: unknown) => void;
    fail: (error: unknown) => void;
  }) => {
    mtuRequests.push({ deviceId, mtu });
    if (mtuShouldFail) {
      fail({ errMsg: 'setBLEMTU:fail:internal' });
      return;
    }
    success({});
  },
  getBLEDeviceRSSI: ({ success, fail }: { success: (result: unknown) => void; fail: (error: unknown) => void }) => {
    if (rssiAvailable) {
      success({});
      return;
    }
    fail({});
  },
  getConnectedBluetoothDevices: ({
    success
  }: {
    services: string[];
    success: (result: { devices: Array<{ deviceId: string }> }) => void;
    fail: (error: unknown) => void;
  }) => success({ devices: connectedDevices }),
  closeBLEConnection: ({ deviceId, success }: { deviceId: string; success: (result: unknown) => void; fail: (error: unknown) => void }) => {
    closedDeviceIds.push(deviceId);
    success({});
  },
  writeBLECharacteristicValue: ({
    deviceId,
    serviceId,
    characteristicId,
    value,
    success,
    fail
  }: {
    deviceId: string;
    serviceId: string;
    characteristicId: string;
    value: ArrayBuffer;
    success: (result: unknown) => void;
    fail: (error: unknown) => void;
  }) => {
    const hex = Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
    writtenHex.push(hex);
    writeRecords.push({ deviceId, serviceId, characteristicId, hex });
    if (writeShouldFail) {
      fail(new Error('write failed'));
      return;
    }
    if (deviceId === 'rw-alt-write-probe' && characteristicId === '0000C001-0000-1000-8000-00805F9B34FB' && hex.slice(4, 8) === '1200') {
      valueCallbacks[valueCallbacks.length - 1]?.({
        deviceId,
        serviceId,
        characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
        value: hexToBytes('001112004e00').buffer
      });
    }
    if (deviceId === 'rw-alt-fallback-write-probe' && characteristicId === '0000C001-0000-1000-8000-00805F9B34FB' && hex.includes('020310')) {
      valueCallbacks[valueCallbacks.length - 1]?.({
        deviceId,
        serviceId,
        characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
        value: hexToBytes('c6110005aaaa0203104200').buffer
      });
    }
    const synchronousResponse =
      synchronousWriteResponses[hex] ||
      (hex.slice(4, 8) === '1200' && synchronousWriteResponses['legacy-l19-battery']) ||
      (hex.slice(4, 8) === '1101' && synchronousWriteResponses['legacy-l19-hardware']) ||
      (hex.slice(4, 8) === '1100' && synchronousWriteResponses['legacy-l19-software']) ||
      (hex.slice(4, 8) === '3100' && synchronousWriteResponses['legacy-l19-active-measure']) ||
      (hex.slice(4, 8) === '3200' && synchronousWriteResponses['legacy-l19-oxygen']) ||
      (hex.slice(4, 8) === '3400' && synchronousWriteResponses['legacy-l19-temperature']) ||
      (hex.slice(4, 8) === '3701' && synchronousWriteResponses['legacy-l19-collect-read']) ||
      (hex.slice(4, 8) === '3700' && synchronousWriteResponses['legacy-l19-collect-set']) ||
      (hex.slice(4, 8) === '3603' && synchronousWriteResponses['legacy-l19-delete-local']);
    if (synchronousResponse) {
      valueCallbacks[valueCallbacks.length - 1]?.({
        deviceId,
        serviceId,
        characteristicId: characteristicId.replace(/B002/i, 'B003'),
        value: hexToBytes(synchronousResponse).buffer
      });
    }
    success({});
  },
  readBLECharacteristicValue: ({
    deviceId,
    serviceId,
    characteristicId,
    success
  }: {
    deviceId: string;
    serviceId: string;
    characteristicId: string;
    success: (result: unknown) => void;
    fail: (error: unknown) => void;
  }) => {
    readRequests.push({ deviceId, serviceId, characteristicId });
    if (deviceId === 'rw-standard-battery' && characteristicId === '00002A19-0000-1000-8000-00805F9B34FB') {
      valueCallbacks[valueCallbacks.length - 1]?.({
        deviceId,
        serviceId,
        characteristicId,
        value: new Uint8Array([78]).buffer
      });
    }
    if (deviceId === 'rw-standard-vitals' && characteristicId === '00002A37-0000-1000-8000-00805F9B34FB') {
      valueCallbacks[valueCallbacks.length - 1]?.({
        deviceId,
        serviceId,
        characteristicId,
        value: new Uint8Array([0x00, 72]).buffer
      });
    }
    if (deviceId === 'rw-standard-vitals' && characteristicId === '00002A26-0000-1000-8000-00805F9B34FB') {
      valueCallbacks[valueCallbacks.length - 1]?.({
        deviceId,
        serviceId,
        characteristicId,
        value: new Uint8Array([70, 87, 45, 49, 46, 50, 46, 51]).buffer
      });
    }
    if (deviceId === 'rw-standard-vitals' && characteristicId === '00002A27-0000-1000-8000-00805F9B34FB') {
      valueCallbacks[valueCallbacks.length - 1]?.({
        deviceId,
        serviceId,
        characteristicId,
        value: new Uint8Array([72, 87, 45, 57, 46, 56]).buffer
      });
    }
    if (deviceId === 'rw-standard-vitals' && characteristicId === '00002A28-0000-1000-8000-00805F9B34FB') {
      valueCallbacks[valueCallbacks.length - 1]?.({
        deviceId,
        serviceId,
        characteristicId,
        value: new Uint8Array([83, 87, 45, 52, 46, 53]).buffer
      });
    }
    if (deviceId === 'rw-standard-vitals' && characteristicId === '00002A5F-0000-1000-8000-00805F9B34FB') {
      valueCallbacks[valueCallbacks.length - 1]?.({
        deviceId,
        serviceId,
        characteristicId,
        value: new Uint8Array([0x00, 98, 0x00, 72, 0x00]).buffer
      });
    }
    success({});
  }
};

const state = {
  devices: { value: [] as any[] },
  isScanning: { value: false }
};
const adapter = createRwRingAdapter(state as any);
await adapter.startScan({ includeUnknown: true, preserveDevices: true, allowDuplicatesKey: true, timeoutMs: 1000 });

foundCallbacks[0]?.({
  devices: [
    {
      deviceId: 'ios-random-1',
      uniMacId: 'ios-random-metadata-id-1',
      name: 'SY03',
      RSSI: -80,
      advertisData: 'D60602008100523E000000051B8043443330336530303031',
      advertisServiceUUIDs: ['0000180D-0000-1000-8000-00805F9B34FB']
    },
    {
      deviceId: 'l19-nearby',
      name: 'QKeeRingL19',
      RSSI: -57,
      advertisServiceUUIDs: ['0000BAE8-0000-1000-8000-00805F9B34FB']
    },
    {
      deviceId: 'qkeer-v2-nearby',
      name: 'MUSLEEP_RING_01',
      RSSI: -58,
      advertisServiceUUIDs: ['0000F618-0000-1000-8000-00805F9B34FB']
    },
    {
      deviceId: 'formal-bh3',
      name: 'BH3',
      RSSI: -40,
      advertisData: 'D6060200810052351000001191804344433303353130303030',
      advertisServiceUUIDs: ['0000180D-0000-1000-8000-00805F9B34FB']
    }
  ]
});
const firstSeenAt = state.devices.value[0]?.lastSeenAt || 0;
await new Promise((resolve) => setTimeout(resolve, 2));
foundCallbacks[0]?.({
  devices: [
    {
      deviceId: 'ios-random-2',
      uniMacId: 'ios-random-metadata-id-2',
      localName: 'SY03',
      RSSI: -61,
      advertisData: 'D60602008100523E000000051B8043443330336530303031',
      advertisServiceUUIDs: ['0000180D-0000-1000-8000-00805F9B34FB']
    }
  ]
});
await adapter.stopScan();

if (
  state.devices.value.length !== 4 ||
  !state.devices.value.some(
    (device) =>
      device.deviceId === 'ios-random-2' &&
      device.protocol === 'rw' &&
      device.RSSI === -61 &&
      device.mac === '3E:00:00:00:05:1B' &&
      device.uniMacId === '3E:00:00:00:05:1B' &&
      device.advertis?.macInfo === '3E:00:00:00:05:1B'
  ) ||
  !state.devices.value.some((device) => device.deviceId === 'l19-nearby' && device.protocol === 'legacy') ||
  !state.devices.value.some((device) => device.deviceId === 'qkeer-v2-nearby' && device.protocol === 'qkeer-v2') ||
  !state.devices.value.some((device) => device.deviceId === 'formal-bh3' && device.protocol === 'rw' && device.mac === '35:10:00:00:11:91') ||
  typeof state.devices.value.find((device) => device.protocol === 'rw')?.lastSeenAt !== 'number' ||
  Number(state.devices.value.find((device) => device.protocol === 'rw')?.lastSeenAt || 0) <= firstSeenAt
) {
  throw new Error(`RW scan should refresh SY03 while keeping nearby L19/QKeer/BH3 business candidates: ${JSON.stringify(state.devices.value)}`);
}
state.devices.value[0].uniMacId = 'ios-random-metadata-id';

const arrayAdvertisState = {
  devices: { value: [] as any[] },
  isScanning: { value: false }
};
const arrayAdvertisAdapter = createRwRingAdapter(arrayAdvertisState as any);
await arrayAdvertisAdapter.startScan({ preserveDevices: true, allowDuplicatesKey: true, timeoutMs: 1000 });
foundCallbacks[foundCallbacks.length - 1]?.({
  devices: [
    {
      deviceId: 'rw-array-advertis',
      RSSI: -70,
      advertisData: [0xf8, 0x11, 0x00, 0x21, 0x05, 0xb0]
    }
  ]
});
await arrayAdvertisAdapter.stopScan();
if (arrayAdvertisState.devices.value.length !== 1 || arrayAdvertisState.devices.value[0].protocol !== 'rw') {
  throw new Error(`RW scan should accept array-form manufacturer advertis data: ${JSON.stringify(arrayAdvertisState.devices.value)}`);
}

const advertisOnlyScanState = {
  devices: { value: [] as any[] },
  isScanning: { value: false }
};
const advertisOnlyScanAdapter = createRwRingAdapter(advertisOnlyScanState as any);
await advertisOnlyScanAdapter.startScan({ preserveDevices: true, allowDuplicatesKey: true, timeoutMs: 1000 });
foundCallbacks[foundCallbacks.length - 1]?.({
  devices: [
    {
      deviceId: 'rw-advertis-only',
      RSSI: -73,
      advertisData: 'D60602008100523E000000052C8043443330336530303031'
    }
  ]
});
await advertisOnlyScanAdapter.stopScan();
if (
  advertisOnlyScanState.devices.value.length !== 1 ||
  advertisOnlyScanState.devices.value[0].protocol !== 'rw' ||
  advertisOnlyScanState.devices.value[0].mac !== '3E:00:00:00:05:2C' ||
  advertisOnlyScanState.devices.value[0].advertis?.macInfo !== '3E:00:00:00:05:2C'
) {
  throw new Error(`RW scan should accept advertis-only SY03 packets without relying on name/service metadata: ${JSON.stringify(advertisOnlyScanState.devices.value)}`);
}

const polledScanState = {
  devices: { value: [] as any[] },
  isScanning: { value: false }
};
const polledScanAdapter = createRwRingAdapter(polledScanState as any);
discoveryRequests.length = 0;
await polledScanAdapter.startScan({ preserveDevices: true, timeoutMs: 5000 });
await new Promise((resolve) => setTimeout(resolve, 1550));
await polledScanAdapter.stopScan();

if (
  discoveryRequests[0]?.allowDuplicatesKey !== true ||
  polledScanState.devices.value.length !== 1 ||
  polledScanState.devices.value[0].deviceId !== 'rw-polled-device' ||
  polledScanState.devices.value[0].mac !== '3E:00:00:00:05:2A'
) {
  throw new Error(
    `RW scan should mirror L19 by enabling duplicates and polling getBluetoothDevices: ${JSON.stringify({
      discoveryRequests,
      polledDevices: polledScanState.devices.value
    })}`
  );
}

const failedScanState = {
  devices: { value: [] as any[] },
  isScanning: { value: false }
};
const failedScanAdapter = createRwRingAdapter(failedScanState as any);
let scanFailureError: unknown;
discoveryShouldFail = true;
try {
  await failedScanAdapter.startScan({ preserveDevices: true, timeoutMs: 5000 });
} catch (error) {
  scanFailureError = error;
} finally {
  discoveryShouldFail = false;
}
foundCallbacks.forEach((callback) =>
  callback({
    devices: [
      {
        deviceId: 'rw-after-failed-scan',
        name: 'SY03',
        advertisData: 'D60602008100523E000000052B8043443330336530303031',
        advertisServiceUUIDs: ['0000180D-0000-1000-8000-00805F9B34FB']
      }
    ]
  })
);

if (
  !(scanFailureError instanceof Error) ||
  failedScanState.isScanning.value !== false ||
  foundCallbacks.length !== 0 ||
  failedScanState.devices.value.length !== 0
) {
  throw new Error(
    `RW scan should clean discovery callbacks on discovery start failure like L19: ${JSON.stringify({
      scanFailureError,
      isScanning: failedScanState.isScanning.value,
      callbackCount: foundCallbacks.length,
      devices: failedScanState.devices.value
    })}`
  );
}

const connectedWithSource = await createRwRingAdapter(state as any, {
  getDeviceInfo: () => readyDevices[readyDevices.length - 1] || {},
  onDeviceReady: (device: any) => {
    readyDevices.push(device);
  }
} as any).connectAndDiscover('ios-random-2', 'SY03', state.devices.value[0]);

if (
  connectedWithSource.mac !== '3E:00:00:00:05:1B' ||
  connectedWithSource.uniMacId !== '3E:00:00:00:05:1B' ||
  connectedWithSource.advertis?.macInfo !== '3E:00:00:00:05:1B' ||
  connectedWithSource.serviceId !== '0000A00A-0000-1000-8000-00805F9B34FB' ||
  connectedWithSource.dataCharId !== '0000B003-0000-1000-8000-00805F9B34FB' ||
  !mtuRequests.some((request) => request.deviceId === 'ios-random-2' && request.mtu === 247) ||
  !notifyRequests.some((request) => request.state === true && request.characteristicId === '0000B003-0000-1000-8000-00805F9B34FB') ||
  storage.deviceServiceCache?.['3E:00:00:00:05:1B'] !== '0000A00A-0000-1000-8000-00805F9B34FB'
) {
  throw new Error(
    `RW connectAndDiscover should preserve scan source identity and cache services by stable MAC: ${JSON.stringify({
      connectedWithSource,
      notifyRequests,
      mtuRequests,
      storage,
      readyDevices
    })}`
  );
}

const connectedWithRandomOnlySource = await createRwRingAdapter(state as any, {
  getDeviceInfo: () => readyDevices[readyDevices.length - 1] || {},
  onDeviceReady: (device: any) => {
    readyDevices.push(device);
  }
} as any).connectAndDiscover('rw-random-only-platform-id', 'SY03', {
  deviceId: 'rw-random-only-platform-id',
  name: 'SY03',
  protocol: 'rw',
  uniMacId: '111111ABCDEF'
} as any);

if (
  connectedWithRandomOnlySource.mac === '111111ABCDEF' ||
  connectedWithRandomOnlySource.uniMacId === '111111ABCDEF' ||
  readyDevices[readyDevices.length - 1]?.mac === '111111ABCDEF' ||
  readyDevices[readyDevices.length - 1]?.uniMacId === '111111ABCDEF' ||
  storage.deviceServiceCache?.['111111ABCDEF']
) {
  throw new Error(
    `RW adapter should not promote random source uniMacId metadata into ready identity or service cache: ${JSON.stringify({
      connectedWithRandomOnlySource,
      readyDevice: readyDevices[readyDevices.length - 1],
      storage
    })}`
  );
}

mtuShouldFail = true;
mtuRequests.length = 0;
notifyRequests.length = 0;
const connectedWithMtuFailure = await createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({}),
  onDeviceReady: () => undefined
} as any).connectAndDiscover('ios-random-2', 'SY03', state.devices.value[0]);
mtuShouldFail = false;

if (
  connectedWithMtuFailure.serviceId !== '0000A00A-0000-1000-8000-00805F9B34FB' ||
  connectedWithMtuFailure.dataCharId !== '0000B003-0000-1000-8000-00805F9B34FB' ||
  !mtuRequests.some((request) => request.deviceId === 'ios-random-2' && request.mtu === 247) ||
  !notifyRequests.some((request) => request.state === true && request.characteristicId === '0000B003-0000-1000-8000-00805F9B34FB')
) {
  throw new Error(
    `RW connectAndDiscover should continue when Android setBLEMTU fails internally: ${JSON.stringify({
      connectedWithMtuFailure,
      notifyRequests,
      mtuRequests
    })}`
  );
}

notifyRequests.length = 0;
const multiServiceDevice = await createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({}),
  onDeviceReady: () => undefined
} as any).connectAndDiscover('rw-multi-service', 'SY03');
await new Promise((resolve) => setTimeout(resolve, 700));

const multiServiceNotifyEnabledRequests = notifyRequests.filter((request) => request.state);
if (
  multiServiceDevice.serviceId !== '0000B00B-0000-1000-8000-00805F9B34FB' ||
  multiServiceDevice.cmdCharId !== '0000B002-0000-1000-8000-00805F9B34FB' ||
  multiServiceDevice.dataServiceId !== '0000A00A-0000-1000-8000-00805F9B34FB' ||
  multiServiceDevice.dataCharId !== '0000B003-0000-1000-8000-00805F9B34FB' ||
    !Array.isArray(multiServiceDevice.notifyCandidates) ||
    multiServiceDevice.notifyCandidates.length < 2 ||
    !Array.isArray(multiServiceDevice.writeCandidates) ||
    multiServiceDevice.writeCandidates.length < 1 ||
  !multiServiceNotifyEnabledRequests.some(
    (request) =>
        request.serviceId === '0000A00A-0000-1000-8000-00805F9B34FB' &&
        request.characteristicId === '0000B003-0000-1000-8000-00805F9B34FB'
    )
  ) {
    throw new Error(
      `RW connect should discover alternate notify channels but become ready after the primary protocol notify channel is enabled: ${JSON.stringify({
        multiServiceDevice,
        notifyRequests
      })}`
  );
}

writeRecords.length = 0;
const altWriteEvents: any[] = [];
const altWriteAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-alt-write-probe',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
    writeCandidates: [
      {
        serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
        characteristicId: '0000B002-0000-1000-8000-00805F9B34FB'
      },
      {
        serviceId: '00001812-0000-1000-8000-00805F9B34FB',
        characteristicId: '00002A4E-0000-1000-8000-00805F9B34FB'
      },
      {
        serviceId: '0000FF00-0000-1000-8000-00805F9B34FB',
        characteristicId: '0000FF01-0000-1000-8000-00805F9B34FB'
      },
      {
        serviceId: '00000BC0-0000-1000-8000-00805F9B34FB',
        characteristicId: '00000BC1-0000-1000-8000-00805F9B34FB'
      },
      {
        serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
        characteristicId: '0000C001-0000-1000-8000-00805F9B34FB'
      }
    ]
  }),
  onParsedData: (parsed: any) => altWriteEvents.push(parsed)
} as any);
altWriteAdapter.setupDataListener();
await altWriteAdapter.sendBatteryCommand();

const altWriteProbeRecords = writeRecords.filter((record) => record.deviceId === 'rw-alt-write-probe');
if (
  !altWriteProbeRecords.some(
    (record) =>
      record.characteristicId === '0000B002-0000-1000-8000-00805F9B34FB' &&
      record.hex === 'ab010003020310'
  ) ||
  !altWriteProbeRecords.some(
    (record) =>
      record.characteristicId === '0000C001-0000-1000-8000-00805F9B34FB' &&
      record.hex.slice(4, 8) === '1200'
  ) ||
  !altWriteEvents.some((event) => event.type === 'battery' && event.battery === 78)
) {
  throw new Error(
    `RW battery reads should probe fallback commands and write candidates when the preferred SY03 command produces no parsed response: ${JSON.stringify({
      writeRecords,
      altWriteEvents
    })}`
  );
}

writeRecords.length = 0;
const noFallbackWriteEvents: any[] = [];
const noFallbackWriteAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-alt-fallback-write-probe',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
    writeCandidates: [
      {
        serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
        characteristicId: '0000B002-0000-1000-8000-00805F9B34FB'
      },
      {
        serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
        characteristicId: '0000C001-0000-1000-8000-00805F9B34FB'
      }
    ]
  }),
  onParsedData: (parsed: any) => noFallbackWriteEvents.push(parsed)
} as any);
noFallbackWriteAdapter.setupDataListener();
await noFallbackWriteAdapter.sendBatteryCommand();

const noFallbackWrites = writeRecords.filter((record) => record.deviceId === 'rw-alt-fallback-write-probe');
if (
  !noFallbackWrites.some((record) => record.hex === 'ab010003020310') ||
  !noFallbackWrites.some(
    (record) =>
      record.characteristicId === '0000C001-0000-1000-8000-00805F9B34FB' &&
      record.hex.includes('020310')
  ) ||
  !noFallbackWriteEvents.some((event) => event.type === 'battery' && event.battery === 66)
) {
  throw new Error(
    `RW battery default path should use fallback packets and alternate write probes without requiring explicit debug mode: ${JSON.stringify({
      writeRecords,
      noFallbackWriteEvents
    })}`
  );
}

const altNotifyEvents: any[] = [];
const altNotifyAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-alt-notify-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => altNotifyEvents.push(parsed)
} as any);
altNotifyAdapter.setupDataListener();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-alt-notify-device',
  serviceId: '0000B00B-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000C999-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('c6110005aaaa0203104e00').buffer
});

const altNotifyBatteryEvent = altNotifyEvents.find((event) => event.type === 'battery' && event.battery === 78);
if (!altNotifyBatteryEvent) {
  throw new Error(
    `RW listener should accept parsed packets from alternate notify channels on the same device: ${JSON.stringify(altNotifyEvents)}`
  );
}
if (
  altNotifyBatteryEvent.serviceId !== '0000B00B-0000-1000-8000-00805F9B34FB' ||
  altNotifyBatteryEvent.characteristicId !== '0000C999-0000-1000-8000-00805F9B34FB' ||
  !Number.isFinite(altNotifyBatteryEvent.receivedAt) ||
  altNotifyBatteryEvent.parsedAt !== altNotifyBatteryEvent.receivedAt
) {
  throw new Error(
    `RW parsed packets should carry receive timing and source channel metadata for business freshness checks: ${JSON.stringify(altNotifyBatteryEvent)}`
  );
}

const recentReplayEvents: any[] = [];
const recentReplayAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-recent-replay-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => recentReplayEvents.push(parsed)
} as any);
recentReplayAdapter.setupDataListener();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-recent-replay-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab11000943e5022400033328cc4600').buffer
});
const replayedRecentHeartRate = await recentReplayAdapter.waitForParsedData(
  (item: any) => item.type === 'rw_health_data' && item.name === 'heart_rate' && item.key === 0x0224,
  50,
  { replayRecent: true }
);

if (
  replayedRecentHeartRate.value !== 70 ||
  !recentReplayEvents.some((event) => event.type === 'rw_health_data' && event.name === 'heart_rate' && event.value === 70)
) {
  throw new Error(
    `RW waitForParsedData should replay a just-parsed realtime packet so foreground pages do not miss fast SY03 replies: ${JSON.stringify({
      replayedRecentHeartRate,
      recentReplayEvents
    })}`
  );
}

notifyRequests.length = 0;
const fallbackServiceDevice = await createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({}),
  onDeviceReady: () => undefined
} as any).connectAndDiscover('rw-failing-first-service', 'SY03');

const fallbackServiceNotifyRequest = notifyRequests[notifyRequests.length - 1];
if (
  fallbackServiceDevice.serviceId !== '0000A00A-0000-1000-8000-00805F9B34FB' ||
  fallbackServiceDevice.cmdCharId !== '0000B002-0000-1000-8000-00805F9B34FB' ||
  fallbackServiceDevice.dataCharId !== '0000B003-0000-1000-8000-00805F9B34FB' ||
  fallbackServiceNotifyRequest?.serviceId !== '0000A00A-0000-1000-8000-00805F9B34FB' ||
  fallbackServiceNotifyRequest?.characteristicId !== '0000B003-0000-1000-8000-00805F9B34FB'
) {
  throw new Error(
    `RW connect should continue service discovery after one characteristic read fails: ${JSON.stringify({
      fallbackServiceDevice,
      notifyRequests
    })}`
  );
}

readRequests.length = 0;
const connectStandardBatteryEvents: any[] = [];
await createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({}),
  onParsedData: (parsed: any) => connectStandardBatteryEvents.push(parsed)
} as any).connectAndDiscover('rw-standard-battery', 'SY03');
await new Promise((resolve) => setTimeout(resolve, 20));

if (
  !readRequests.some(
    (request) =>
      request.deviceId === 'rw-standard-battery' &&
      request.serviceId === '0000180F-0000-1000-8000-00805F9B34FB' &&
      request.characteristicId === '00002A19-0000-1000-8000-00805F9B34FB'
  ) ||
  !connectStandardBatteryEvents.some(
    (event) => event.type === 'battery' && event.source === 'standard_ble_battery_service' && event.battery === 78
  )
) {
  throw new Error(
    `RW connect should read standard BLE battery immediately after notify is ready: ${JSON.stringify({
      readRequests,
      connectStandardBatteryEvents
    })}`
  );
}

readRequests.length = 0;
notifyRequests.length = 0;
const connectStandardVitalEvents: any[] = [];
const standardVitalsDevice = await createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({}),
  onParsedData: (parsed: any) => connectStandardVitalEvents.push(parsed)
} as any).connectAndDiscover('rw-standard-vitals', 'SY03');
await new Promise((resolve) => setTimeout(resolve, 700));

if (
  standardVitalsDevice.standardHeartRateCharId !== '00002A37-0000-1000-8000-00805F9B34FB' ||
  standardVitalsDevice.standardPulseOximeterCharId !== '00002A5F-0000-1000-8000-00805F9B34FB' ||
  standardVitalsDevice.standardFirmwareCharId !== '00002A26-0000-1000-8000-00805F9B34FB' ||
  standardVitalsDevice.standardHardwareCharId !== '00002A27-0000-1000-8000-00805F9B34FB' ||
  standardVitalsDevice.standardSoftwareCharId !== '00002A28-0000-1000-8000-00805F9B34FB' ||
  !notifyRequests.some(
    (request) =>
      request.deviceId === 'rw-standard-vitals' &&
      request.serviceId === '0000180D-0000-1000-8000-00805F9B34FB' &&
      request.characteristicId === '00002A37-0000-1000-8000-00805F9B34FB' &&
      request.state === true
  ) ||
  !notifyRequests.some(
    (request) =>
      request.deviceId === 'rw-standard-vitals' &&
      request.serviceId === '00001822-0000-1000-8000-00805F9B34FB' &&
      request.characteristicId === '00002A5F-0000-1000-8000-00805F9B34FB' &&
      request.state === true
  ) ||
  !readRequests.some(
    (request) =>
      request.deviceId === 'rw-standard-vitals' &&
      request.serviceId === '0000180D-0000-1000-8000-00805F9B34FB' &&
      request.characteristicId === '00002A37-0000-1000-8000-00805F9B34FB'
  ) ||
  !readRequests.some(
    (request) =>
      request.deviceId === 'rw-standard-vitals' &&
      request.serviceId === '00001822-0000-1000-8000-00805F9B34FB' &&
      request.characteristicId === '00002A5F-0000-1000-8000-00805F9B34FB'
  ) ||
  !readRequests.some(
    (request) =>
      request.deviceId === 'rw-standard-vitals' &&
      request.serviceId === '0000180A-0000-1000-8000-00805F9B34FB' &&
      request.characteristicId === '00002A26-0000-1000-8000-00805F9B34FB'
  ) ||
  !readRequests.some(
    (request) =>
      request.deviceId === 'rw-standard-vitals' &&
      request.serviceId === '0000180A-0000-1000-8000-00805F9B34FB' &&
      request.characteristicId === '00002A27-0000-1000-8000-00805F9B34FB'
  ) ||
  !readRequests.some(
    (request) =>
      request.deviceId === 'rw-standard-vitals' &&
      request.serviceId === '0000180A-0000-1000-8000-00805F9B34FB' &&
      request.characteristicId === '00002A28-0000-1000-8000-00805F9B34FB'
  ) ||
  !connectStandardVitalEvents.some(
    (event) => event.type === 'firmware_version' && event.source === 'standard_ble_device_information_service' && event.firmwareVersion === 'FW-1.2.3'
  ) ||
  !connectStandardVitalEvents.some(
    (event) => event.type === 'firmware_version' && event.source === 'standard_ble_device_information_service' && event.hardwareVersion === 'HW-9.8'
  ) ||
  !connectStandardVitalEvents.some(
    (event) => event.type === 'firmware_version' && event.source === 'standard_ble_device_information_service' && event.softwareVersion === 'SW-4.5'
  ) ||
  !connectStandardVitalEvents.some(
    (event) => event.type === 'active_measure' && event.source === 'standard_ble_heart_rate_service' && event.heartRate === 72
  ) ||
  !connectStandardVitalEvents.some(
    (event) =>
      event.type === 'active_OxyGenMeasure' &&
      event.source === 'standard_ble_pulse_oximeter_service' &&
      event.bloodOxygen === 98 &&
      event.heartRate === 72
  )
) {
  throw new Error(
    `RW connect should accept standard BLE heart-rate and pulse-oximeter channels as realtime fallbacks: ${JSON.stringify({
      standardVitalsDevice,
      notifyRequests,
      readRequests,
      connectStandardVitalEvents
    })}`
  );
}

const standardPulseRangeEvents: any[] = [];
const standardPulseRangeAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-standard-pulse-range',
    standardPulseOximeterServiceId: '00001822-0000-1000-8000-00805F9B34FB',
    standardPulseOximeterCharId: '00002A5F-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => standardPulseRangeEvents.push(parsed)
} as any);
standardPulseRangeAdapter.setupDataListener();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-standard-pulse-range',
  serviceId: '00001822-0000-1000-8000-00805F9B34FB',
  characteristicId: '00002A5F-0000-1000-8000-00805F9B34FB',
  value: new Uint8Array([0x00, 69, 0x00, 72, 0x00]).buffer
});
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-standard-pulse-range',
  serviceId: '00001822-0000-1000-8000-00805F9B34FB',
  characteristicId: '00002A5F-0000-1000-8000-00805F9B34FB',
  value: new Uint8Array([0x00, 98, 0x00, 72, 0x00]).buffer
});

if (
  standardPulseRangeEvents.some((event) => event.type === 'active_OxyGenMeasure' && event.bloodOxygen === 69) ||
  !standardPulseRangeEvents.some(
    (event) => event.type === 'active_OxyGenMeasure' && event.source === 'standard_ble_pulse_oximeter_service' && event.bloodOxygen === 98
  )
) {
  throw new Error(
    `RW standard pulse-oximeter fallback should reject implausible low SpO2 while keeping normal values: ${JSON.stringify(standardPulseRangeEvents)}`
  );
}

readRequests.length = 0;
const standardVersionAliasEvents: any[] = [];
const standardVersionAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-standard-vitals',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
    standardFirmwareServiceId: '0000180A-0000-1000-8000-00805F9B34FB',
    standardFirmwareCharId: '00002A26-0000-1000-8000-00805F9B34FB',
    standardSoftwareServiceId: '0000180A-0000-1000-8000-00805F9B34FB',
    standardSoftwareCharId: '00002A28-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => standardVersionAliasEvents.push(parsed)
} as any);
standardVersionAliasAdapter.setupDataListener();
const pendingStandardSoftwareAlias = standardVersionAliasAdapter.waitForParsedData((item) => item.type === 'softwareVersion', 1000);
await standardVersionAliasAdapter.sendSoftwareVersion();
const standardSoftwareAlias = await pendingStandardSoftwareAlias;

if (
  standardSoftwareAlias.value !== 'SW-4.5' ||
  !readRequests.some(
    (request) =>
      request.deviceId === 'rw-standard-vitals' &&
      request.serviceId === '0000180A-0000-1000-8000-00805F9B34FB' &&
      request.characteristicId === '00002A28-0000-1000-8000-00805F9B34FB'
  ) ||
  !standardVersionAliasEvents.some(
    (event) => event.type === 'firmware_version' && event.softwareVersion === 'SW-4.5' && event.source === 'standard_ble_device_information_service'
  )
) {
  throw new Error(
    `RW version commands should use standard BLE Device Information Service as an immediate fallback: ${JSON.stringify({
      readRequests,
      standardSoftwareAlias,
      standardVersionAliasEvents
    })}`
  );
}

const canonicalStandardEvents: any[] = [];
const canonicalStandardAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-canonical-standard'
  }),
  onParsedData: (parsed: any) => canonicalStandardEvents.push(parsed)
} as any);
canonicalStandardAdapter.setupDataListener();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-canonical-standard',
  serviceId: '0000180F-0000-1000-8000-00805F9B34FB',
  characteristicId: '00002A19-0000-1000-8000-00805F9B34FB',
  value: new Uint8Array([81]).buffer
});
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-canonical-standard',
  serviceId: '0000180D-0000-1000-8000-00805F9B34FB',
  characteristicId: '00002A37-0000-1000-8000-00805F9B34FB',
  value: new Uint8Array([0x00, 73]).buffer
});
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-canonical-standard',
  serviceId: '00001822-0000-1000-8000-00805F9B34FB',
  characteristicId: '00002A5E-0000-1000-8000-00805F9B34FB',
  value: new Uint8Array([0x00, 97, 73]).buffer
});
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-canonical-standard',
  serviceId: '0000180A-0000-1000-8000-00805F9B34FB',
  characteristicId: '00002A26-0000-1000-8000-00805F9B34FB',
  value: new Uint8Array([70, 87, 45, 67, 65, 78, 79, 78]).buffer
});

if (
  !canonicalStandardEvents.some((event) => event.type === 'battery' && event.battery === 81) ||
  !canonicalStandardEvents.some((event) => event.type === 'active_measure' && event.heartRate === 73) ||
  !canonicalStandardEvents.some(
    (event) =>
      event.type === 'active_OxyGenMeasure' &&
      event.source === 'standard_ble_pulse_oximeter_service' &&
      event.bloodOxygen === 97 &&
      event.heartRate === 73
  ) ||
  !canonicalStandardEvents.some(
    (event) =>
      event.type === 'firmware_version' &&
      event.source === 'standard_ble_device_information_service' &&
      event.firmwareVersion === 'FW-CANON'
  )
) {
  throw new Error(
    `RW standard BLE parser should accept canonical service/characteristic UUIDs even before cached discovery metadata is present: ${JSON.stringify(
      canonicalStandardEvents
    )}`
  );
}

await new Promise((resolve) => setTimeout(resolve, 800));
writtenHex.length = 0;
const commandAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB'
  })
} as any);
await commandAdapter.sendFactoryResetWithTimeCommand();

if (
  writtenHex.length !== 3 ||
  !writtenHex.some((hex) => hex.startsWith('ab010009') && hex.slice(12, 18) === '020100') ||
  !writtenHex.some((hex) => hex.slice(4, 8) === '1000') ||
  writtenHex[writtenHex.length - 1]?.slice(4, 8) !== '3702'
) {
  throw new Error(`RW factory reset with time should sync time before reset: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await commandAdapter.sendCommand(
  0xa0,
  0x00,
  concatBytes(numberToUint64LE(1696687197195), new Uint8Array([7, 2]))
);
if (
  writtenHex.length !== 3 ||
  !writtenHex.some((hex) => hex.startsWith('ab010009') && hex.slice(12, 18) === '020100') ||
  !writtenHex.some((hex) => hex.slice(4, 8) === '1000' && hex.endsWith('07')) ||
  writtenHex[writtenHex.length - 1]?.slice(4, 8) !== '3702'
) {
  throw new Error(
    `RW low-level factory reset with time should honor legacy timestamp/timezone payload: ${JSON.stringify(writtenHex)}`
  );
}

writtenHex.length = 0;
await commandAdapter.updateDeviceTime(1696687197195);
const updateTimeFrames = getWrittenRwTimeFrames();
const updateTimeHasSetKeyFrame = writtenHex.some((hex) => hex.startsWith('ab010009') && hex.slice(12, 18) === '020100');
const updateTimeHasReadKeyFrame = writtenHex.some((hex) => hex.startsWith('ab010003') && hex.endsWith('020110'));

if (
  !updateTimeHasSetKeyFrame ||
  !updateTimeHasReadKeyFrame ||
  updateTimeFrames.length !== 2 ||
  updateTimeFrames[0].slice(4, 8) !== '1000' ||
  updateTimeFrames[1].slice(4, 8) !== '1001'
) {
  throw new Error(`RW update device time should sync then read back time like L19: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await commandAdapter.sendNamedCommand(
  LegacyRingCommand.UpdateDeviceTime,
  concatBytes(numberToUint64LE(1696687197195), new Uint8Array([7]))
);
const namedUpdateTimeFrames = getWrittenRwTimeFrames();

if (
  namedUpdateTimeFrames.length !== 2 ||
  namedUpdateTimeFrames[0].slice(4, 8) !== '1000' ||
  !namedUpdateTimeFrames[0].endsWith('07') ||
  namedUpdateTimeFrames[1].slice(4, 8) !== '1001'
) {
  throw new Error(`RW named update-time command should honor legacy timestamp payload: ${JSON.stringify(writtenHex)}`);
}

const legacyCommandPayloads: Partial<Record<LegacyRingCommand, Uint8Array>> = {
  [LegacyRingCommand.UpdateDeviceTime]: concatBytes(numberToUint64LE(1696687197195), new Uint8Array([8])),
  [LegacyRingCommand.SetCollectPeriod]: numberToUint32LE(1800),
  [LegacyRingCommand.ReadLocalData]: numberToUint32LE(Math.floor(new Date(2026, 0, 2).getTime() / 1000))
};
const legacyNamedCommandErrors: string[] = [];
writtenHex.length = 0;
for (const command of Object.values(LegacyRingCommand)) {
  try {
    await commandAdapter.sendNamedCommand(command, legacyCommandPayloads[command]);
  } catch (error) {
    legacyNamedCommandErrors.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (legacyNamedCommandErrors.length > 0) {
  throw new Error(`RW adapter should provide an equivalent for every L19 named command: ${legacyNamedCommandErrors.join('; ')}`);
}

const legacyNamedCommandPrimaryFrames: Array<{
  command: LegacyRingCommand;
  payload?: Uint8Array;
  expectedCmd: string;
  expectedHex?: string;
  expectedPayloadPrefix?: string;
}> = [
  { command: LegacyRingCommand.HardwareVersion, expectedCmd: '0204', expectedHex: 'ab010003020410' },
  { command: LegacyRingCommand.SoftwareVersion, expectedCmd: '0204', expectedHex: 'ab010003020410' },
  { command: LegacyRingCommand.Battery, expectedCmd: '0203', expectedHex: 'ab010003020310' },
  { command: LegacyRingCommand.ActiveMeasure, expectedCmd: '0609', expectedHex: 'ab010006f7ee060900030501' },
  { command: LegacyRingCommand.BloodOxygen, expectedCmd: '0609', expectedHex: 'ab010006f5ce060900090501' },
  { command: LegacyRingCommand.BodyTemperature, expectedCmd: '0609', expectedHex: 'ab010006359f060900080501' },
  {
    command: LegacyRingCommand.ReadLocalData,
    payload: numberToUint32LE(Math.floor(new Date(2026, 0, 2).getTime() / 1000)),
    expectedCmd: '3610'
  },
  { command: LegacyRingCommand.ReadDeviceTime, expectedCmd: '1001' },
  {
    command: LegacyRingCommand.UpdateDeviceTime,
    payload: concatBytes(numberToUint64LE(1696687197195), new Uint8Array([8])),
    expectedCmd: '1000',
    expectedPayloadPrefix: '0b0c700a8b01000008'
  },
  { command: LegacyRingCommand.DeleteAllLocalData, expectedCmd: '3603' },
  { command: LegacyRingCommand.FactoryReset, expectedCmd: '3702' },
  {
    command: LegacyRingCommand.SetCollectPeriod,
    payload: numberToUint32LE(1800),
    expectedCmd: '3700',
    expectedPayloadPrefix: '08070000'
  },
  { command: LegacyRingCommand.ReadCollectPeriod, expectedCmd: '3701' }
];

for (const item of legacyNamedCommandPrimaryFrames) {
  writtenHex.length = 0;
  await commandAdapter.sendNamedCommand(item.command, item.payload);
  const matchingFrame = writtenHex.find((hex) => {
    if (item.expectedHex) return hex === item.expectedHex;
    if (hex.slice(4, 8) !== item.expectedCmd) return false;
    return !item.expectedPayloadPrefix || hex.slice(8, 8 + item.expectedPayloadPrefix.length) === item.expectedPayloadPrefix;
  });
  if (
    !matchingFrame
  ) {
    throw new Error(
      `RW named command should preserve the L19-equivalent primary command frame: ${JSON.stringify({
        command: item.command,
        expectedCmd: item.expectedCmd,
        expectedPayloadPrefix: item.expectedPayloadPrefix,
        writtenHex
      })}`
    );
  }
}

for (const item of legacyNamedCommandPrimaryFrames) {
  const packet = getLegacyCommandPacket(item.command);
  writtenHex.length = 0;
  await commandAdapter.sendCommand(packet.cmd, packet.subcmd, item.payload);
  const matchingFrame = writtenHex.find((hex) => {
    if (item.expectedHex) return hex === item.expectedHex;
    if (hex.slice(4, 8) !== item.expectedCmd) return false;
    return !item.expectedPayloadPrefix || hex.slice(8, 8 + item.expectedPayloadPrefix.length) === item.expectedPayloadPrefix;
  });
  if (
    !matchingFrame
  ) {
    throw new Error(
      `RW low-level sendCommand should preserve the L19-equivalent primary command frame: ${JSON.stringify({
        command: item.command,
        cmd: packet.cmd,
        subcmd: packet.subcmd,
        expectedCmd: item.expectedCmd,
        expectedPayloadPrefix: item.expectedPayloadPrefix,
        writtenHex
      })}`
    );
  }
}

writtenHex.length = 0;
await commandAdapter.sendNamedCommand(LegacyRingCommand.FactoryReset);
const namedFactoryResetFrames = writtenHex.filter((hex) => hex.slice(4, 8) === '3702');
if (namedFactoryResetFrames.length !== 1) {
  throw new Error(`RW named factory reset should map the L19 reset command to one RW reset frame: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await commandAdapter.sendResetCommand();
if (writtenHex.length !== 1 || writtenHex[0]?.slice(4, 8) !== '3702') {
  throw new Error(`RW direct reset command should map the L19 reset method to one RW reset frame: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await commandAdapter.formatRwFileSystem?.();
if (writtenHex.length !== 1 || writtenHex[0]?.slice(4, 8) !== '3613') {
  throw new Error(`RW format command should write a file-system format frame: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await commandAdapter.sendCommand(0x12, 0x00);
await commandAdapter.sendCommand(0x11, 0x01);
await commandAdapter.sendCommand(0x36, 0x01, numberToUint32LE(Math.floor(new Date(2026, 0, 2).getTime() / 1000)));
await commandAdapter.sendCommand(0x10, 0x01);
await commandAdapter.sendCommand(0x37, 0x02);
const lowLevelCommandWrittenHex = [...writtenHex];

if (
  lowLevelCommandWrittenHex[0] !== 'ab010003020310' ||
  !lowLevelCommandWrittenHex.includes('ab010003020310') ||
  !lowLevelCommandWrittenHex.includes('ab010003fca0020310') ||
  !lowLevelCommandWrittenHex.includes('ab010003020410') ||
  !lowLevelCommandWrittenHex.includes('ab010003cca2020410') ||
  !lowLevelCommandWrittenHex.some((hex) => hex.slice(4, 8) === '3610') ||
  !lowLevelCommandWrittenHex.some((hex) => hex.slice(4, 8) === '1001') ||
  !lowLevelCommandWrittenHex.some((hex) => hex.slice(4, 8) === '3702')
) {
  throw new Error(`RW low-level sendCommand should map known L19 cmd/subcmd pairs to RW primary commands plus compatibility fallback: ${JSON.stringify(lowLevelCommandWrittenHex)}`);
}

const batteryAliasEvents: any[] = [];
const batteryAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-battery-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => batteryAliasEvents.push(parsed)
} as any);
batteryAliasAdapter.setupDataListener();
writtenHex.length = 0;
parityStep('battery alias start');
const pendingBatteryAlias = batteryAliasAdapter.waitForParsedData((item) => item.type === 'battery', 3000);
const batteryAliasCommand = batteryAliasAdapter.sendBatteryCommand();
await new Promise((resolve) => setTimeout(resolve, 20));
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-battery-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab11000603750203104e0f29').buffer
});
const batteryAliasParsed = await pendingBatteryAlias;
await batteryAliasCommand;
parityStep('battery alias result');
const batteryAliasWriteHex = [...writtenHex];

if (
  batteryAliasWriteHex.length !== 1 ||
  batteryAliasWriteHex[0] !== 'ab010003020310' ||
  batteryAliasParsed.type !== 'battery' ||
  batteryAliasParsed.protocol !== 'rw' ||
  batteryAliasParsed.battery !== 78 ||
  batteryAliasParsed.value !== '78%' ||
  batteryAliasParsed.status !== 'normal' ||
  !batteryAliasEvents.some((event) => event.type === 'battery' && event.battery === 78)
) {
  throw new Error(
    `RW battery response should resolve the same L19 battery event contract: ${JSON.stringify({
      writtenHex,
      batteryAliasParsed,
      batteryAliasEvents
    })}`
  );
}

const quickBatteryEvents: any[] = [];
const quickBatteryAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-quick-battery-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => quickBatteryEvents.push(parsed)
} as any);
quickBatteryAdapter.setupDataListener();
writtenHex.length = 0;
synchronousWriteResponses['ab010003020310'] = 'ab1100060375020310500f29';
try {
  await quickBatteryAdapter.sendBatteryCommand();
} finally {
  delete synchronousWriteResponses['ab010003020310'];
}

if (
  writtenHex.length !== 1 ||
  writtenHex[0] !== 'ab010003020310' ||
  !quickBatteryEvents.some((event) => event.type === 'battery' && event.battery === 80 && event.value === '80%')
) {
  throw new Error(
    `RW battery command should use the confirmed SY03 App SDK battery read as the quick primary path: ${JSON.stringify({
      writtenHex,
      quickBatteryEvents
    })}`
  );
}

const standardBatteryEvents: any[] = [];
const standardBatteryReadyDevices: any[] = [];
let standardBatteryRuntimeDevice: any = {};
const standardBatteryAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => standardBatteryRuntimeDevice,
  onDeviceReady: (device: any) => {
    standardBatteryReadyDevices.push(device);
  },
  onParsedData: (parsed: any) => standardBatteryEvents.push(parsed)
} as any);
readRequests.length = 0;
writtenHex.length = 0;
const standardBatteryDevice = await standardBatteryAdapter.connectAndDiscover('rw-standard-battery', 'SY03', {
  deviceId: 'rw-standard-battery',
  name: 'SY03',
  protocol: 'rw',
  advertis: { macInfo: '3E:00:00:00:05:1B' }
});
standardBatteryRuntimeDevice = {
  deviceId: standardBatteryDevice.deviceId,
  serviceId: standardBatteryDevice.serviceId,
  cmdCharId: standardBatteryDevice.cmdCharId,
  dataCharId: standardBatteryDevice.dataCharId
};
const pendingStandardBattery = standardBatteryAdapter.waitForParsedData((item) => item.type === 'battery', 1000);
await standardBatteryAdapter.sendBatteryCommand();
const standardBatteryParsed = await pendingStandardBattery;

if (
  standardBatteryDevice.standardBatteryServiceId !== '0000180F-0000-1000-8000-00805F9B34FB' ||
  standardBatteryDevice.standardBatteryCharId !== '00002A19-0000-1000-8000-00805F9B34FB' ||
  !readRequests.some(
    (request) =>
      request.deviceId === 'rw-standard-battery' &&
      request.serviceId === '0000180F-0000-1000-8000-00805F9B34FB' &&
      request.characteristicId === '00002A19-0000-1000-8000-00805F9B34FB'
  ) ||
  standardBatteryParsed.type !== 'battery' ||
  standardBatteryParsed.protocol !== 'rw' ||
  standardBatteryParsed.battery !== 78 ||
  standardBatteryParsed.value !== '78%' ||
  standardBatteryParsed.source !== 'standard_ble_battery_service' ||
  !standardBatteryEvents.some((event) => event.type === 'battery' && event.battery === 78 && event.source === 'standard_ble_battery_service')
) {
  throw new Error(
    `RW adapter should read standard BLE Battery Service 180F/2A19 as a fallback L19-style battery event: ${JSON.stringify({
      standardBatteryDevice,
      readRequests,
      standardBatteryParsed,
      standardBatteryEvents
    })}`
  );
}

const firmwareAliasEvents: any[] = [];
const firmwareAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-firmware-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => firmwareAliasEvents.push(parsed)
} as any);
firmwareAliasAdapter.setupDataListener();
writtenHex.length = 0;
parityStep('firmware hardware alias start');
const pendingHardwareAlias = firmwareAliasAdapter.waitForParsedData((item) => item.type === 'hardwareVersion', 100);
synchronousWriteResponses['ab010003020410'] = 'ab110013a39d02041002020900300040003330336530303031';
try {
  await firmwareAliasAdapter.sendFirmwareVersion();
} finally {
  delete synchronousWriteResponses['ab010003020410'];
}
const hardwareAliasParsed = await pendingHardwareAlias;

parityStep('firmware software alias start');
const pendingSoftwareAlias = firmwareAliasAdapter.waitForParsedData((item) => item.type === 'softwareVersion', 100);
synchronousWriteResponses['ab010003020410'] = 'ab110013a39d02041002020900300040003330336530303031';
try {
  await firmwareAliasAdapter.sendSoftwareVersion();
} finally {
  delete synchronousWriteResponses['ab010003020410'];
}
const softwareAliasParsed = await pendingSoftwareAlias;
parityStep('firmware aliases result');

if (
  writtenHex.length !== 2 ||
  String(writtenHex[0] || '') !== 'ab010003020410' ||
  String(writtenHex[1] || '') !== 'ab010003020410' ||
  hardwareAliasParsed.type !== 'hardwareVersion' ||
  hardwareAliasParsed.value !== '2.2.9' ||
  hardwareAliasParsed.status !== 'normal' ||
  typeof hardwareAliasParsed.timestamp !== 'number' ||
  softwareAliasParsed.type !== 'softwareVersion' ||
  softwareAliasParsed.value !== '303e0001' ||
  softwareAliasParsed.status !== 'normal' ||
  typeof softwareAliasParsed.timestamp !== 'number' ||
  !firmwareAliasEvents.some((event) => event.type === 'hardwareVersion') ||
  !firmwareAliasEvents.some((event) => event.type === 'softwareVersion')
) {
  throw new Error(
    `RW firmware commands should keep the legacy L19 hardware/software version reads as the quick primary path: ${JSON.stringify({
      writtenHex,
      hardwareAliasParsed,
      softwareAliasParsed,
      firmwareAliasEvents
    })}`
  );
}

writtenHex.length = 0;
parityStep('ascii software alias start');
const firmwareAliasEventCountBeforeLateFallback = firmwareAliasEvents.length;
const pendingAsciiSoftwareAlias = firmwareAliasAdapter.waitForParsedData((item) => item.type === 'softwareVersion', 120);
await firmwareAliasAdapter.sendSoftwareVersion();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-firmware-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('c611000b1234020410322e332e382e3931').buffer
});
let asciiSoftwareAliasParsed: any = null;
let asciiSoftwareAliasTimedOut = false;
try {
  asciiSoftwareAliasParsed = await pendingAsciiSoftwareAlias;
} catch {
  asciiSoftwareAliasTimedOut = true;
}
parityStep('ascii software alias result');
const lateFallbackFirmwareEvents = firmwareAliasEvents.slice(firmwareAliasEventCountBeforeLateFallback);

if (
  String(writtenHex[0] || '') !== 'ab010003020410' ||
  !writtenHex.includes('ab010003cca2020410') ||
  !writtenHex.includes('c60100034045020410') ||
  !lateFallbackFirmwareEvents.some((event) => event.type === 'softwareVersion' && event.value === '2.3.8.91')
) {
  throw new Error(
    `RW firmware default path should send version fallback packets and parse late fallback version aliases without requiring explicit debug mode: ${JSON.stringify({
      writtenHex,
      asciiSoftwareAliasParsed,
      asciiSoftwareAliasTimedOut,
      lateFallbackFirmwareEvents,
      firmwareAliasEvents
    })}`
  );
}

const staleFirmwareAliasEvents: any[] = [];
const staleFirmwareAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-stale-firmware-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => staleFirmwareAliasEvents.push(parsed)
} as any);
staleFirmwareAliasAdapter.setupDataListener();
await staleFirmwareAliasAdapter.sendFirmwareVersion();
staleFirmwareAliasAdapter.clearDataListener();
staleFirmwareAliasAdapter.setupDataListener();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-stale-firmware-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('c6110017123402041000020200f0002801304130353034303200000202').buffer
});

if (
  !staleFirmwareAliasEvents.some((event) => event.type === 'firmware_version') ||
  staleFirmwareAliasEvents.some((event) => event.type === 'hardwareVersion' || event.type === 'softwareVersion')
) {
  throw new Error(
    `RW clearDataListener should clear pending L19 aliases so stale packets cannot cross sessions: ${JSON.stringify(
      staleFirmwareAliasEvents
    )}`
  );
}

const expiredFirmwareAliasEvents: any[] = [];
const expiredFirmwareAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-expired-firmware-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => expiredFirmwareAliasEvents.push(parsed)
} as any);
expiredFirmwareAliasAdapter.setupDataListener();
const firmwareOriginalDateNow = Date.now;
let firmwareFakeNow = firmwareOriginalDateNow();
Date.now = () => firmwareFakeNow;
try {
  await expiredFirmwareAliasAdapter.sendSoftwareVersion();
  firmwareFakeNow += 15001;
  valueCallbacks[valueCallbacks.length - 1]?.({
    deviceId: 'rw-expired-firmware-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
    value: hexToBytes('c6110017123402041000020200f0002801304130353034303200000202').buffer
  });
} finally {
  Date.now = firmwareOriginalDateNow;
}

if (
  !expiredFirmwareAliasEvents.some((event) => event.type === 'firmware_version') ||
  expiredFirmwareAliasEvents.some((event) => event.type === 'hardwareVersion' || event.type === 'softwareVersion')
) {
  throw new Error(
    `RW firmware aliases should expire so stale version page commands cannot claim later firmware packets: ${JSON.stringify(
      expiredFirmwareAliasEvents
    )}`
  );
}

writtenHex.length = 0;
await commandAdapter.sendActiveMeasureCommand();
const activeMeasureControlEnableIndex = writtenHex.indexOf('ab010006f7ee060900030501');
const activeMeasureRealtimeCrcReadIndex = writtenHex.indexOf('ab0100030cbb022410');
const activeMeasureRealtimeReadIndex = writtenHex.indexOf('ab010003022410');
const activeMeasureCrcReadIndex = writtenHex.indexOf('ab0100033d11050310');
const activeMeasureReadIndex = writtenHex.indexOf('ab010003050310');
const activeMeasureControlDisableIndex = writtenHex.findIndex((hex) => hex.endsWith('060900030500'));

if (
  activeMeasureControlEnableIndex !== 0 ||
  activeMeasureRealtimeCrcReadIndex <= activeMeasureControlEnableIndex ||
  activeMeasureRealtimeReadIndex <= activeMeasureRealtimeCrcReadIndex ||
  activeMeasureCrcReadIndex <= activeMeasureRealtimeReadIndex ||
  activeMeasureReadIndex <= activeMeasureCrcReadIndex ||
  activeMeasureControlDisableIndex <= activeMeasureReadIndex ||
  writtenHex.some((hex) => hex.slice(4, 8) === '3100') ||
  writtenHex.includes('ab010003fdd0050311') ||
  !writtenHex.includes('ab010003022410') ||
  !writtenHex.includes('ab010003050310') ||
  writtenHex.includes('ab010003cc7a022411') ||
  writtenHex.includes('ab010006f53e0609000a0501') ||
  writtenHex.includes('ab0100036d17050a10') ||
  writtenHex.includes('ab010006348f0609000d0501') ||
  writtenHex.includes('ab0100035d15050d10')
) {
  throw new Error(
    `RW active measure command should enable RW heart-rate control, prefer realtime keys, fall back to health-data keys, and disable control: ${JSON.stringify({
      writtenHex,
      activeMeasureControlEnableIndex,
      activeMeasureRealtimeCrcReadIndex,
      activeMeasureRealtimeReadIndex,
      activeMeasureCrcReadIndex,
      activeMeasureReadIndex,
      activeMeasureControlDisableIndex
    })}`
  );
}

writtenHex.length = 0;
await commandAdapter.sendOxyGenCommand();
const oxygenControlEnableIndex = writtenHex.indexOf('ab010006f5ce060900090501');
const oxygenRealtimeCrcReadIndex = writtenHex.indexOf('ab010003ac95024e10');
const oxygenRealtimeReadIndex = writtenHex.indexOf('ab010003024e10');
const oxygenCrcReadIndex = writtenHex.indexOf('ab0100039d17050910');
const oxygenReadIndex = writtenHex.indexOf('ab010003050910');
const oxygenControlDisableIndex = writtenHex.findIndex((hex) => hex.endsWith('060900090500'));
if (
  oxygenControlEnableIndex !== 0 ||
  oxygenRealtimeCrcReadIndex <= oxygenControlEnableIndex ||
  oxygenRealtimeReadIndex <= oxygenRealtimeCrcReadIndex ||
  oxygenCrcReadIndex <= oxygenRealtimeReadIndex ||
  oxygenReadIndex <= oxygenCrcReadIndex ||
  oxygenControlDisableIndex <= oxygenReadIndex ||
  writtenHex.some((hex) => hex.slice(4, 8) === '3200') ||
  writtenHex.includes('ab0100035dd6050911') ||
  !writtenHex.includes('ab010003024e10') ||
  !writtenHex.includes('ab010003050910') ||
  writtenHex.includes('ab0100036c54024e11')
) {
  throw new Error(
    `RW blood oxygen command should enable RW blood-oxygen control, prefer realtime keys, fall back to health-data keys, and disable control: ${JSON.stringify({
      writtenHex,
      oxygenControlEnableIndex,
      oxygenRealtimeCrcReadIndex,
      oxygenRealtimeReadIndex,
      oxygenCrcReadIndex,
      oxygenReadIndex,
      oxygenControlDisableIndex
    })}`
  );
}

writtenHex.length = 0;
await commandAdapter.sendBodyTemperatureCommand();
const temperatureControlIndex = writtenHex.indexOf('ab010006359f060900080501');
const temperatureRealtimeCrcReadIndex = writtenHex.indexOf('ab0100030cb4023010');
const temperatureRealtimeReadIndex = writtenHex.indexOf('ab010003023010');
const temperatureCrcReadIndex = writtenHex.indexOf('ab0100030d16050810');
const temperatureReadIndex = writtenHex.indexOf('ab010003050810');
const temperatureDisableIndex = writtenHex.findIndex((hex) => hex.endsWith('060900080500'));
if (
  temperatureControlIndex !== 0 ||
  temperatureRealtimeCrcReadIndex <= temperatureControlIndex ||
  temperatureRealtimeReadIndex <= temperatureRealtimeCrcReadIndex ||
  temperatureCrcReadIndex <= temperatureRealtimeReadIndex ||
  temperatureReadIndex <= temperatureCrcReadIndex ||
  temperatureDisableIndex <= temperatureReadIndex ||
  writtenHex.some((hex) => hex.slice(4, 8) === '3400') ||
  writtenHex.includes('ab010003cdd7050811') ||
  !writtenHex.includes('ab010003023010') ||
  !writtenHex.includes('ab010003050810') ||
  writtenHex.includes('ab010003cc75023011')
) {
  throw new Error(
    `RW body temperature command should enable RW temperature control, prefer realtime keys, fall back to health-data keys, and disable control: ${JSON.stringify({
      writtenHex,
      temperatureControlIndex,
      temperatureRealtimeCrcReadIndex,
      temperatureRealtimeReadIndex,
      temperatureCrcReadIndex,
      temperatureReadIndex,
      temperatureDisableIndex
    })}`
  );
}

const noL19RealtimeProbeEvents: any[] = [];
const noL19RealtimeProbeAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-no-l19-realtime-probe-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => noL19RealtimeProbeEvents.push(parsed)
} as any);
noL19RealtimeProbeAdapter.setupDataListener();

writtenHex.length = 0;
synchronousWriteResponses['legacy-l19-active-measure'] = '000c310001461e24';
synchronousWriteResponses['legacy-l19-oxygen'] = '000d320001486124';
synchronousWriteResponses['legacy-l19-temperature'] = '000e3400016a0e';
try {
  await noL19RealtimeProbeAdapter.sendActiveMeasureCommand();
  await noL19RealtimeProbeAdapter.sendOxyGenCommand();
  await noL19RealtimeProbeAdapter.sendBodyTemperatureCommand();
} finally {
  delete synchronousWriteResponses['legacy-l19-active-measure'];
  delete synchronousWriteResponses['legacy-l19-oxygen'];
  delete synchronousWriteResponses['legacy-l19-temperature'];
}

if (
  writtenHex.some((hex) => ['3100', '3200', '3400'].includes(hex.slice(4, 8))) ||
  noL19RealtimeProbeEvents.some((event) => ['active_measure', 'active_OxyGenMeasure', 'active_Temperature'].includes(event.type)) ||
  !writtenHex.includes('ab010003050310') ||
  !writtenHex.includes('ab010003050910') ||
  !writtenHex.includes('ab010003050810')
) {
  throw new Error(
    `RW realtime commands must ignore L19-compatible realtime probes and only issue RW health-data key reads: ${JSON.stringify({
      writtenHex,
      noL19RealtimeProbeEvents
    })}`
  );
}

const quickNativeAliasEvents: any[] = [];
const quickNativeAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-quick-native-alias-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => quickNativeAliasEvents.push(parsed)
} as any);
quickNativeAliasAdapter.setupDataListener();

const pendingQuickNativeActiveAlias = quickNativeAliasAdapter.waitForParsedData((item) => item.type === 'active_measure', 1000);
const quickNativeActiveCommand = quickNativeAliasAdapter.sendActiveMeasureCommand();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-quick-native-alias-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab11000500000224101148').buffer
});
const quickNativeActiveAlias = await pendingQuickNativeActiveAlias;
await quickNativeActiveCommand;

const pendingQuickNativeOxygenAlias = quickNativeAliasAdapter.waitForParsedData((item) => item.type === 'active_OxyGenMeasure', 1000);
const quickNativeOxygenCommand = quickNativeAliasAdapter.sendOxyGenCommand();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-quick-native-alias-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab1100050000024e101162').buffer
});
const quickNativeOxygenAlias = await pendingQuickNativeOxygenAlias;
await quickNativeOxygenCommand;

const pendingQuickNativeTemperatureAlias = quickNativeAliasAdapter.waitForParsedData((item) => item.type === 'active_Temperature', 1000);
const quickNativeTemperatureCommand = quickNativeAliasAdapter.sendBodyTemperatureCommand();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-quick-native-alias-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab1100060000023010117201').buffer
});
const quickNativeTemperatureAlias = await pendingQuickNativeTemperatureAlias;
await quickNativeTemperatureCommand;

if (
  quickNativeActiveAlias.heartRate !== 72 ||
  quickNativeActiveAlias.heartbeatStatus !== 0x01 ||
  quickNativeOxygenAlias.bloodOxygen !== 98 ||
  quickNativeOxygenAlias.bloodOxygenStatus !== 0x01 ||
  quickNativeTemperatureAlias.temperature !== '37.00' ||
  quickNativeTemperatureAlias.temperatureValue !== 37 ||
  quickNativeTemperatureAlias.temperatureStatus !== 0x01 ||
  quickNativeAliasEvents.filter((event) => event.type === 'rw_health_data').length !== 3 ||
  quickNativeAliasEvents.filter((event) => event.type === 'active_measure').length !== 1 ||
  quickNativeAliasEvents.filter((event) => event.type === 'active_OxyGenMeasure').length !== 1 ||
  quickNativeAliasEvents.filter((event) => event.type === 'active_Temperature').length !== 1
) {
  throw new Error(
    `RW quick native realtime packets should resolve L19 metric waiters without waiting for fallback: ${JSON.stringify({
      quickNativeActiveAlias,
      quickNativeOxygenAlias,
      quickNativeTemperatureAlias,
      quickNativeAliasEvents
    })}`
  );
}

const metricAliasEvents: any[] = [];
const metricAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-metric-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => metricAliasEvents.push(parsed)
} as any);
metricAliasAdapter.setupDataListener();

const zeroMetricAliasEvents: any[] = [];
const zeroMetricAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-zero-metric-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => zeroMetricAliasEvents.push(parsed)
} as any);
zeroMetricAliasAdapter.setupDataListener();
await zeroMetricAliasAdapter.sendActiveMeasureCommand();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-zero-metric-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab11000400000269102a').buffer
});
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-zero-metric-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab110004000002241000').buffer
});
await new Promise((resolve) => setTimeout(resolve, 20));
if (zeroMetricAliasEvents.some((event) => event.type === 'active_measure')) {
  throw new Error(`RW active_measure alias should not resolve from HRV-only or zero heart-rate packets: ${JSON.stringify(zeroMetricAliasEvents)}`);
}

const pendingZeroThenRealActiveAlias = zeroMetricAliasAdapter.waitForParsedData((item) => item.type === 'active_measure', 1000);
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-zero-metric-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab110004000002241048').buffer
});
const zeroThenRealActiveAlias = await pendingZeroThenRealActiveAlias;
if (zeroThenRealActiveAlias.heartRate !== 72 || zeroThenRealActiveAlias.heartRateVariability !== 42) {
  throw new Error(`RW zero heart-rate packets should keep the active_measure alias pending for the later real value: ${JSON.stringify({
    zeroThenRealActiveAlias,
    zeroMetricAliasEvents
  })}`);
}

await zeroMetricAliasAdapter.sendOxyGenCommand();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-zero-metric-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab1100040000024e1000').buffer
});
await new Promise((resolve) => setTimeout(resolve, 20));
if (zeroMetricAliasEvents.some((event) => event.type === 'active_OxyGenMeasure')) {
  throw new Error(`RW active_OxyGenMeasure alias should not resolve from zero blood-oxygen packets: ${JSON.stringify(zeroMetricAliasEvents)}`);
}

const pendingZeroThenRealOxygenAlias = zeroMetricAliasAdapter.waitForParsedData((item) => item.type === 'active_OxyGenMeasure', 1000);
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-zero-metric-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab1100040000024e1062').buffer
});
const zeroThenRealOxygenAlias = await pendingZeroThenRealOxygenAlias;
if (zeroThenRealOxygenAlias.bloodOxygen !== 98) {
  throw new Error(`RW zero blood-oxygen packets should keep the active_OxyGenMeasure alias pending for the later real value: ${JSON.stringify({
    zeroThenRealOxygenAlias,
    zeroMetricAliasEvents
  })}`);
}

metricAliasAdapter.clearDataListener();
metricAliasAdapter.setupDataListener();
writtenHex.length = 0;
const pendingActiveMeasureAlias = metricAliasAdapter.waitForParsedData((item) => item.type === 'active_measure', 3000);
await metricAliasAdapter.sendActiveMeasureCommand();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-metric-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab110004000002241050').buffer
});
const activeMeasureAlias = await pendingActiveMeasureAlias;
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-metric-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab11000400000269102a').buffer
});
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-metric-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab1100040000024f101f').buffer
});

const pendingOxygenAlias = metricAliasAdapter.waitForParsedData((item) => item.type === 'active_OxyGenMeasure', 3000);
await metricAliasAdapter.sendOxyGenCommand();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-metric-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab11000997fc024e0031d5ac7e6300').buffer
});
const oxygenAlias = await pendingOxygenAlias;

const pendingTemperatureAlias = metricAliasAdapter.waitForParsedData((item) => item.type === 'active_Temperature', 3000);
await metricAliasAdapter.sendBodyTemperatureCommand();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-metric-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab11000500000230107201').buffer
});
const temperatureAlias = await pendingTemperatureAlias;
const activeMeasureAliases = metricAliasEvents.filter((event) => event.type === 'active_measure');
const mergedActiveMeasureAlias = activeMeasureAliases[activeMeasureAliases.length - 1];

if (
  activeMeasureAlias.heartRate !== 80 ||
  activeMeasureAlias.heartbeatStatus !== 0x01 ||
  activeMeasureAliases.length < 3 ||
  mergedActiveMeasureAlias.heartRate !== 80 ||
  mergedActiveMeasureAlias.heartRateVariability !== 42 ||
  mergedActiveMeasureAlias.stressIndex !== 31 ||
  mergedActiveMeasureAlias.heartbeatStatus !== 0x01 ||
  oxygenAlias.bloodOxygen !== 99 ||
  oxygenAlias.bloodOxygenStatus !== 0x01 ||
  Object.prototype.hasOwnProperty.call(oxygenAlias, 'heartRate') ||
  temperatureAlias.temperature !== '37.00' ||
  temperatureAlias.temperatureValue !== 37 ||
  temperatureAlias.temperatureStatus !== 0x01 ||
  metricAliasEvents.filter((event) => event.type === 'rw_health_data').length < 5 ||
  !metricAliasEvents.some((event) => event.type === 'active_measure') ||
  !metricAliasEvents.some((event) => event.type === 'active_OxyGenMeasure') ||
  !metricAliasEvents.some((event) => event.type === 'active_Temperature')
) {
  throw new Error(
    `RW realtime metric responses should keep rw_health_data and also resolve L19 active metric aliases: ${JSON.stringify({
      activeMeasureAlias,
      oxygenAlias,
      temperatureAlias,
      metricAliasEvents
    })}`
  );
}

const pendingOxygenNackAlias = metricAliasAdapter.waitForParsedData((item) => item.type === 'active_OxyGenMeasure', 3000);
await metricAliasAdapter.sendOxyGenCommand();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-metric-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab1100040000024e1031').buffer
});
const oxygenNackAlias = await pendingOxygenNackAlias;

if (
  oxygenNackAlias.type !== 'active_OxyGenMeasure' ||
  oxygenNackAlias.status !== 'nack' ||
  oxygenNackAlias.bloodOxygenStatus !== 0x02 ||
  oxygenNackAlias.bloodOxygen != null ||
  oxygenNackAlias.message !== '\u8bbe\u5907\u8fd4\u56de\u5931\u8d25\u5e94\u7b54\uff0c\u672a\u8fd4\u56de\u771f\u5b9e\u6570\u636e' ||
  !metricAliasEvents.some((event) => event.type === 'rw_health_data_ack' && event.name === 'blood_oxygen' && event.status === 'nack') ||
  !metricAliasEvents.some((event) => event.type === 'active_OxyGenMeasure' && event.status === 'nack')
) {
  throw new Error(
    `RW status-only NACK responses should resolve L19 metric aliases instead of timing out: ${JSON.stringify({
      oxygenNackAlias,
      metricAliasEvents
    })}`
  );
}

const pendingOxygenControlFailureAlias = metricAliasAdapter.waitForParsedData((item) => item.type === 'active_OxyGenMeasure', 3000);
await metricAliasAdapter.sendOxyGenCommand();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-metric-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab1100060000060901090501').buffer
});
const oxygenControlFailureAlias = await pendingOxygenControlFailureAlias;

if (
  oxygenControlFailureAlias.type !== 'active_OxyGenMeasure' ||
  oxygenControlFailureAlias.status !== 'failed' ||
  oxygenControlFailureAlias.bloodOxygenStatus !== 0x02 ||
  oxygenControlFailureAlias.bloodOxygen != null ||
  !metricAliasEvents.some((event) => event.type === 'rw_health_data_control_ack' && event.name === 'blood_oxygen' && event.status === 'failed') ||
  !metricAliasEvents.some((event) => event.type === 'active_OxyGenMeasure' && event.status === 'failed')
) {
  throw new Error(
    `RW failed control ACK responses should resolve L19 metric aliases instead of timing out: ${JSON.stringify({
      oxygenControlFailureAlias,
      metricAliasEvents
    })}`
  );
}

const staleMetricAliasEvents: any[] = [];
const staleMetricAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-stale-metric-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => staleMetricAliasEvents.push(parsed)
} as any);
staleMetricAliasAdapter.setupDataListener();
const originalDateNow = Date.now;
let fakeNow = originalDateNow();
Date.now = () => fakeNow;
try {
  await staleMetricAliasAdapter.sendOxyGenCommand();
  fakeNow += 35001;
  valueCallbacks[valueCallbacks.length - 1]?.({
    deviceId: 'rw-stale-metric-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
    value: hexToBytes('ab11000997fc024e0031d5ac7e6300').buffer
  });
} finally {
  Date.now = originalDateNow;
}

if (
  staleMetricAliasEvents.some((event) => event.type === 'active_OxyGenMeasure') ||
  !staleMetricAliasEvents.some((event) => event.type === 'rw_health_data' && event.name === 'blood_oxygen' && event.value === 99)
) {
  throw new Error(
    `RW metric aliases should expire so stale page commands cannot claim later data: ${JSON.stringify(staleMetricAliasEvents)}`
  );
}

writtenHex.length = 0;
await commandAdapter.controlRwHealthData?.('spo2');
await commandAdapter.controlRwHealthData?.('hrv');
await commandAdapter.controlRwHealthData?.('stress');
await commandAdapter.controlRwHealthData?.('blood_sugar');
await commandAdapter.controlRwHealthData?.('blood_pressure');
await commandAdapter.controlRwHealthData?.('bodyTemp');
await commandAdapter.controlRwHealthData?.('skinTemperature');
await commandAdapter.controlRwHealthData?.('bloodOxygen');
await commandAdapter.controlRwHealthData?.('bp');
const activeControlWrittenHex = [...writtenHex];

if (
  activeControlWrittenHex[0] !== 'ab010006f5ce060900090501' ||
  !activeControlWrittenHex.includes('ab010006f53e0609000a0501') ||
  !activeControlWrittenHex.includes('ab010006348f0609000d0501') ||
  !activeControlWrittenHex.includes('ab010006321f060900100501') ||
  !activeControlWrittenHex.includes('ab010006365f060900040501') ||
  !activeControlWrittenHex.includes('ab010006359f060900080501') ||
  activeControlWrittenHex.some((hex) => hex.includes('050910') || hex.includes('024e10')) ||
  activeControlWrittenHex.length !== 9
) {
  throw new Error(
    `RW active control commands should enable one metric without starting read fallbacks: ${JSON.stringify(activeControlWrittenHex)}`
  );
}

const controlAckEvents: any[] = [];
const controlAckAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-control-ack-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => controlAckEvents.push(parsed)
} as any);
controlAckAdapter.setupDataListener();
await controlAckAdapter.controlRwHealthData?.('blood_oxygen', true);
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-control-ack-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab11000351e6060900').buffer
});
await controlAckAdapter.controlRwHealthData?.('blood_oxygen', false);
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-control-ack-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('ab11000351e6060900').buffer
});
const correlatedControlAcks = controlAckEvents.filter((event) => event.type === 'rw_health_data_control_ack');

if (
  correlatedControlAcks.length !== 2 ||
  correlatedControlAcks[0].name !== 'blood_oxygen' ||
  correlatedControlAcks[0].controlKey !== 0x09 ||
  correlatedControlAcks[0].controlAction !== 1 ||
  correlatedControlAcks[0].enabled !== true ||
  correlatedControlAcks[1].name !== 'blood_oxygen' ||
  correlatedControlAcks[1].controlKey !== 0x09 ||
  correlatedControlAcks[1].controlAction !== 0 ||
  correlatedControlAcks[1].enabled !== false
) {
  throw new Error(
    `RW generic 0x0609 ACKs should be correlated with the queued metric control so diagnostics identify the measurement phase: ${JSON.stringify(
      correlatedControlAcks
    )}`
  );
}
controlAckAdapter.clearDataListener();

writtenHex.length = 0;
let blockedDeleteCount = 0;
await commandAdapter.readRwHealthData?.('spo2');
try {
  await commandAdapter.deleteRwHealthData?.('spo2');
} catch {
  blockedDeleteCount += 1;
}
await commandAdapter.readRwHealthData?.('hrv');
await commandAdapter.readRwHealthData?.('stress');
await commandAdapter.readRwHealthData?.('blood_sugar');
await commandAdapter.readRwHealthData?.('blood_pressure');
await commandAdapter.readRwHealthData?.('bloodOxygen');
await commandAdapter.readRwHealthData?.('bodyTemperature');
await commandAdapter.readRwHealthData?.('skinTemperature');
try {
  await commandAdapter.deleteRwHealthData?.('bp');
} catch {
  blockedDeleteCount += 1;
}

const realtimeReadKeys = writtenHex
  .filter((hex) => hex.startsWith('ab') && hex.endsWith('10'))
  .map((hex) => hex.slice(-6, -2));
const deletedHistoryKeys = writtenHex
  .filter((hex) => hex.startsWith('ab') && hex.endsWith('30'))
  .map((hex) => hex.slice(-6, -2));

if (
  JSON.stringify(realtimeReadKeys) !==
    JSON.stringify([
      '024e',
      '024e',
      '0509',
      '0509',
      '0269',
      '0269',
      '050a',
      '050a',
      '024f',
      '024f',
      '050d',
      '050d',
      '026c',
      '026c',
      '0510',
      '0510',
      '0231',
      '0231',
      '0504',
      '0504',
      '024e',
      '024e',
      '0509',
      '0509',
      '0230',
      '0230',
      '0508',
      '0508',
      '0230',
      '0230',
      '0508',
      '0508'
    ]) ||
  JSON.stringify(deletedHistoryKeys) !== JSON.stringify([]) ||
  blockedDeleteCount !== 2 ||
  writtenHex.some((hex) => hex.endsWith('11')) ||
  !writtenHex.includes('ab010003ac95024e10') ||
  !writtenHex.includes('ab010003024e10') ||
  !writtenHex.includes('ab0100039d17050910') ||
  !writtenHex.includes('ab010003050910') ||
  !writtenHex.includes('ab0100030cb4023010') ||
  !writtenHex.includes('ab010003023010') ||
  writtenHex.length !== 32
) {
  throw new Error(
    `RW realtime health-data commands should prefer app realtime reads, keep health-data fallback/no-CRC fallback, and block explicit device history deletes: ${JSON.stringify({
      writtenHex,
      realtimeReadKeys,
      deletedHistoryKeys,
      blockedDeleteCount
    })}`
  );
}

writtenHex.length = 0;
await commandAdapter.getTimedHeartRateJL?.();
await commandAdapter.getTimedBloodOxygenJL?.();
await commandAdapter.readRwMonitoringConfig?.('spo2');
await commandAdapter.readRwMonitoringConfig?.('bloodOxygen');
await commandAdapter.getTimedHRVJL?.();
await commandAdapter.getTimedStressJL?.();
await commandAdapter.getTimedBloodSugarJL?.();
await commandAdapter.getTimedBloodPressureJL?.();
await commandAdapter.readRwMonitoringConfig?.('bodyTemp');
await commandAdapter.readRwMonitoringConfig?.('skinTemp');
await commandAdapter.getTimedTemperatureJL?.();
const appSdkMonitoringReadCommands = [
  'ab0100036cae021610',
  'ab0100039cba022510',
  'ab0100039cba022510',
  'ab0100039cba022510',
  'ab010003ac8e026a10',
  'ab0100033c8f026b10',
  'ab0100036c8c026e10',
  'ab010003cc80027c10',
  'ab0100035c81027d10',
  'ab0100035c81027d10',
  'ab0100035c81027d10'
];
if (JSON.stringify(writtenHex) !== JSON.stringify(appSdkMonitoringReadCommands)) {
  throw new Error(`RW App SDK timed read aliases should map to monitoring reads and L19-style aliases: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
const appSdkMonitoringConfig = {
  enabled: true,
  startHour: 1,
  startMinute: 2,
  endHour: 3,
  endMinute: 4,
  interval: 5
};
await commandAdapter.setTimedHeartRateJL?.(appSdkMonitoringConfig);
await commandAdapter.setTimedBloodOxygenJL?.(appSdkMonitoringConfig);
await commandAdapter.setRwMonitoringConfig?.('spo2', appSdkMonitoringConfig);
await commandAdapter.setRwMonitoringConfig?.('bloodOxygen', appSdkMonitoringConfig);
await commandAdapter.setTimedHRVJL?.(appSdkMonitoringConfig);
await commandAdapter.setTimedStressJL?.(appSdkMonitoringConfig);
await commandAdapter.setTimedBloodSugarJL?.(appSdkMonitoringConfig);
await commandAdapter.setTimedBloodPressureJL?.(appSdkMonitoringConfig);
await commandAdapter.setRwMonitoringConfig?.('bodyTemp', appSdkMonitoringConfig);
await commandAdapter.setRwMonitoringConfig?.('skinTemperature', appSdkMonitoringConfig);
await commandAdapter.setTimedTemperatureJL?.(appSdkMonitoringConfig);
const appSdkMonitoringWriteKeys = writtenHex.map((hex) => `${hex.slice(12, 18)}:${hex.slice(-12)}`);
if (
  JSON.stringify(appSdkMonitoringWriteKeys) !==
  JSON.stringify([
    '021600:010102030405',
    '022500:010102030405',
    '022500:010102030405',
    '022500:010102030405',
    '026a00:010102030405',
    '026b00:010102030405',
    '026e00:010102030405',
    '027c00:010102030405',
    '021b00:ff0102030405',
    '021b00:ff0102030405',
    '021b00:ff0102030405'
  ])
) {
  throw new Error(`RW App SDK timed write aliases should map to monitoring writes and L19-style aliases: ${JSON.stringify(writtenHex)}`);
}

writtenHex.length = 0;
await commandAdapter.controlHealthDataJL?.('bloodSugar', true);
await commandAdapter.syncAllHealthData?.();
await commandAdapter.syncHealthDataByType?.('bloodPressure');
if (
  String(writtenHex[0] || '') !== 'ab010006321f060900100501' ||
  writtenHex.includes('ab0100030d1c051010') ||
  writtenHex.includes('ab0100030c8d026c10') ||
  String(writtenHex[writtenHex.length - 2] || '').slice(4, 8) !== '3610' ||
  String(writtenHex[writtenHex.length - 1] || '').slice(4, 8) !== '3610'
) {
  throw new Error(`RW App SDK control/history aliases should keep control one-shot and map history to file-list sync: ${JSON.stringify(writtenHex)}`);
}

commandAdapter.cacheServiceId('rw-device', '0000A00A-0000-1000-8000-00805F9B34FB');
if (commandAdapter.getCachedServiceId('rw-device') !== '0000A00A-0000-1000-8000-00805F9B34FB') {
  throw new Error(`RW adapter should preserve service cache like L19: ${JSON.stringify(storage)}`);
}

mtuRequests.length = 0;
await commandAdapter.setMTU('rw-device', 185);
if (mtuRequests.length !== 1 || mtuRequests[0].deviceId !== 'rw-device' || mtuRequests[0].mtu !== 185) {
  throw new Error(`RW adapter should wrap setMTU like L19 on Android: ${JSON.stringify(mtuRequests)}`);
}

mtuShouldFail = true;
mtuRequests.length = 0;
let directMtuFailureEscaped = false;
try {
  await commandAdapter.setMTU('rw-device', 185);
} catch {
  directMtuFailureEscaped = true;
}
mtuShouldFail = false;
if (directMtuFailureEscaped || mtuRequests.length !== 1 || mtuRequests[0].deviceId !== 'rw-device' || mtuRequests[0].mtu !== 185) {
  throw new Error(`RW adapter setMTU should treat Android internal MTU failures as non-fatal: ${JSON.stringify(mtuRequests)}`);
}

const collectAliasEvents: any[] = [];
const collectAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-collect-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => collectAliasEvents.push(parsed)
} as any);
collectAliasAdapter.setupDataListener();

writtenHex.length = 0;
const pendingCollectReadAlias = collectAliasAdapter.waitForParsedData((item) => item.type === 'collect_period_read', 3000);
synchronousWriteResponses['legacy-l19-collect-read'] = '000d370108070000';
try {
  await collectAliasAdapter.readCollectPeriodCommand();
} finally {
  delete synchronousWriteResponses['legacy-l19-collect-read'];
}
const collectReadAlias = await pendingCollectReadAlias;
const collectReadWrittenHex = [...writtenHex];

writtenHex.length = 0;
const pendingCollectSetAlias = collectAliasAdapter.waitForParsedData((item) => item.type === 'collect_period_set', 3000);
synchronousWriteResponses['legacy-l19-collect-set'] = '000c370001';
try {
  await collectAliasAdapter.sendCollectPeriodSettingCommand(1800);
} finally {
  delete synchronousWriteResponses['legacy-l19-collect-set'];
}
const collectSetAlias = await pendingCollectSetAlias;
const collectSetWrittenHex = [...writtenHex];

if (
  collectReadWrittenHex.length !== 1 ||
  collectReadWrittenHex[0]?.slice(4, 8) !== '3701' ||
  collectSetWrittenHex.length !== 1 ||
  collectSetWrittenHex[0]?.slice(4, 8) !== '3700' ||
  collectSetWrittenHex[0]?.slice(8) !== '08070000' ||
  collectReadAlias.period !== 1800 ||
  collectReadAlias.minutes !== '30.0' ||
  collectSetAlias.status !== 'success' ||
  !collectAliasEvents.some((event) => event.type === 'collect_period_read') ||
  !collectAliasEvents.some((event) => event.type === 'collect_period_set')
) {
  throw new Error(
    `RW collect-period commands should accept L19-compatible packets as the quick primary path: ${JSON.stringify({
      collectReadWrittenHex,
      collectSetWrittenHex,
      collectReadAlias,
      collectSetAlias,
      collectAliasEvents
    })}`
  );
}

const staleCollectAliasEvents: any[] = [];
const staleCollectAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-stale-collect-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => staleCollectAliasEvents.push(parsed)
} as any);
staleCollectAliasAdapter.setupDataListener();
const collectAliasOriginalDateNow = Date.now;
let collectAliasFakeNow = collectAliasOriginalDateNow();
Date.now = () => collectAliasFakeNow;
try {
  await staleCollectAliasAdapter.readCollectPeriodCommand();
  collectAliasFakeNow += 15001;
  valueCallbacks[valueCallbacks.length - 1]?.({
    deviceId: 'rw-stale-collect-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
    value: hexToBytes('c61100091234021610010000173b1e').buffer
  });

  await staleCollectAliasAdapter.sendCollectPeriodSettingCommand(1800);
  collectAliasFakeNow += 15001;
  valueCallbacks[valueCallbacks.length - 1]?.({
    deviceId: 'rw-stale-collect-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
    value: hexToBytes('c61100091234021610010000173b1e').buffer
  });
} finally {
  Date.now = collectAliasOriginalDateNow;
}

if (
  staleCollectAliasEvents.some((event) => event.type === 'collect_period_read' || event.type === 'collect_period_set') ||
  staleCollectAliasEvents.filter((event) => event.type === 'rw_health_monitoring').length !== 2
) {
  throw new Error(
    `RW collect-period aliases should expire so stale page commands cannot claim later monitoring packets: ${JSON.stringify(
      staleCollectAliasEvents
    )}`
  );
}

const deleteAliasEvents: any[] = [];
const deleteAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-delete-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => deleteAliasEvents.push(parsed)
} as any);
deleteAliasAdapter.setupDataListener();
writtenHex.length = 0;
const pendingDeleteAlias = deleteAliasAdapter.waitForParsedData((item) => item.type === 'delete_all_local_data', 100);
synchronousWriteResponses['legacy-l19-delete-local'] = '000e3603';
try {
  await deleteAliasAdapter.sendDeleteAllLocalDataCommand();
} finally {
  delete synchronousWriteResponses['legacy-l19-delete-local'];
}
const deleteAliasParsed = await pendingDeleteAlias;

if (
  writtenHex.length !== 1 ||
  String(writtenHex[0] || '').slice(4, 8) !== '3603' ||
  deleteAliasParsed.type !== 'delete_all_local_data' ||
  deleteAliasParsed.packetShape !== 'legacy_compat' ||
  !deleteAliasEvents.some((event) => event.type === 'delete_all_local_data')
) {
  throw new Error(
    `RW delete local data should accept the L19 delete command as the quick primary path: ${JSON.stringify({
      writtenHex,
      deleteAliasParsed,
      deleteAliasEvents
    })}`
  );
}

const staleDeleteAliasEvents: any[] = [];
const staleDeleteAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-stale-delete-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => staleDeleteAliasEvents.push(parsed)
} as any);
staleDeleteAliasAdapter.setupDataListener();
const deleteAliasOriginalDateNow = Date.now;
let deleteAliasFakeNow = deleteAliasOriginalDateNow();
Date.now = () => deleteAliasFakeNow;
try {
  await staleDeleteAliasAdapter.sendDeleteAllLocalDataCommand();
  deleteAliasFakeNow += 15001;
  valueCallbacks[valueCallbacks.length - 1]?.({
    deviceId: 'rw-stale-delete-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
    value: hexToBytes('0042361301').buffer
  });
} finally {
  Date.now = deleteAliasOriginalDateNow;
}

if (
  staleDeleteAliasEvents.some((event) => event.type === 'delete_all_local_data') ||
  !staleDeleteAliasEvents.some((event) => event.type === 'rw_format_file_system')
) {
  throw new Error(
    `RW delete local-data aliases should expire so stale delete commands cannot claim later format packets: ${JSON.stringify(
      staleDeleteAliasEvents
    )}`
  );
}

const formatAliasEvents: any[] = [];
const formatAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-format-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => formatAliasEvents.push(parsed)
} as any);
formatAliasAdapter.setupDataListener();
writtenHex.length = 0;
const pendingFormatAlias = formatAliasAdapter.waitForParsedData((item) => item.type === 'delete_all_local_data', 100);
if (!formatAliasAdapter.formatRwFileSystem) {
  throw new Error('RW adapter should expose formatRwFileSystem.');
}
await formatAliasAdapter.formatRwFileSystem();
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-format-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('0042361301').buffer
});
const formatAliasParsed = await pendingFormatAlias;

if (
  String(writtenHex[0] || '').slice(4, 8) !== '3613' ||
  formatAliasParsed.type !== 'delete_all_local_data' ||
  formatAliasParsed.success !== true ||
  !formatAliasEvents.some((event) => event.type === 'rw_format_file_system') ||
  !formatAliasEvents.some((event) => event.type === 'delete_all_local_data')
) {
  throw new Error(
    `RW format file system should also resolve the L19 delete_all_local_data alias: ${JSON.stringify({
      writtenHex,
      formatAliasParsed,
      formatAliasEvents
    })}`
  );
}

const localDataAliasEvents: any[] = [];
const localDataAliasAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-local-data-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => localDataAliasEvents.push(parsed)
} as any);
localDataAliasAdapter.setupDataListener();
writtenHex.length = 0;
const pendingLocalDataAlias = localDataAliasAdapter.waitForParsedData((item) => item.type === 'local_data', 100);
await localDataAliasAdapter.readLocalData({ readAll: true });
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-local-data-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('0043361001000000010000001000000075315f32303236303130313031303130315f68722e747874000000').buffer
});
const localDataAliasParsed = await pendingLocalDataAlias;

if (
  String(writtenHex[0] || '').slice(4, 8) !== '3610' ||
  localDataAliasParsed.type !== 'local_data' ||
  localDataAliasParsed.status !== 'file_list' ||
  localDataAliasParsed.totalFileCount !== 1 ||
  localDataAliasParsed.selectedFileCount !== 1 ||
  localDataAliasParsed.files?.[0]?.fileName !== 'u1_20260101010101_hr.txt' ||
  !Array.isArray(localDataAliasParsed.records) ||
  !localDataAliasEvents.some((event) => event.type === 'rw_file_list') ||
  !localDataAliasEvents.some((event) => event.type === 'local_data')
) {
  throw new Error(
    `RW file-list response should keep rw_file_list and also resolve the L19 local_data alias: ${JSON.stringify({
      writtenHex,
      localDataAliasParsed,
      localDataAliasEvents
    })}`
  );
}

writtenHex.length = 0;
const pendingTypedLocalDataAlias = localDataAliasAdapter.waitForParsedData((item) => item.type === 'local_data', 100);
await localDataAliasAdapter.syncHealthDataByType?.('blood_pressure');
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-local-data-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('0043361001000000010000001000000075315f32303236303130313031303130315f68722e747874000000').buffer
});
const typedLocalDataAliasParsed = await pendingTypedLocalDataAlias;

if (
  String(writtenHex[0] || '').slice(4, 8) !== '3610' ||
  typedLocalDataAliasParsed.type !== 'local_data' ||
  typedLocalDataAliasParsed.status !== 'filtered' ||
  typedLocalDataAliasParsed.message !== 'RW history files are outside the current read range or type filter.' ||
  typedLocalDataAliasParsed.dataType !== 'blood_pressure' ||
  typedLocalDataAliasParsed.totalFileCount !== 1 ||
  typedLocalDataAliasParsed.selectedFileCount !== 0 ||
  typedLocalDataAliasParsed.filteredFileCount !== 1 ||
  typedLocalDataAliasParsed.files?.length !== 0 ||
  typedLocalDataAliasParsed.allFiles?.[0]?.fileName !== 'u1_20260101010101_hr.txt'
) {
  throw new Error(
    `RW syncHealthDataByType should filter L19 local_data file-list aliases by requested type: ${JSON.stringify({
      writtenHex,
      typedLocalDataAliasParsed
    })}`
  );
}

const typedLocalDataAliasEvent = localDataAliasEvents.find(
  (event) => event.type === 'local_data' && event.dataType === 'blood_pressure'
);
if (typedLocalDataAliasEvent?.status !== 'filtered') {
  throw new Error(`RW filtered local_data alias should be emitted as filtered, not empty: ${JSON.stringify(localDataAliasEvents)}`);
}

writtenHex.length = 0;
const pendingOxygenTypedLocalDataAlias = localDataAliasAdapter.waitForParsedData((item) => item.type === 'local_data', 100);
await localDataAliasAdapter.syncHealthDataByType?.('blood_oxygen');
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-local-data-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('0044361001000000030000001000000075315f32303236303130313031303230325f73706f322e74787400').buffer
});
const oxygenTypedLocalDataAliasParsed = await pendingOxygenTypedLocalDataAlias;

if (
  String(writtenHex[0] || '').slice(4, 8) !== '3610' ||
  oxygenTypedLocalDataAliasParsed.type !== 'local_data' ||
  oxygenTypedLocalDataAliasParsed.dataType !== 'blood_oxygen' ||
  oxygenTypedLocalDataAliasParsed.totalFileCount !== 1 ||
  oxygenTypedLocalDataAliasParsed.selectedFileCount !== 1 ||
  oxygenTypedLocalDataAliasParsed.filteredFileCount !== 0 ||
  oxygenTypedLocalDataAliasParsed.files?.[0]?.fileName !== 'u1_20260101010202_spo2.txt' ||
  oxygenTypedLocalDataAliasParsed.allFiles?.[0]?.fileName !== 'u1_20260101010202_spo2.txt'
) {
  throw new Error(
    `RW syncHealthDataByType should treat spo2 history files as blood oxygen local_data aliases: ${JSON.stringify({
      writtenHex,
      oxygenTypedLocalDataAliasParsed
    })}`
  );
}

writtenHex.length = 0;
const pendingMultiTypeLocalDataAlias = localDataAliasAdapter.waitForParsedData((item) => item.type === 'local_data', 100);
await localDataAliasAdapter.readLocalData({ readAll: true, dataTypes: ['blood_pressure', 'heartRate'] });
valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-local-data-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('0043361001000000010000001000000075315f32303236303130313031303130315f68722e747874000000').buffer
});
const multiTypeLocalDataAliasParsed = await pendingMultiTypeLocalDataAlias;

if (
  String(writtenHex[0] || '').slice(4, 8) !== '3610' ||
  multiTypeLocalDataAliasParsed.type !== 'local_data' ||
  multiTypeLocalDataAliasParsed.status !== 'file_list' ||
  multiTypeLocalDataAliasParsed.selectedFileCount !== 1 ||
  multiTypeLocalDataAliasParsed.filteredFileCount !== 0 ||
  JSON.stringify(multiTypeLocalDataAliasParsed.dataTypes) !== JSON.stringify(['blood_pressure', 'heart_rate']) ||
  multiTypeLocalDataAliasParsed.files?.[0]?.fileName !== 'u1_20260101010101_hr.txt'
) {
  throw new Error(
    `RW local_data alias should support multiple requested history data types from one file-list read: ${JSON.stringify({
      writtenHex,
      multiTypeLocalDataAliasParsed
    })}`
  );
}

const writeFailureEvents: unknown[] = [];
const writeFailureAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-write-fail',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB'
  }),
  onDisconnected: (reason: unknown) => writeFailureEvents.push(reason)
} as any);
writeShouldFail = true;
let writeFailureError: unknown;
try {
  await writeFailureAdapter.sendBatteryCommand();
} catch (error) {
  writeFailureError = error;
} finally {
  writeShouldFail = false;
}

if (!(writeFailureError instanceof Error) || writeFailureEvents.length !== 1) {
  throw new Error(
    `RW command writes should notify runtime on final write failure like L19: ${JSON.stringify({
      writeFailureError,
      writeFailureEvents
    })}`
  );
}

connectedDevices = [{ deviceId: 'rw-device' }];
if (!(await commandAdapter.isDeviceConnected('rw-device', '0000A00A-0000-1000-8000-00805F9B34FB'))) {
  throw new Error('RW adapter should report connected devices from getConnectedBluetoothDevices.');
}

connectedDevices = [];
rssiAvailable = true;
if (!(await commandAdapter.isDeviceConnected('rw-device', '0000A00A-0000-1000-8000-00805F9B34FB'))) {
  throw new Error('RW adapter should fall back to RSSI when connected-device lookup misses.');
}

rssiAvailable = false;
if (await commandAdapter.checkByRSSI('rw-device')) {
  throw new Error('RW adapter should resolve false when RSSI lookup fails.');
}
rssiAvailable = true;

const historyEvents: any[] = [];
const historyAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-history-device',
    uniMacId: 'ios-random-history-id',
    advertis: {
      macInfo: '3E:00:00:00:05:1B'
    },
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => {
    historyEvents.push(parsed);
  }
} as any);

historyAdapter.setupDataListener();
writtenHex.length = 0;
await historyAdapter.readLocalData({
  readAll: false,
  sinceTimestamp: Math.floor(new Date(2026, 0, 2).getTime() / 1000)
});

valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-history-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('0043361001000000010000001000000075315f32303236303130313031303130315f68722e747874000000').buffer
});

const historyFileList = historyEvents.find((event) => event.type === 'rw_file_list');
if (
  String(writtenHex[0] || '').slice(4, 8) !== '3610' ||
  historyFileList?.totalFileCount !== 1 ||
  historyFileList?.selectedFileCount !== 0 ||
  historyFileList?.filteredFileCount !== 1 ||
  historyFileList?.mac !== '3E:00:00:00:05:1B' ||
  historyFileList?.uniMacId !== '3E:00:00:00:05:1B' ||
  historyFileList?.advertis?.macInfo !== '3E:00:00:00:05:1B' ||
  historyFileList?.readAll !== false ||
  historyFileList?.selectedFiles?.length !== 0 ||
  historyFileList?.allFiles?.[0]?.fileName !== 'u1_20260101010101_hr.txt'
) {
  throw new Error(`RW file-list events should preserve L19-style read range intent: ${JSON.stringify({ writtenHex, historyFileList })}`);
}

historyEvents.length = 0;
writtenHex.length = 0;
await historyAdapter.sendNamedCommand(
  LegacyRingCommand.ReadLocalData,
  numberToUint32LE(Math.floor(new Date(2026, 0, 2).getTime() / 1000))
);

valueCallbacks[valueCallbacks.length - 1]?.({
  deviceId: 'rw-history-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
  value: hexToBytes('0044361001000000010000001000000075315f32303236303130313031303130315f68722e747874000000').buffer
});

const namedHistoryFileList = historyEvents.find((event) => event.type === 'rw_file_list');
if (
  String(writtenHex[0] || '').slice(4, 8) !== '3610' ||
  namedHistoryFileList?.readAll !== false ||
  namedHistoryFileList?.selectedFileCount !== 0 ||
  namedHistoryFileList?.filteredFileCount !== 1 ||
  namedHistoryFileList?.sinceTimestamp !== Math.floor(new Date(2026, 0, 2).getTime() / 1000)
) {
  throw new Error(
    `RW named ReadLocalData command should honor legacy timestamp payload like readLocalData options: ${JSON.stringify({
      writtenHex,
      namedHistoryFileList
    })}`
  );
}

const staleHistoryIntentEvents: any[] = [];
const staleHistoryIntentAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-stale-history-intent-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onParsedData: (parsed: any) => staleHistoryIntentEvents.push(parsed)
} as any);
staleHistoryIntentAdapter.setupDataListener();
const historyIntentOriginalDateNow = Date.now;
let historyIntentFakeNow = historyIntentOriginalDateNow();
Date.now = () => historyIntentFakeNow;
try {
  await staleHistoryIntentAdapter.readLocalData({
    readAll: true,
    dataType: 'blood_pressure'
  });
  historyIntentFakeNow += 15001;
  valueCallbacks[valueCallbacks.length - 1]?.({
    deviceId: 'rw-stale-history-intent-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    characteristicId: '0000B003-0000-1000-8000-00805F9B34FB',
    value: hexToBytes('0045361001000000010000001000000075315f32303236303130313031303130315f68722e747874000000').buffer
  });
} finally {
  Date.now = historyIntentOriginalDateNow;
}

const staleIntentFileList = staleHistoryIntentEvents.find((event) => event.type === 'rw_file_list');
const staleIntentLocalData = staleHistoryIntentEvents.find((event) => event.type === 'local_data');
if (
  staleIntentFileList?.dataType === 'blood_pressure' ||
  staleIntentFileList?.selectedFileCount === 0 ||
  staleIntentLocalData?.dataType === 'blood_pressure' ||
  staleIntentLocalData?.status === 'filtered'
) {
  throw new Error(
    `RW history read intent should expire so stale filters cannot claim later file lists: ${JSON.stringify(
      staleHistoryIntentEvents
    )}`
  );
}

let manualDisconnectEvents = 0;
const disconnectAdapter = createRwRingAdapter(state as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-manual-disconnect',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB'
  }),
  onDisconnected: () => {
    manualDisconnectEvents += 1;
  }
} as any);
await disconnectAdapter.disconnect();

if (manualDisconnectEvents !== 0 || !closedDeviceIds.includes('rw-manual-disconnect')) {
  throw new Error(
    `RW manual disconnect should match L19 by closing the connection without firing runtime onDisconnected: ${JSON.stringify({
      manualDisconnectEvents,
      closedDeviceIds
    })}`
  );
}

const staleConnectionEvents: string[] = [];
connectionStateCallbacks.push(() => staleConnectionEvents.push('stale'));
const listenerReplaceAdapter = createRwRingAdapter(
  { devices: { value: [] as any[] }, isScanning: { value: false } } as any,
  { getDeviceInfo: () => ({ deviceId: 'rw-listener-replace' }) } as any
);
listenerReplaceAdapter.registerConnectionStateListener();

if (connectionStateCallbacks.length !== 1) {
  throw new Error(`RW registerConnectionStateListener should replace old global listeners like L19: ${connectionStateCallbacks.length}`);
}

connectionStateCallbacks[connectionStateCallbacks.length - 1]?.({ deviceId: 'rw-listener-replace', connected: true });
if (staleConnectionEvents.length !== 0) {
  throw new Error(`RW stale connection-state listener should not survive re-registration: ${JSON.stringify(staleConnectionEvents)}`);
}

connectionStateCallbacks.length = 0;
const openOnlyAdapter = createRwRingAdapter({ devices: { value: [] as any[] }, isScanning: { value: false } } as any);
await openOnlyAdapter.openBluetoothAdapter();
if (getConnectionStateCallbackCount() !== 0) {
  throw new Error(`RW openBluetoothAdapter should only open bluetooth like L19: ${getConnectionStateCallbackCount()}`);
}

await openOnlyAdapter.initBluetooth();
if (getConnectionStateCallbackCount() !== 1) {
  throw new Error(`RW initBluetooth should register the connection-state listener like L19: ${getConnectionStateCallbackCount()}`);
}

const connectionFilterState = {
  devices: { value: [] as any[] },
  isScanning: { value: false }
};
const connectionFilterEvents: any[] = [];
const connectionFilterAdapter = createRwRingAdapter(connectionFilterState as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-current-device',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onDisconnected: (reason: unknown) => connectionFilterEvents.push({ type: 'runtime', reason })
} as any);

connectionFilterAdapter.registerConnectionStateListener({
  onDisconnected: (deviceId) => connectionFilterEvents.push({ type: 'option', deviceId })
});
connectionStateCallbacks[connectionStateCallbacks.length - 1]?.({ deviceId: 'rw-other-device', connected: false });
connectionStateCallbacks[connectionStateCallbacks.length - 1]?.({ deviceId: 'rw-current-device', connected: false });

if (
  connectionFilterEvents.some((event) => event.deviceId === 'rw-other-device' || event.reason?.deviceId === 'rw-other-device') ||
  !connectionFilterEvents.some((event) => event.type === 'option' && event.deviceId === 'rw-current-device') ||
  !connectionFilterEvents.some((event) => event.type === 'runtime' && event.reason?.deviceId === 'rw-current-device')
) {
  throw new Error(
    `RW connection-state listener should filter by runtime current device like L19: ${JSON.stringify(connectionFilterEvents)}`
  );
}

let staleStableRuntimeDevice: any = {
  deviceId: '3E:00:00:00:05:1B',
  name: 'SY03',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  advertis: { macInfo: '3E:00:00:00:05:1B' }
};
const staleStableDisconnectEvents: any[] = [];
const staleStableDisconnectAdapter = createRwRingAdapter({ devices: { value: [] as any[] }, isScanning: { value: false } } as any, {
  getDeviceInfo: () => staleStableRuntimeDevice,
  onDeviceReady: (device: any) => {
    staleStableRuntimeDevice = device;
  },
  onDisconnected: (reason: unknown) => staleStableDisconnectEvents.push({ type: 'runtime', reason })
} as any);
staleStableDisconnectAdapter.registerConnectionStateListener({
  onDisconnected: (deviceId) => staleStableDisconnectEvents.push({ type: 'option', deviceId })
});
connectionStateCallbacks[connectionStateCallbacks.length - 1]?.({ deviceId: '3E:00:00:00:05:1B', connected: false });
if (staleStableDisconnectEvents.length !== 0) {
  throw new Error(
    `RW connection-state listener should ignore stale stable-MAC disconnects before a tracked platform connection exists: ${JSON.stringify(
      staleStableDisconnectEvents
    )}`
  );
}

await staleStableDisconnectAdapter.connectAndDiscover('rw-tracked-platform-device', 'SY03', {
  deviceId: 'rw-tracked-platform-device',
  name: 'SY03',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  advertis: { macInfo: '3E:00:00:00:05:1B' }
} as any);
staleStableDisconnectAdapter.registerConnectionStateListener({
  onDisconnected: (deviceId) => staleStableDisconnectEvents.push({ type: 'option', deviceId })
});
connectionStateCallbacks[connectionStateCallbacks.length - 1]?.({ deviceId: 'rw-tracked-platform-device', connected: false });
if (
  !staleStableDisconnectEvents.some((event) => event.type === 'option' && event.deviceId === 'rw-tracked-platform-device') ||
  !staleStableDisconnectEvents.some((event) => event.type === 'runtime' && event.reason?.deviceId === 'rw-tracked-platform-device')
) {
  throw new Error(
    `RW connection-state listener should still surface tracked platform disconnects after connect: ${JSON.stringify(
      staleStableDisconnectEvents
    )}`
  );
}

const adapterUnavailableState = {
  devices: { value: [] as any[] },
  isScanning: { value: false }
};
const adapterUnavailableEvents: any[] = [];
const adapterUnavailable = createRwRingAdapter(adapterUnavailableState as any, {
  getDeviceInfo: () => ({
    deviceId: 'rw-adapter-state',
    serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
    cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
    dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
  }),
  onBluetoothReadyChange: (ready: boolean) => adapterUnavailableEvents.push({ type: 'ready', ready }),
  onDisconnected: (reason: unknown) => adapterUnavailableEvents.push({ type: 'disconnected', reason })
} as any);

await adapterUnavailable.startScan({ timeoutMs: 1000 });
adapterUnavailable.setupDataListener();
if (adapterUnavailableState.isScanning.value !== true || valueCallbacks.length === 0 || adapterStateCallbacks.length === 0) {
  throw new Error(
    `RW adapter-state parity setup should start scan and listeners: ${JSON.stringify({
      isScanning: adapterUnavailableState.isScanning.value,
      valueCallbacks: valueCallbacks.length,
      adapterStateCallbacks: adapterStateCallbacks.length
    })}`
  );
}

adapterStateCallbacks[adapterStateCallbacks.length - 1]?.({ available: false, discovering: true });
await new Promise((resolve) => setTimeout(resolve, 0));

if (
  adapterUnavailableState.isScanning.value ||
  valueCallbacks.length !== 0 ||
  !adapterUnavailableEvents.some((event) => event.type === 'ready' && event.ready === false) ||
  !adapterUnavailableEvents.some((event) => event.type === 'disconnected' && event.reason?.reason === 'bluetooth_adapter_unavailable')
) {
  throw new Error(
    `RW adapter should mirror L19 when Bluetooth adapter becomes unavailable: ${JSON.stringify({
      isScanning: adapterUnavailableState.isScanning.value,
      valueCallbacks: valueCallbacks.length,
      adapterUnavailableEvents
    })}`
  );
}

export const rwAdapterParityPassed = true;

function hexToBytes(hex: string) {
  const clean = hex.replace(/\s+/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
