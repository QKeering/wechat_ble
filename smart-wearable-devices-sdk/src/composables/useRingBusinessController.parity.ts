import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const storage = new Map<string, unknown>();

(globalThis as any).uni = {
  getSystemInfoSync: () => ({
    platform: 'android',
    system: 'Android 14',
    uniPlatform: 'mp-weixin'
  }),
  getSetting: ({ success }: any) => success({ authSetting: { 'scope.userLocation': true } }),
  getLocation: ({ success }: any) => success({}),
  openBluetoothAdapter: ({ success }: any) => success({}),
  startBluetoothDevicesDiscovery: ({ success }: any) => success({}),
  stopBluetoothDevicesDiscovery: ({ success }: any) => success({}),
  onBluetoothDeviceFound: () => undefined,
  offBluetoothDeviceFound: () => undefined,
  getBluetoothDevices: ({ success }: any) => success({ devices: [] }),
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => {
    storage.set(key, value);
  },
  removeStorageSync: (key: string) => {
    storage.delete(key);
  },
  notifyBLECharacteristicValueChange: ({ success }: any) => success({}),
  onBLECharacteristicValueChange: () => undefined,
  offBLECharacteristicValueChange: () => undefined,
  onBLEConnectionStateChange: () => undefined,
  offBLEConnectionStateChange: () => undefined
};

setActivePinia(createPinia());

const {
  getRingBusinessDeviceKey,
  getRingBusinessDeviceName,
  getRingBusinessDeviceTail,
  getRingBusinessPlatformDeviceId,
  useRingBusinessController
} = await import('./useRingBusinessController');
const { resolveRingProtocol } = await import('@/sdk/ring-ble');

type RingBusinessControllerCompat = ReturnType<typeof useRingBusinessController>;
type BusinessControllerKeys =
  | 'metrics'
  | 'businessDevices'
  | 'lastRefreshResult'
  | 'lastHistoryResult'
  | 'isRefreshingBusinessData'
  | 'isSyncingHistory'
  | 'isRestoringDevice'
  | 'refreshFailedText'
  | 'historyResultText'
  | 'isHistoryPending'
  | 'isReady'
  | 'businessDataAgeMs'
  | 'isBusinessDataStale'
  | 'businessDataFreshnessText'
  | 'stopScan'
  | 'restoreLastBusinessDevice'
  | 'scanForBusinessDevices'
  | 'connectBusinessDevice'
  | 'isCurrentBusinessDevice'
  | 'refreshBusinessData'
  | 'refreshDeviceInfoData'
  | 'syncBusinessHistory'
  | 'clearBusinessData'
  | 'enableHealthMonitoring'
  | 'pauseBusinessAutoRefresh'
  | 'resumeBusinessAutoRefresh';

type MissingBusinessControllerKeys = Exclude<BusinessControllerKeys, keyof RingBusinessControllerCompat>;
const assertNoMissingBusinessControllerKeys: MissingBusinessControllerKeys extends never ? true : never = true;

const controller = useRingBusinessController();
const controllerSource = readFileSync(join(process.cwd(), 'src', 'composables', 'useRingBusinessController.ts'), 'utf8');
const normalizedControllerSource = controllerSource.replace(/\r\n/g, '\n');
const RW_READY_FIELDS = {
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  notifyCandidates: [
    {
      serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
      characteristicId: '0000B003-0000-1000-8000-00805F9B34FB'
    }
  ]
};

const requiredKeys: BusinessControllerKeys[] = [
  'metrics',
  'businessDevices',
  'lastRefreshResult',
  'lastHistoryResult',
  'isRefreshingBusinessData',
  'isSyncingHistory',
  'isRestoringDevice',
  'refreshFailedText',
  'historyResultText',
  'isHistoryPending',
  'isReady',
  'businessDataAgeMs',
  'isBusinessDataStale',
  'businessDataFreshnessText',
  'stopScan',
  'restoreLastBusinessDevice',
  'scanForBusinessDevices',
  'connectBusinessDevice',
  'isCurrentBusinessDevice',
  'refreshBusinessData',
  'refreshDeviceInfoData',
  'syncBusinessHistory',
  'clearBusinessData',
  'enableHealthMonitoring',
  'pauseBusinessAutoRefresh',
  'resumeBusinessAutoRefresh'
];

for (const key of requiredKeys) {
  if (!(key in controller)) {
    throw new Error(`Business controller is missing ${key}.`);
  }
}

controller.normalizedData.value = [
  {
    sourceType: 'rw_file_list',
    metrics: {
      files: [{ fileName: '001_20260101000000_hr.txt' }],
      totalFileCount: 1,
      selectedFileCount: 1
    }
  }
] as any;
await nextTick();
if (!controller.isHistoryPending.value) {
  throw new Error(`Business controller should treat RW file-list transfer as pending: ${controller.metrics.value.historyStatus}`);
}

if (
  !normalizedControllerSource.includes("'history-sync-start'") ||
  !normalizedControllerSource.includes("'history-sync-result'") ||
  !normalizedControllerSource.includes("'history-sync-failed'") ||
  !normalizedControllerSource.includes('const RW_HISTORY_DEVICE_TIME_SYNC_DEDUP_MS = 10 * 60 * 1000;') ||
  !normalizedControllerSource.includes("const syncRwDeviceTimeAfterReady = async (phase: 'ready' | 'history'") ||
  !normalizedControllerSource.includes('const syncRwDeviceTimeBeforeHistory = (details: Record<string, unknown>) =>') ||
  !normalizedControllerSource.includes('`${phase}-device-time-sync-start`') ||
  !normalizedControllerSource.includes('`${phase}-device-time-sync-result`') ||
  !normalizedControllerSource.includes('`${phase}-device-time-sync-failed`') ||
  !normalizedControllerSource.includes('`${phase}-device-time-sync-skip`') ||
  !normalizedControllerSource.includes('await syncRwDeviceTimeBeforeHistory(requestedHistoryDetails);') ||
  !normalizedControllerSource.includes("await syncRwDeviceTimeAfterReady('ready'") ||
  !normalizedControllerSource.includes('await ble.updateDeviceTime(now, timezone);') ||
  !normalizedControllerSource.includes('interface SyncBusinessHistoryOptions') ||
  !normalizedControllerSource.includes('historyOptions: SyncBusinessHistoryOptions') ||
  !normalizedControllerSource.includes('const requestedDataTypes') ||
  !normalizedControllerSource.includes('dataTypes: requestedDataTypes') ||
  !normalizedControllerSource.includes('summarizeHistorySyncResult(result)') ||
  !normalizedControllerSource.includes('dataTypes: Array.from(new Set([...(summary.dataTypes || []), ...requestedDataTypes]))') ||
  !normalizedControllerSource.includes('selectedFileCount: parsed.selectedFileCount') ||
  !normalizedControllerSource.includes('filteredFileCount: parsed.filteredFileCount') ||
  !normalizedControllerSource.includes('recordCount: records.length')
) {
  throw new Error('RW business history sync should log typed compact start/result/failure summaries for true-device handoff diagnostics.');
}

controller.normalizedData.value = [
  {
    sourceType: 'rw_file_list',
    metrics: {
      files: [{ fileName: '001_20260101000000_hr.txt' }],
      totalFileCount: 1,
      selectedFileCount: 0,
      filteredFileCount: 1
    }
  }
] as any;
await nextTick();
if (controller.isHistoryPending.value) {
  throw new Error(`Business controller should not treat RW filtered history as pending: ${controller.metrics.value.historyStatus}`);
}

if (getRingBusinessDeviceName({ name: 'SY03' } as any) !== 'SY03') {
  throw new Error('Business device display name should prefer the advertised name.');
}

if (getRingBusinessDeviceName({ advertis: { macInfo: '3E:00:00:00:05:1B' } } as any) !== '3E:00:00:00:05:1B') {
  throw new Error('Business device display name should fall back to the stable ring identity.');
}

if (getRingBusinessDeviceTail({ advertis: { macInfo: '3E:00:00:00:05:1B' } } as any) !== '00:05:1B') {
  throw new Error('Business device tail should use the stable identity tail.');
}

if (
  getRingBusinessDeviceTail({
    protocol: 'rw',
    deviceId: 'wechat-random-platform-id',
    uniMacId: 'B09FBA121E1C',
    advertis: { macInfo: '3E:00:00:00:05:1B' },
    name: 'SY03'
  } as any) !== '00:05:1B' ||
  getRingBusinessDeviceKey({
    protocol: 'rw',
    deviceId: 'wechat-random-platform-id',
    uniMacId: 'B09FBA121E1C',
    advertis: { macInfo: '3E:00:00:00:05:1B' },
    name: 'SY03'
  } as any) !== '3E:00:00:00:05:1B'
) {
  throw new Error('Business controller should prefer RW advertis macInfo over random platform identifiers for display keys.');
}

if (
  getRingBusinessDeviceTail({ protocol: 'rw', uniMacId: 'B09FBA121E1C', name: 'SY03', RSSI: -55 } as any) !== '-' ||
  getRingBusinessDeviceKey({ protocol: 'rw', uniMacId: 'B09FBA121E1C', name: 'SY03', RSSI: -55 } as any) !== 'SY03--55'
) {
  throw new Error('Business controller should not expose random RW uniMacId values as stable display tails or business keys.');
}

if (
  getRingBusinessDeviceTail({ protocol: 'rw', deviceId: 'rw-platform-id', uniMacId: 'B09FBA121E1C', name: 'SY03' } as any) !==
    'tform-id' ||
  getRingBusinessDeviceKey({ protocol: 'rw', deviceId: 'rw-platform-id', uniMacId: 'B09FBA121E1C', name: 'SY03' } as any) !==
    'rw-platform-id'
) {
  throw new Error('Business controller should use RW platform deviceId as the non-stable fallback identity.');
}

if (getRingBusinessPlatformDeviceId({ uniMacId: '3E:00:00:00:05:1B', protocol: 'rw' } as any) !== '') {
  throw new Error('Business controller should not treat RW stable mac identities as platform BLE device ids.');
}

if (
  !normalizedControllerSource.includes('const platformDeviceId = getRingBusinessPlatformDeviceId(device);') ||
  !normalizedControllerSource.includes('deviceId: platformDeviceId') ||
  !normalizedControllerSource.includes('uniMacId: device.mac || device.advertis?.macInfo || device.uniMacId || stableIdentity')
) {
  throw new Error('Business controller should connect RW with the platform BLE deviceId while preserving stable mac identity.');
}

const freshnessStateController = useRingBusinessController({
  businessDataStaleMs: 5,
  businessDataFreshnessIntervalMs: 1,
  refreshTimeoutMs: 1,
  historyTimeoutMs: 1
});
freshnessStateController.deviceInfo.value = { deviceId: 'freshness-ring', serviceId: 'service', protocol: 'rw' } as any;
freshnessStateController.normalizedData.value = [
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
if (freshnessStateController.businessDataAgeMs.value == null || freshnessStateController.businessDataFreshnessText.value === '未读取') {
  throw new Error('Business controller should expose health data freshness once metrics have been read.');
}
await new Promise((resolve) => setTimeout(resolve, 15));
if (!freshnessStateController.isBusinessDataStale.value || !freshnessStateController.businessDataFreshnessText.value.includes('建议刷新')) {
  throw new Error(`Business controller should mark old health data stale: ${freshnessStateController.businessDataFreshnessText.value}`);
}

controller.devices.value = [
  { deviceId: 'rw-1', name: 'SY03', protocol: 'rw' },
  { deviceId: 'rw-bh3', name: 'BH3', protocol: 'rw' },
  { deviceId: 'rw-bh3-dash', name: 'BH3-001', protocol: 'rw' },
  { deviceId: 'rw-bh3-underscore', name: 'BH3_001', protocol: 'rw' },
  { deviceId: 'v2-1', name: 'MUSLEEP_RING_01', protocol: 'qkeer-v2' },
  { deviceId: 'legacy-1', name: 'QKeeRingL19', protocol: 'legacy' },
  { deviceId: 'other-1', name: 'Keyboard', protocol: 'legacy' }
];

const businessNames = controller.businessDevices.value.map((device) => device.name);
if (
  businessNames.length !== 6 ||
  !businessNames.includes('SY03') ||
  !businessNames.includes('BH3') ||
  !businessNames.includes('BH3-001') ||
  !businessNames.includes('BH3_001') ||
  !businessNames.includes('MUSLEEP_RING_01') ||
  !businessNames.includes('QKeeRingL19') ||
  businessNames.includes('Keyboard')
) {
  throw new Error(`Business controller should include supported ring devices including BH3: ${JSON.stringify(businessNames)}`);
}

controller.devices.value = [
  {
    deviceId: 'rw-advertis-only',
    name: '',
    advertisData: 'D60602008100523E000000051B8043443330336530303031',
    protocol: resolveRingProtocol({ advertisData: 'D60602008100523E000000051B8043443330336530303031' })
  } as any,
  {
    deviceId: 'rw-bh3-name-excluded',
    name: 'BH3',
    advertisData: 'D6060200810052351000001191804344433303353130303030',
    protocol: resolveRingProtocol({ name: 'BH3', advertisData: 'D6060200810052351000001191804344433303353130303030' })
  } as any,
  {
    deviceId: 'rw-bh3-dash-name-excluded',
    name: 'BH3-001',
    advertisData: 'D6060200810052351000001191804344433303353130303030',
    protocol: resolveRingProtocol({ name: 'BH3-001', advertisData: 'D6060200810052351000001191804344433303353130303030' })
  } as any
];
const advertisOnlyBusinessIds = controller.businessDevices.value.map((device) => device.deviceId);
if (
  !advertisOnlyBusinessIds.includes('rw-advertis-only') ||
  !advertisOnlyBusinessIds.includes('rw-bh3-name-excluded') ||
  !advertisOnlyBusinessIds.includes('rw-bh3-dash-name-excluded')
) {
  throw new Error(
    `Business controller should include RW advertis-only and BH3 devices: ${JSON.stringify(advertisOnlyBusinessIds)}`
  );
}

controller.devices.value = [
  { deviceId: 'fresh-rw', name: 'SY03', protocol: 'rw', lastSeenAt: Date.now() },
  { deviceId: 'stale-rw', name: 'SY03', protocol: 'rw', lastSeenAt: Date.now() - 120000 },
  { deviceId: 'legacy-no-seen', name: 'QKeeRingL19', protocol: 'legacy' }
];
controller.deviceInfo.value = { deviceId: 'stale-rw', serviceId: 'service', protocol: 'rw' } as any;
const freshBusinessIds = controller.businessDevices.value.map((device) => device.deviceId);
if (
  !freshBusinessIds.includes('fresh-rw') ||
  !freshBusinessIds.includes('stale-rw') ||
  !freshBusinessIds.includes('legacy-no-seen')
) {
  throw new Error(`Business controller should keep fresh devices, current stale devices, and legacy records without seen time: ${JSON.stringify(freshBusinessIds)}`);
}

controller.deviceInfo.value = {} as any;
const nonCurrentBusinessIds = controller.businessDevices.value.map((device) => device.deviceId);
if (nonCurrentBusinessIds.includes('stale-rw')) {
  throw new Error(`Business controller should hide stale non-current scan devices: ${JSON.stringify(nonCurrentBusinessIds)}`);
}

controller.deviceInfo.value = {
  deviceId: 'current-rw-platform',
  uniMacId: 'ios-random-uuid',
  advertis: { macInfo: '3E:00:00:00:05:1B' },
  protocol: 'rw'
} as any;
controller.devices.value = [
  {
    deviceId: 'stale-random-rw',
    name: 'SY03',
    protocol: 'rw',
    uniMacId: 'ios-random-uuid',
    lastSeenAt: Date.now() - 120000
  }
] as any;
if (controller.businessDevices.value.some((device) => device.deviceId === 'stale-random-rw')) {
  throw new Error(`Business controller should not keep stale RW scan rows by random uniMacId: ${JSON.stringify(controller.businessDevices.value)}`);
}

const freshnessController = useRingBusinessController({
  scanDeviceStaleMs: 5,
  scanFreshnessIntervalMs: 1,
  refreshTimeoutMs: 1,
  historyTimeoutMs: 1
});
freshnessController.devices.value = [
  { deviceId: 'auto-stale-rw', name: 'SY03', protocol: 'rw', lastSeenAt: Date.now() }
];
await freshnessController.scanForBusinessDevices();
if (!freshnessController.businessDevices.value.some((device) => device.deviceId === 'auto-stale-rw')) {
  throw new Error('Fresh scanned business device should be visible before it expires.');
}
await new Promise((resolve) => setTimeout(resolve, 20));
if (freshnessController.businessDevices.value.some((device) => device.deviceId === 'auto-stale-rw')) {
  throw new Error(`Business controller should auto-refresh scan freshness and hide expired devices: ${JSON.stringify(freshnessController.businessDevices.value)}`);
}
await freshnessController.stopScan();

controller.deviceInfo.value = { deviceId: 'ios-uuid', mac: '00:05:1B', protocol: 'rw' } as any;
if (!controller.isCurrentBusinessDevice({ deviceId: 'rw-scan-id', uniMacId: '00:05:1B', protocol: 'rw' })) {
  throw new Error('Business controller should match current device by mac/uniMacId.');
}
if (controller.isCurrentBusinessDevice({ deviceId: 'other-ring', uniMacId: '11:22:33', protocol: 'rw' })) {
  throw new Error('Business controller should not match a different scanned ring.');
}
if (
  controller.isCurrentBusinessDevice({
    deviceId: 'other-random-platform',
    uniMacId: 'ios-random-uuid',
    protocol: 'rw'
  } as any)
) {
  throw new Error('Business controller current-device matching should not trust random RW uniMacId values when the current ring has a stable MAC.');
}
if (
  !controller.isCurrentBusinessDevice({
    deviceId: 'ios-uuid',
    uniMacId: 'different-random-uuid',
    protocol: 'rw'
  } as any)
) {
  throw new Error('Business controller should keep the active RW platform deviceId compatible when the scan row lacks stable MAC.');
}
controller.deviceInfo.value = { deviceId: 'rw-session-platform-id', uniMacId: 'ios-random-uuid', protocol: 'rw' } as any;
if (!controller.isCurrentBusinessDevice({ deviceId: 'rw-session-platform-id', uniMacId: 'different-random-uuid', protocol: 'rw' } as any)) {
  throw new Error('Business controller should still recognize the same RW platform deviceId within the active BLE session.');
}
if (controller.isCurrentBusinessDevice({ deviceId: 'other-session-platform-id', uniMacId: 'ios-random-uuid', protocol: 'rw' } as any)) {
  throw new Error('Business controller should not match RW devices by random uniMacId when no stable MAC is available.');
}

const sameReadyController = useRingBusinessController({
  refreshTimeoutMs: 1,
  historyTimeoutMs: 1,
  rwMaintainRefreshIntervalMs: 100000
});
sameReadyController.deviceInfo.value = {
  deviceId: 'same-ready-ring',
  name: 'SY03',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
sameReadyController.normalizedData.value = [
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'heart_rate',
      value: 73,
      data: [73]
    }
  }
] as any;
await nextTick();
let sameReadyConnectCalled = false;
(sameReadyController.adapter as any).stopScan = async () => true;
(sameReadyController.adapter as any).connectAndDiscover = () => {
  sameReadyConnectCalled = true;
  return Promise.resolve({
    deviceId: 'same-ready-ring',
    name: 'SY03',
    ...RW_READY_FIELDS,
    protocol: 'rw'
  });
};
await sameReadyController.connectBusinessDevice(
  { deviceId: 'same-ready-ring', name: 'SY03', ...RW_READY_FIELDS, protocol: 'rw', lastSeenAt: Date.now() - 120000 } as any,
  { refreshAfterConnect: false }
);
await nextTick();
if (sameReadyConnectCalled || sameReadyController.metrics.value.heartRate !== 73) {
  throw new Error(
    `Business controller should not reconnect or clear data when the selected ring is already connected: ${JSON.stringify({
      sameReadyConnectCalled,
      metrics: sameReadyController.metrics.value
    })}`
  );
}

controller.deviceInfo.value = { deviceId: 'snapshot-rw', serviceId: 'service', protocol: 'rw' } as any;
await nextTick();
controller.normalizedData.value = [
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
] as any;
await nextTick();

controller.normalizedData.value = [
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'heart_rate',
      status: 'pending',
      message: 'pending'
    }
  },
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'blood_oxygen',
      status: 'pending',
      message: 'pending'
    }
  }
] as any;
await nextTick();

if (controller.metrics.value.heartRate !== 70 || controller.metrics.value.bloodOxygen !== 97) {
  throw new Error(`Business controller should keep the latest SY03 values while refresh is pending: ${JSON.stringify(controller.metrics.value)}`);
}

const switchController = useRingBusinessController({
  refreshTimeoutMs: 1,
  historyTimeoutMs: 1,
  bindDevice: async (payload) => payload
});
switchController.normalizedData.value = [
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'heart_rate',
      value: 88,
      data: [88]
    }
  }
] as any;
await nextTick();
if (switchController.metrics.value.heartRate !== 88) {
  throw new Error(`Business controller switch setup should expose previous metrics: ${JSON.stringify(switchController.metrics.value)}`);
}
(switchController.adapter as any).stopScan = async () => true;
(switchController.adapter as any).connectAndDiscover = () =>
  Promise.resolve({
    deviceId: 'new-legacy-ring',
    name: 'QKeeRingL19',
    serviceId: 'service',
    cmdCharId: 'write',
    dataCharId: 'notify',
    protocol: 'legacy'
  });
await switchController.connectBusinessDevice(
  { deviceId: 'new-legacy-ring', name: 'QKeeRingL19', protocol: 'legacy' },
  { refreshAfterConnect: false }
);
await nextTick();
if (switchController.metrics.value.heartRate !== null || switchController.normalizedData.value.length !== 0) {
  throw new Error(`Business controller should clear previous health data before connecting a new ring: ${JSON.stringify({
    metrics: switchController.metrics.value,
    normalizedData: switchController.normalizedData.value
  })}`);
}

if (!controllerSource.includes('fromScan: true')) {
  throw new Error('Business controller should mark scanned-list connections with fromScan for legacy/iOS deviceId handling.');
}

if (
  !normalizedControllerSource.includes('const RW_REFRESH_TIMEOUT_MS = 35000;') ||
  !normalizedControllerSource.includes('return options.refreshTimeoutMs ?? (isCurrentOrBoundRw() ? RW_REFRESH_TIMEOUT_MS : DEFAULT_REFRESH_TIMEOUT_MS);') ||
  !normalizedControllerSource.includes('const timeoutMs = getRefreshTimeoutMs();') ||
  !normalizedControllerSource.includes("const includeRealtimeMetrics =\n      refreshOptions.includeRealtimeMetrics ??\n      (isCurrentOrBoundRw() ? Boolean(refreshOptions.realtimeMetricNames?.length) : true);") ||
  !normalizedControllerSource.includes("const includeHistorySnapshot =\n      refreshOptions.includeHistorySnapshot ?? (isCurrentOrBoundRw() ? false : true);") ||
  !normalizedControllerSource.includes('const refreshTask = ble.refreshBusinessMetrics({\n      timeoutMs,\n      includeCollectPeriod: false,\n      includeDeviceTime: false,\n      includeDeviceInfo,\n      includeRealtimeMetrics,\n      realtimeMetricNames: refreshOptions.realtimeMetricNames,\n      includeHistorySnapshot\n    });') ||
  !normalizedControllerSource.includes('return ble.refreshBusinessMetrics({\n        timeoutMs,\n        includeCollectPeriod: true,\n        includeDeviceTime: false')
) {
  throw new Error('Business controller should pass the protocol-aware refresh timeout down to the unified SDK refresh workflow.');
}

if (
  !controllerSource.includes('const RW_RESTORE_TIMEOUT_MS = 75000;') ||
  !controllerSource.includes('const RW_CONNECT_TIMEOUT_MS = 60000;') ||
  !controllerSource.includes('const getCurrentOrBoundProtocol = () =>') ||
  !controllerSource.includes("const isCurrentOrBoundRw = () => getCurrentOrBoundProtocol() === 'rw';") ||
  !controllerSource.includes("return options.connectTimeoutMs ?? (protocol === 'rw' ? RW_CONNECT_TIMEOUT_MS : DEFAULT_CONNECT_TIMEOUT_MS);") ||
  !controllerSource.includes("return options.restoreTimeoutMs ?? (protocol === 'rw' ? RW_RESTORE_TIMEOUT_MS : DEFAULT_RESTORE_TIMEOUT_MS);") ||
  !controllerSource.includes("appendRingDiagnosticLog('RW FLOW', 'restore-start'") ||
  !controllerSource.includes("appendRingDiagnosticLog('RW FLOW', 'restore-timeout'") ||
  !controllerSource.includes("appendRingDiagnosticLog('RW FLOW', 'restore-result'")
) {
  throw new Error('Business controller should give RW connect/restore enough time and log each restore phase.');
}

if (
  !normalizedControllerSource.includes('metrics.value.firmwareVersion || metrics.value.hardwareVersion || metrics.value.softwareVersion || metrics.value.uiVersion') ||
  !normalizedControllerSource.includes('metrics.value.softwareVersion,\n      metrics.value.uiVersion')
) {
  throw new Error('Business controller should treat RW uiVersion as a resolved version snapshot for old-page device-info refreshes.');
}

if (controllerSource.includes('scheduledRequestId !== refreshRequestId')) {
  throw new Error('RW maintain refresh should not stop when a manual/restore refresh changes the request id.');
}

if (!controllerSource.includes('clearRwEmptyRefreshRetryTimer();')) {
  throw new Error('Business controller should clear RW empty-refresh retry timers when auto refresh is paused or cancelled.');
}

if (
  !controllerSource.includes('rwBackgroundRefreshEnabled?: boolean;') ||
  !normalizedControllerSource.includes('const rwBackgroundRefreshEnabled = options.rwBackgroundRefreshEnabled ?? false;') ||
  !normalizedControllerSource.includes("if (isCurrentOrBoundRw() && !rwBackgroundRefreshEnabled) {\n      clearRwPendingRetryTimer();\n      clearRwMaintainRefreshTimer();\n      clearRwEmptyRefreshRetryTimer();\n      return;\n    }")
) {
  throw new Error('RW background refresh must stay opt-in and resume should not schedule hidden RW reads when disabled.');
}

if (
  !normalizedControllerSource.includes("const includeRealtimeMetrics =\n      refreshOptions.includeRealtimeMetrics ??\n      (isCurrentOrBoundRw() ? Boolean(refreshOptions.realtimeMetricNames?.length) : true);") ||
  !normalizedControllerSource.includes("const includeHistorySnapshot =\n      refreshOptions.includeHistorySnapshot ?? (isCurrentOrBoundRw() ? false : true);") ||
  !normalizedControllerSource.includes('effectiveProtocol: getCurrentOrBoundProtocol()') ||
  !normalizedControllerSource.includes("if (!rwPendingRetryMetricNames?.length) {\n      rwPendingRetryCount = 0;\n      return;\n    }") ||
  !normalizedControllerSource.includes("await refreshBusinessDataSafely({\n        silent: true,\n        forceDeviceInfo: true,\n        includeRealtimeMetrics: false,\n        includeHistorySnapshot: false\n      });") ||
  !normalizedControllerSource.includes("await refreshBusinessDataSafely({\n        silent: true,\n        includeDeviceInfo: rwPendingRetryMetricNames?.length ? false : undefined,\n        includeHistorySnapshot: false,\n        realtimeMetricNames: rwPendingRetryMetricNames\n      });") ||
  !normalizedControllerSource.includes("includeRealtimeMetrics: false,\n          includeHistorySnapshot: false")
) {
  throw new Error('RW must not issue hidden all-metric realtime reads; realtime polling must stay opt-in by explicit metric names.');
}

if (
  !normalizedControllerSource.includes("if (shouldRecoverRwRefresh && isRwBusinessReady()) {\n      void refreshBusinessDataSafely({\n        silent: true,\n        forceDeviceInfo: true,\n        includeRealtimeMetrics: false,\n        includeHistorySnapshot: false\n      });\n      return;\n    }") ||
  !normalizedControllerSource.includes("if (isReady.value && shouldAutoRefresh()) {\n      void refreshBusinessDataSafely({ silent: true });\n      return;\n    }")
) {
  throw new Error('RW refresh recovery should be device-info only, while the generic auto-refresh branch stays separate.');
}

if (
  !controllerSource.includes("if (step === 'battery') return ok.includes('battery') || ok.includes('battery_cached');") ||
  !controllerSource.includes("if (step === 'firmware') return ok.includes('firmware') || ok.includes('firmware_cached');") ||
  !controllerSource.includes("if (step === 'software') return ok.includes('software') || ok.includes('software_cached');") ||
  !controllerSource.includes("appendRingDiagnosticLog('RW FLOW', 'device-info-resolved-from-data'")
) {
  throw new Error('Business controller should not treat RW device-info pending steps as completed refreshes.');
}

if (
  !controllerSource.includes("'battery_cached'") ||
  !controllerSource.includes("'software_cached'") ||
  !controllerSource.includes('...RW_REALTIME_METRIC_STEPS') ||
  !controllerSource.includes('hasRwFreshCoreMetricSnapshot(minMetricUpdateAt, minNormalizedDataLength)') ||
  !controllerSource.includes('const normalizedDataLengthAtStart = getNormalizedDataLength();') ||
  !controllerSource.includes('const hasRwCoreNormalizedDataSince = (minNormalizedDataLength: number)') ||
  !controllerSource.includes('RW_EMPTY_REFRESH_FINAL_GRACE_MS')
) {
  throw new Error('Business controller should treat RW cached device-info, realtime refreshes, and resolved metric snapshots as non-empty core results.');
}

if (
  !controllerSource.includes("'software_pending'") ||
  !controllerSource.includes("'software_command'") ||
  !controllerSource.includes("'software_command_pending'")
) {
  throw new Error('Business controller should keep RW software pending/command steps visible for device-info refreshes.');
}

if (
  !controllerSource.includes("ble.deviceInfo.value.protocol === 'rw'") ||
  !controllerSource.includes('hasBusinessCommunicationFields(ble.deviceInfo.value)') ||
  !controllerSource.includes('if (!isReady.value)') ||
  !controllerSource.includes('await ble.cancelPendingConnection();') ||
  !controllerSource.includes('await ble.cancelPendingConnection(platformDeviceId);')
) {
  throw new Error('Business controller should cancel the physical BLE attempt after restore/connect timeout and must not publish half-ready RW devices.');
}

if (
  !normalizedControllerSource.includes(
    "if (!isReady.value) {\n        const restored = await restoreLastBusinessDevice({ refreshAfterRestore: false });\n        if (!restored) {\n          throw new Error('\\u8bbe\\u5907\\u901a\\u4fe1\\u672a\\u5c31\\u7eea\\uff0c\\u8bf7\\u91cd\\u65b0\\u8fde\\u63a5\\u540e\\u518d\\u540c\\u6b65\\u5386\\u53f2');\n        }\n      }\n\n      const historyTask = ble.syncHistory({ readAll, deleteAfterUpload: false });"
  ) &&
  !normalizedControllerSource.includes(
    "if (!isReady.value) {\n        const restored = await restoreLastBusinessDevice({ refreshAfterRestore: false });\n        if (!restored) {\n          throw new Error('\\u8bbe\\u5907\\u901a\\u4fe1\\u672a\\u5c31\\u7eea\\uff0c\\u8bf7\\u91cd\\u65b0\\u8fde\\u63a5\\u540e\\u518d\\u540c\\u6b65\\u5386\\u53f2');\n        }\n      }\n\n      await syncRwDeviceTimeBeforeHistory(requestedHistoryDetails);\n\n      if (ble.deviceInfo.value.protocol === 'rw')"
  ) ||
  !normalizedControllerSource.includes('const historyTask = ble.syncHistory({') ||
  !normalizedControllerSource.includes('deleteAfterUpload: false')
) {
  throw new Error('Business controller history sync should restore or fail before issuing RW/L19 history commands from a half-ready device.');
}

if (
  !normalizedControllerSource.includes(
    "if (!isReady.value) {\n        const restored = await restoreLastBusinessDevice({ refreshAfterRestore: false });\n        if (!restored) {\n          throw new Error('\\u8bbe\\u5907\\u901a\\u4fe1\\u672a\\u5c31\\u7eea\\uff0c\\u8bf7\\u91cd\\u65b0\\u8fde\\u63a5\\u540e\\u518d\\u914d\\u7f6e\\u5065\\u5eb7\\u76d1\\u542c');\n        }\n      }\n\n      await ble.sendCollectPeriodSettingCommand(seconds);"
  )
) {
  throw new Error('Business controller health monitoring should restore or fail before issuing RW/L19 collect-period commands from a half-ready device.');
}

for (const fragment of [
  "isAutoRefreshPaused = false;\n      await syncRwDeviceTimeAfterReady('ready', {\n        reason: 'restore-already-ready'\n      });\n      if (refreshAfterRestore && shouldAutoRefresh() && ble.deviceInfo.value.protocol !== 'rw')",
  "isAutoRefreshPaused = false;\n        await syncRwDeviceTimeAfterReady('ready', {\n          reason: 'restore-success',\n          timeoutMs\n        });\n        if (refreshAfterRestore && ble.deviceInfo.value.protocol !== 'rw') {\n          await refreshBusinessDataSafely();",
  'cancelBusinessRequests();\n    isAutoRefreshPaused = false;'
]) {
  if (!normalizedControllerSource.includes(fragment)) {
    throw new Error(`Business controller should resume after restore/connect without automatic RW business reads: ${fragment}`);
  }
}

controller.lastRefreshResult.value = { status: 'partial', ok: ['battery'], failed: [] };
const secondController = useRingBusinessController();
if (secondController !== controller) {
  throw new Error('Default business controller calls should share one controller instance.');
}
if (secondController.lastRefreshResult.value?.ok[0] !== 'battery') {
  throw new Error('Default business controller calls should share refresh result state.');
}

controller.lastHistoryResult.value = {
  status: 'success',
  records: [{ unixTime: 1710000000 }],
  parsed: { type: 'local_data' },
  uploaded: true,
  deleted: false
};
controller.clearBusinessData();
await nextTick();

if (
  controller.lastRefreshResult.value !== null ||
  controller.lastHistoryResult.value !== null ||
  controller.metrics.value.heartRate !== null ||
  controller.metrics.value.bloodOxygen !== null
) {
  throw new Error('Business controller clearBusinessData should reset refresh and history state.');
}

const timeoutController = useRingBusinessController({ refreshTimeoutMs: 1, historyTimeoutMs: 1 });
if (timeoutController === controller) {
  throw new Error('Custom-option business controller calls should stay isolated from the default instance.');
}

const deviceInfoOnlyController = useRingBusinessController({ refreshTimeoutMs: 50, historyTimeoutMs: 1 });
deviceInfoOnlyController.deviceInfo.value = {
  deviceId: 'rw-device-info-only',
  mac: '3E:00:00:00:05:1B',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(deviceInfoOnlyController.adapter as any).protocol = 'rw';
const deviceInfoCalls: Record<string, number> = {
  battery: 0,
  firmware: 0,
  software: 0,
  heartRate: 0,
  bloodOxygen: 0,
  temperature: 0,
  collectPeriod: 0
};
(deviceInfoOnlyController.adapter as any).sendBatteryCommand = async () => {
  deviceInfoCalls.battery += 1;
};
(deviceInfoOnlyController.adapter as any).sendFirmwareVersion = async () => {
  deviceInfoCalls.firmware += 1;
};
(deviceInfoOnlyController.adapter as any).sendSoftwareVersion = async () => {
  deviceInfoCalls.software += 1;
};
(deviceInfoOnlyController.adapter as any).sendActiveMeasureCommand = async () => {
  deviceInfoCalls.heartRate += 1;
};
(deviceInfoOnlyController.adapter as any).sendOxyGenCommand = async () => {
  deviceInfoCalls.bloodOxygen += 1;
};
(deviceInfoOnlyController.adapter as any).sendBodyTemperatureCommand = async () => {
  deviceInfoCalls.temperature += 1;
};
(deviceInfoOnlyController.adapter as any).readCollectPeriodCommand = async () => {
  deviceInfoCalls.collectPeriod += 1;
};
(deviceInfoOnlyController.adapter as any).readLocalData = async () => undefined;
(deviceInfoOnlyController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean) => {
  const candidates = [
    { type: 'battery', battery: 66, value: '66%', protocol: 'rw' },
    { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' },
    { type: 'rw_file_list', totalFileCount: 0, selectedFileCount: 0, protocol: 'rw' }
  ];
  const parsed = candidates.find(predicate);
  return parsed ? Promise.resolve(parsed) : Promise.reject(new Error('no matching device-info packet'));
};
const deviceInfoOnlyResult = await deviceInfoOnlyController.refreshDeviceInfoData();
if (
  deviceInfoOnlyResult.status !== 'success' ||
  deviceInfoCalls.battery !== 1 ||
  deviceInfoCalls.firmware !== 1 ||
  deviceInfoCalls.software !== 0 ||
  deviceInfoCalls.heartRate !== 0 ||
  deviceInfoCalls.bloodOxygen !== 0 ||
  deviceInfoCalls.temperature !== 0 ||
  deviceInfoCalls.collectPeriod !== 0 ||
  !deviceInfoOnlyController.lastRefreshResult.value?.ok.includes('battery') ||
  !deviceInfoOnlyController.lastRefreshResult.value?.ok.includes('firmware') ||
  !deviceInfoOnlyController.lastRefreshResult.value?.ok.includes('software')
) {
  throw new Error(
    `Business controller refreshDeviceInfoData should read RW device info without triggering realtime measurement commands: ${JSON.stringify({
      result: deviceInfoOnlyResult,
      calls: deviceInfoCalls,
      last: deviceInfoOnlyController.lastRefreshResult.value
    })}`
  );
}

const pendingButParsedInfoController = useRingBusinessController({ refreshTimeoutMs: 300, historyTimeoutMs: 1 });
pendingButParsedInfoController.deviceInfo.value = {
  deviceId: 'rw-pending-but-parsed-info',
  mac: '3E:00:00:00:05:1B',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
pendingButParsedInfoController.normalizedData.value = [] as any;
(pendingButParsedInfoController.adapter as any).protocol = 'rw';
(pendingButParsedInfoController.adapter as any).sendBatteryCommand = async () => {
  pendingButParsedInfoController.normalizedData.value = [
    {
      sourceType: 'battery',
      metrics: { battery: 55, value: '55%', status: 'normal' }
    },
    {
      sourceType: 'firmware_version',
      metrics: { firmwareVersion: '2.2.9', softwareVersion: '303e0001', status: 'normal' }
    }
  ] as any;
};
(pendingButParsedInfoController.adapter as any).sendFirmwareVersion = async () => undefined;
(pendingButParsedInfoController.adapter as any).sendSoftwareVersion = async () => undefined;
(pendingButParsedInfoController.adapter as any).waitForParsedData = () => Promise.reject(new Error('waiter missed packet'));
const pendingButParsedInfoResult = await pendingButParsedInfoController.refreshDeviceInfoData();
if (
  pendingButParsedInfoResult.status !== 'success' ||
  !pendingButParsedInfoResult.ok.includes('battery') ||
  !pendingButParsedInfoResult.ok.includes('firmware') ||
  !pendingButParsedInfoResult.ok.includes('software') ||
  pendingButParsedInfoResult.ok.includes('battery_pending') ||
  pendingButParsedInfoResult.ok.includes('firmware_pending') ||
  pendingButParsedInfoResult.ok.includes('software_pending')
) {
  throw new Error(
    `Business controller should resolve RW device-info pending results from received data snapshots: ${JSON.stringify(
      pendingButParsedInfoResult
    )}`
  );
}

const restoreDeviceInfoController = useRingBusinessController({
  refreshTimeoutMs: 20,
  historyTimeoutMs: 1,
  getBoundDevice: async () => ({
    deviceId: 'restore-info-rw',
    mac: '3E:00:00:00:06:01',
    name: 'SY03',
    deviceName: 'SY03',
    protocol: 'rw'
  })
});
let restoreDeviceInfoConnectCalls = 0;
let restoreDeviceInfoBatteryCalls = 0;
(restoreDeviceInfoController.adapter as any).protocol = 'rw';
(restoreDeviceInfoController.adapter as any).connectAndDiscover = () => {
  restoreDeviceInfoConnectCalls += 1;
  return Promise.resolve({
    deviceId: 'restore-info-rw',
    name: 'SY03',
    mac: '3E:00:00:00:06:01',
    uniMacId: '3E:00:00:00:06:01',
    ...RW_READY_FIELDS,
    protocol: 'rw'
  });
};
(restoreDeviceInfoController.adapter as any).sendBatteryCommand = async () => {
  restoreDeviceInfoBatteryCalls += 1;
};
(restoreDeviceInfoController.adapter as any).sendFirmwareVersion = async () => undefined;
(restoreDeviceInfoController.adapter as any).sendSoftwareVersion = async () => undefined;
(restoreDeviceInfoController.adapter as any).sendActiveMeasureCommand = async () => undefined;
(restoreDeviceInfoController.adapter as any).sendOxyGenCommand = async () => undefined;
(restoreDeviceInfoController.adapter as any).sendBodyTemperatureCommand = async () => undefined;
(restoreDeviceInfoController.adapter as any).readCollectPeriodCommand = async () => undefined;
(restoreDeviceInfoController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean) => {
  const candidates = [
    { type: 'battery', battery: 64, value: '64%', protocol: 'rw', mac: '3E:00:00:00:06:01' },
    {
      type: 'firmware_version',
      firmwareVersion: '2.2.9',
      hardwareVersion: '2.2.9',
      softwareVersion: '303e0001',
      protocol: 'rw',
      mac: '3E:00:00:00:06:01'
    }
  ];
  const parsed = candidates.find(predicate);
  return parsed ? Promise.resolve(parsed) : Promise.reject(new Error('no matching restored device-info packet'));
};
const restoredDeviceInfoResult = await restoreDeviceInfoController.refreshDeviceInfoData();
if (
  !restoreDeviceInfoController.isReady.value ||
  restoreDeviceInfoConnectCalls !== 1 ||
  restoreDeviceInfoBatteryCalls < 1 ||
  !restoredDeviceInfoResult.ok.includes('battery') ||
  !restoreDeviceInfoController.lastRefreshResult.value?.ok.includes('battery')
) {
  throw new Error(
    `Business controller refreshDeviceInfoData should restore a bound RW device before reading battery/version: ${JSON.stringify({
      ready: restoreDeviceInfoController.isReady.value,
      connectCalls: restoreDeviceInfoConnectCalls,
      batteryCalls: restoreDeviceInfoBatteryCalls,
      result: restoredDeviceInfoResult,
      last: restoreDeviceInfoController.lastRefreshResult.value
    })}`
  );
}
restoreDeviceInfoController.clearBusinessData();

const staleDeviceInfoController = useRingBusinessController({ refreshTimeoutMs: 1, historyTimeoutMs: 1 });
staleDeviceInfoController.deviceInfo.value = {
  deviceId: 'stale-device-info-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(staleDeviceInfoController.adapter as any).protocol = 'rw';
(staleDeviceInfoController.adapter as any).sendBatteryCommand = () => new Promise(() => undefined);
(staleDeviceInfoController.adapter as any).sendFirmwareVersion = async () => undefined;
(staleDeviceInfoController.adapter as any).sendSoftwareVersion = async () => undefined;
(staleDeviceInfoController.adapter as any).waitForParsedData = () => new Promise(() => undefined);
const staleDeviceInfoRefresh = staleDeviceInfoController.refreshDeviceInfoData();
staleDeviceInfoController.clearBusinessData();
await staleDeviceInfoRefresh;
if (staleDeviceInfoController.lastRefreshResult.value !== null) {
  throw new Error(
    `Business controller should ignore stale device-info refresh results after clear: ${JSON.stringify(
      staleDeviceInfoController.lastRefreshResult.value
    )}`
  );
}

const silentTimeoutController = useRingBusinessController({ refreshTimeoutMs: 1, historyTimeoutMs: 1 });
silentTimeoutController.lastRefreshResult.value = { status: 'success', ok: ['battery'], failed: [] };
(silentTimeoutController.adapter as any).waitForParsedData = () => new Promise(() => undefined);
(silentTimeoutController.adapter as any).sendBatteryCommand = () => new Promise(() => undefined);
await silentTimeoutController.refreshBusinessData({ silent: true });
if (
  silentTimeoutController.lastRefreshResult.value?.failed.length !== 0 ||
  !silentTimeoutController.lastRefreshResult.value?.ok.includes('battery') ||
  silentTimeoutController.lastRefreshResult.value?.status !== 'partial'
) {
  throw new Error(
    `Silent business refresh timeouts should keep visible state non-failing: ${JSON.stringify(
      silentTimeoutController.lastRefreshResult.value
    )}`
  );
}

const staleController = useRingBusinessController({ refreshTimeoutMs: 1, historyTimeoutMs: 1 });
(staleController.adapter as any).waitForParsedData = () => new Promise(() => undefined);
(staleController.adapter as any).sendBatteryCommand = () => new Promise(() => undefined);
const staleRefresh = staleController.refreshBusinessData();
staleController.clearBusinessData();
await staleRefresh;
if (staleController.isRefreshingBusinessData.value || staleController.lastRefreshResult.value !== null) {
  throw new Error(
    `Business controller should ignore stale refresh results after clear: ${JSON.stringify({
      isRefreshing: staleController.isRefreshingBusinessData.value,
      last: staleController.lastRefreshResult.value
    })}`
  );
}

staleController.deviceInfo.value = { deviceId: 'stale-history-ready', ...RW_READY_FIELDS, protocol: 'rw' } as any;
(staleController.adapter as any).readLocalData = () => new Promise(() => undefined);
const staleHistory = staleController.syncBusinessHistory();
staleController.clearBusinessData();
await staleHistory;
if (staleController.isSyncingHistory.value || staleController.lastHistoryResult.value !== null) {
  throw new Error(
    `Business controller should ignore stale history results after clear: ${JSON.stringify({
      isSyncing: staleController.isSyncingHistory.value,
      last: staleController.lastHistoryResult.value
    })}`
  );
}

const staleHistoryRejectController = useRingBusinessController({ refreshTimeoutMs: 1, historyTimeoutMs: 20 });
staleHistoryRejectController.deviceInfo.value = { deviceId: 'stale-history-reject-ready', ...RW_READY_FIELDS, protocol: 'rw' } as any;
(staleHistoryRejectController.adapter as any).readLocalData = () =>
  new Promise((_, reject) => setTimeout(() => reject(new Error('stale history boom')), 5));
const staleHistoryReject = staleHistoryRejectController.syncBusinessHistory();
staleHistoryRejectController.clearBusinessData();
await staleHistoryReject;
if (staleHistoryRejectController.isSyncingHistory.value || staleHistoryRejectController.lastHistoryResult.value !== null) {
  throw new Error(
    `Business controller should swallow stale history errors after clear: ${JSON.stringify({
      isSyncing: staleHistoryRejectController.isSyncingHistory.value,
      last: staleHistoryRejectController.lastHistoryResult.value
    })}`
  );
}

const failingHistoryController = useRingBusinessController({ refreshTimeoutMs: 1, historyTimeoutMs: 20 });
failingHistoryController.deviceInfo.value = { deviceId: 'failing-history-ready', ...RW_READY_FIELDS, protocol: 'rw' } as any;
(failingHistoryController.adapter as any).waitForParsedData = () => new Promise(() => undefined);
(failingHistoryController.adapter as any).readLocalData = () => Promise.reject(new Error('history boom'));
let historyFailureThrown = false;
try {
  await failingHistoryController.syncBusinessHistory();
} catch (error) {
  historyFailureThrown = error instanceof Error && error.message === 'history boom';
}
if (
  !historyFailureThrown ||
  failingHistoryController.isSyncingHistory.value ||
  failingHistoryController.lastHistoryResult.value?.status !== 'failed' ||
  failingHistoryController.lastHistoryResult.value?.parsed?.message !== 'history boom' ||
  failingHistoryController.historyResultText.value !== '\u5386\u53f2\u540c\u6b65\u5931\u8d25'
) {
  throw new Error(
    `Business controller should expose visible history failure state while preserving page error handling: ${JSON.stringify({
      historyFailureThrown,
      isSyncing: failingHistoryController.isSyncingHistory.value,
      last: failingHistoryController.lastHistoryResult.value,
      text: failingHistoryController.historyResultText.value
    })}`
  );
}

const halfReadyHistoryController = useRingBusinessController({ refreshTimeoutMs: 1, historyTimeoutMs: 20, restoreTimeoutMs: 1 });
let halfReadyHistoryReadCount = 0;
halfReadyHistoryController.deviceInfo.value = { deviceId: 'half-ready-rw', serviceId: RW_READY_FIELDS.serviceId, protocol: 'rw' } as any;
(halfReadyHistoryController.adapter as any).readLocalData = () => {
  halfReadyHistoryReadCount += 1;
  return Promise.resolve();
};
let halfReadyHistoryFailed = false;
try {
  await halfReadyHistoryController.syncBusinessHistory();
} catch (error) {
  halfReadyHistoryFailed =
    error instanceof Error &&
    error.message === '\u8bbe\u5907\u901a\u4fe1\u672a\u5c31\u7eea\uff0c\u8bf7\u91cd\u65b0\u8fde\u63a5\u540e\u518d\u540c\u6b65\u5386\u53f2';
}

if (
  !halfReadyHistoryFailed ||
  halfReadyHistoryReadCount !== 0 ||
  halfReadyHistoryController.isSyncingHistory.value ||
  halfReadyHistoryController.lastHistoryResult.value?.status !== 'failed'
) {
  throw new Error(
    `Business controller should not issue RW/L19 history commands from a half-ready device: ${JSON.stringify({
      halfReadyHistoryFailed,
      halfReadyHistoryReadCount,
      isSyncing: halfReadyHistoryController.isSyncingHistory.value,
      last: halfReadyHistoryController.lastHistoryResult.value
    })}`
  );
}

const halfReadyMonitoringController = useRingBusinessController({ refreshTimeoutMs: 20, historyTimeoutMs: 1, restoreTimeoutMs: 1 });
let halfReadyMonitoringWriteCount = 0;
halfReadyMonitoringController.deviceInfo.value = { deviceId: 'half-ready-monitoring-rw', serviceId: RW_READY_FIELDS.serviceId, protocol: 'rw' } as any;
(halfReadyMonitoringController.adapter as any).sendCollectPeriodSettingCommand = () => {
  halfReadyMonitoringWriteCount += 1;
  return Promise.resolve();
};
let halfReadyMonitoringFailed = false;
try {
  await halfReadyMonitoringController.enableHealthMonitoring(1800);
} catch (error) {
  halfReadyMonitoringFailed =
    error instanceof Error &&
    error.message === '\u8bbe\u5907\u901a\u4fe1\u672a\u5c31\u7eea\uff0c\u8bf7\u91cd\u65b0\u8fde\u63a5\u540e\u518d\u914d\u7f6e\u5065\u5eb7\u76d1\u542c';
}

if (
  !halfReadyMonitoringFailed ||
  halfReadyMonitoringWriteCount !== 0 ||
  halfReadyMonitoringController.isRefreshingBusinessData.value
) {
  throw new Error(
    `Business controller should not issue RW/L19 health-monitoring commands from a half-ready device: ${JSON.stringify({
      halfReadyMonitoringFailed,
      halfReadyMonitoringWriteCount,
      isRefreshing: halfReadyMonitoringController.isRefreshingBusinessData.value,
      last: halfReadyMonitoringController.lastRefreshResult.value
    })}`
  );
}

const rwLongMonitoringController = useRingBusinessController({ refreshTimeoutMs: 20, historyTimeoutMs: 1, restoreTimeoutMs: 1 });
rwLongMonitoringController.deviceInfo.value = {
  deviceId: 'long-monitoring-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(rwLongMonitoringController.adapter as any).protocol = 'rw';
let rwLongMonitoringSeconds = 0;
const rwLongMonitoringWaitTimeouts: number[] = [];
(rwLongMonitoringController.adapter as any).sendCollectPeriodSettingCommand = async (seconds: number) => {
  rwLongMonitoringSeconds = seconds;
};
(rwLongMonitoringController.adapter as any).sendBatteryCommand = async () => undefined;
(rwLongMonitoringController.adapter as any).sendFirmwareVersion = async () => undefined;
(rwLongMonitoringController.adapter as any).sendSoftwareVersion = async () => undefined;
(rwLongMonitoringController.adapter as any).sendActiveMeasureCommand = async () => undefined;
(rwLongMonitoringController.adapter as any).sendOxyGenCommand = async () => undefined;
(rwLongMonitoringController.adapter as any).sendBodyTemperatureCommand = async () => undefined;
(rwLongMonitoringController.adapter as any).readCollectPeriodCommand = async () => undefined;
(rwLongMonitoringController.adapter as any).readLocalData = async () => undefined;
(rwLongMonitoringController.adapter as any).controlRwHealthData = async () => undefined;
(rwLongMonitoringController.adapter as any).readRwHealthData = async () => undefined;
(rwLongMonitoringController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean, timeoutMs?: number) => {
  rwLongMonitoringWaitTimeouts.push(timeoutMs || 0);
  const candidates = [
    { type: 'battery', value: 63, protocol: 'rw' },
    { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' },
    { type: 'rw_file_list', files: [], protocol: 'rw' },
    { type: 'rw_health_monitoring', name: 'heart_rate', protocol: 'rw' },
    { type: 'rw_health_monitoring', name: 'spo2', protocol: 'rw' },
    { type: 'rw_health_monitoring', name: 'hrv', protocol: 'rw' },
    { type: 'rw_health_monitoring', name: 'stress', protocol: 'rw' },
    { type: 'rw_health_monitoring', name: 'blood_sugar', protocol: 'rw' },
    { type: 'rw_health_monitoring', name: 'blood_pressure', protocol: 'rw' },
    { type: 'rw_health_monitoring', name: 'temperature', protocol: 'rw' },
    { type: 'rw_health_data', name: 'heart_rate', value: 70, data: [70], protocol: 'rw' },
    { type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' },
    { type: 'rw_health_data', name: 'temperature', value: 36.8, data: [112, 14], protocol: 'rw' },
    { type: 'rw_health_data', name: 'hrv', value: 42, data: [42], protocol: 'rw' },
    { type: 'rw_health_data', name: 'stress', value: 31, data: [31], protocol: 'rw' },
    { type: 'rw_health_data', name: 'blood_sugar', value: 92, data: [92], protocol: 'rw' },
    { type: 'rw_health_data', name: 'blood_pressure', value: { systolic: 120, diastolic: 80 }, data: [120, 80], protocol: 'rw' }
  ];
  const parsed = candidates.find(predicate);
  return parsed ? Promise.resolve(parsed) : Promise.reject(new Error('missing long monitoring candidate'));
};
await rwLongMonitoringController.enableHealthMonitoring(30);
if (
  rwLongMonitoringSeconds !== 30 ||
  Math.max(...rwLongMonitoringWaitTimeouts) > 3500 ||
  rwLongMonitoringController.metrics.value.heartRate !== null ||
  rwLongMonitoringController.metrics.value.bloodOxygen !== null ||
  rwLongMonitoringController.isRefreshingBusinessData.value
) {
  throw new Error(
    `RW health monitoring setup should not trigger an all-metric realtime measurement: ${JSON.stringify({
      seconds: rwLongMonitoringSeconds,
      timeouts: rwLongMonitoringWaitTimeouts,
      metrics: rwLongMonitoringController.metrics.value,
      isRefreshing: rwLongMonitoringController.isRefreshingBusinessData.value
    })}`
  );
}
rwLongMonitoringController.clearBusinessData();

const connectTimeoutController = useRingBusinessController({ connectTimeoutMs: 1, refreshTimeoutMs: 1, historyTimeoutMs: 1 });
(connectTimeoutController.adapter as any).stopScan = async () => true;
(connectTimeoutController.adapter as any).connectAndDiscover = () => new Promise(() => undefined);
let connectTimedOut = false;
try {
  await connectTimeoutController.connectBusinessDevice(
    { deviceId: 'connect-timeout', name: 'QKeeRingTimeout', protocol: 'legacy' },
    { refreshAfterConnect: false }
  );
} catch (error) {
  connectTimedOut = error instanceof Error && error.message === '连接超时，请重新连接';
}

if (!connectTimedOut || connectTimeoutController.isReady.value) {
  throw new Error(
    `Business controller should settle hanging manual connections: ${JSON.stringify({
      connectTimedOut,
      isReady: connectTimeoutController.isReady.value,
      deviceInfo: connectTimeoutController.deviceInfo.value
    })}`
  );
}

const staleConnectController = useRingBusinessController({
  scanDeviceStaleMs: 5,
  connectTimeoutMs: 1,
  refreshTimeoutMs: 1,
  historyTimeoutMs: 1
});
let staleConnectCalled = false;
(staleConnectController.adapter as any).stopScan = async () => true;
(staleConnectController.adapter as any).connectAndDiscover = () => {
  staleConnectCalled = true;
  return Promise.resolve({
    deviceId: 'expired-rw',
    name: 'SY03',
    serviceId: 'service',
    cmdCharId: 'write',
    dataCharId: 'notify',
    protocol: 'rw'
  });
};
let staleConnectRejected = false;
try {
  await staleConnectController.connectBusinessDevice(
    { deviceId: 'expired-rw', name: 'SY03', protocol: 'rw', lastSeenAt: Date.now() - 120000 },
    { refreshAfterConnect: false }
  );
} catch (error) {
  staleConnectRejected = error instanceof Error && error.message === '设备信号已过期，请重新搜索';
}

if (!staleConnectRejected || staleConnectCalled) {
  throw new Error(
    `Business controller should reject expired non-current scan devices before connecting: ${JSON.stringify({
      staleConnectRejected,
      staleConnectCalled
    })}`
  );
}

const lateConnectController = useRingBusinessController({ connectTimeoutMs: 1, refreshTimeoutMs: 1, historyTimeoutMs: 1 });
(lateConnectController.adapter as any).stopScan = async () => true;
(lateConnectController.adapter as any).connectAndDiscover = () =>
  new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          deviceId: 'late-connect',
          name: 'QKeeRingLate',
          serviceId: 'service',
          cmdCharId: 'write',
          dataCharId: 'notify',
          protocol: 'legacy'
        }),
      20
    )
  );
try {
  await lateConnectController.connectBusinessDevice(
    { deviceId: 'late-connect', name: 'QKeeRingLate', protocol: 'legacy' },
    { refreshAfterConnect: false }
  );
} catch {
  // expected timeout
}
await new Promise((resolve) => setTimeout(resolve, 40));
if (lateConnectController.isReady.value || lateConnectController.deviceInfo.value.deviceId) {
  throw new Error(
    `Business controller should ignore late connection success after timeout: ${JSON.stringify({
      isReady: lateConnectController.isReady.value,
      deviceInfo: lateConnectController.deviceInfo.value
    })}`
  );
}

const restoreController = useRingBusinessController({
  refreshTimeoutMs: 1,
  historyTimeoutMs: 1,
  getBoundDevice: async () => ({
    deviceId: 'restore-1',
    mac: 'restore-1',
    name: 'QKeeRingRestore',
    deviceName: 'QKeeRingRestore',
    protocol: 'legacy'
  })
});
let restoreCalls = 0;
(restoreController.adapter as any).connectAndDiscover = () => {
  restoreCalls += 1;
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          deviceId: 'restore-1',
          name: 'QKeeRingRestore',
          serviceId: 'service',
          cmdCharId: 'write',
          dataCharId: 'notify',
          protocol: 'legacy'
        }),
      5
    )
  );
};
(restoreController.adapter as any).waitForParsedData = () => new Promise(() => undefined);
(restoreController.adapter as any).sendBatteryCommand = () => new Promise(() => undefined);
const [firstRestore, secondRestore] = await Promise.all([
  restoreController.restoreLastBusinessDevice(),
  restoreController.restoreLastBusinessDevice()
]);

if (!firstRestore || !secondRestore || restoreCalls !== 1 || restoreController.isRestoringDevice.value) {
  throw new Error(
    `Business controller should share in-flight restore attempts: ${JSON.stringify({
      firstRestore,
      secondRestore,
      restoreCalls,
      isRestoring: restoreController.isRestoringDevice.value
    })}`
  );
}

const restoreTimeoutController = useRingBusinessController({
  refreshTimeoutMs: 1,
  historyTimeoutMs: 1,
  restoreTimeoutMs: 1,
  getBoundDevice: async () => ({
    deviceId: 'restore-timeout',
    mac: 'restore-timeout',
    name: 'QKeeRingTimeout',
    deviceName: 'QKeeRingTimeout',
    protocol: 'legacy'
  })
});
(restoreTimeoutController.adapter as any).connectAndDiscover = () => new Promise(() => undefined);
const timedOutRestore = await restoreTimeoutController.restoreLastBusinessDevice();
if (
  timedOutRestore ||
  restoreTimeoutController.isRestoringDevice.value ||
  restoreTimeoutController.lastRefreshResult.value?.failed[0]?.step !== 'restore'
) {
  throw new Error(
    `Business controller should settle hanging restore attempts: ${JSON.stringify({
      timedOutRestore,
      isRestoring: restoreTimeoutController.isRestoringDevice.value,
      last: restoreTimeoutController.lastRefreshResult.value
    })}`
  );
}

(timeoutController.adapter as any).waitForParsedData = () => new Promise(() => undefined);
(timeoutController.adapter as any).sendBatteryCommand = () => new Promise(() => undefined);

const timeoutRefresh = await timeoutController.refreshBusinessData();
if (
  timeoutRefresh.status !== 'partial' ||
  timeoutController.isRefreshingBusinessData.value ||
  timeoutController.lastRefreshResult.value?.failed[0]?.step !== 'refresh'
) {
  throw new Error(
    `Business controller should settle hanging refreshes: ${JSON.stringify({
      result: timeoutRefresh,
      isRefreshing: timeoutController.isRefreshingBusinessData.value,
      last: timeoutController.lastRefreshResult.value
    })}`
  );
}

const lateRefreshController = useRingBusinessController({ refreshTimeoutMs: 1, historyTimeoutMs: 1 });
(lateRefreshController.adapter as any).sendBatteryCommand = () => new Promise((resolve) => setTimeout(resolve, 20));
(lateRefreshController.adapter as any).waitForParsedData = () =>
  new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          type: 'battery',
          value: 88,
          protocol: 'legacy'
        }),
      20
    )
  );
await lateRefreshController.refreshBusinessData();
await new Promise((resolve) => setTimeout(resolve, 40));
if (
  lateRefreshController.lastRefreshResult.value?.failed[0]?.step !== 'refresh' ||
  lateRefreshController.isRefreshingBusinessData.value
) {
  throw new Error(
    `Business controller should not let late refresh task overwrite timeout result: ${JSON.stringify({
      isRefreshing: lateRefreshController.isRefreshingBusinessData.value,
      last: lateRefreshController.lastRefreshResult.value
    })}`
  );
}

const readySwitchRefreshController = useRingBusinessController({ refreshTimeoutMs: 100, historyTimeoutMs: 1 });
readySwitchRefreshController.deviceInfo.value = {
  deviceId: 'old-rw-ready',
  mac: '3E:00:00:00:05:1B',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(readySwitchRefreshController.adapter as any).protocol = 'rw';
(readySwitchRefreshController.adapter as any).sendBatteryCommand = async () => undefined;
(readySwitchRefreshController.adapter as any).sendFirmwareVersion = async () => undefined;
(readySwitchRefreshController.adapter as any).sendSoftwareVersion = async () => undefined;
(readySwitchRefreshController.adapter as any).sendActiveMeasureCommand = async () => undefined;
(readySwitchRefreshController.adapter as any).sendOxyGenCommand = async () => undefined;
(readySwitchRefreshController.adapter as any).sendBodyTemperatureCommand = async () => undefined;
(readySwitchRefreshController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean) =>
  new Promise((resolve, reject) =>
    setTimeout(() => {
      const candidates = [
        { type: 'battery', value: 62, protocol: 'rw' },
        { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' },
        { type: 'rw_health_data', name: 'heart_rate', value: 76, data: [76], protocol: 'rw' },
        { type: 'rw_health_data', name: 'blood_oxygen', value: 97, data: [97], protocol: 'rw' }
      ];
      const parsed = candidates.find(predicate);
      if (parsed) {
        resolve(parsed);
        return;
      }
      reject(new Error('missing ready-switch metric'));
    }, 20)
  );
const readySwitchRefresh = readySwitchRefreshController.refreshBusinessData();
await nextTick();
readySwitchRefreshController.deviceInfo.value = {
  deviceId: 'new-rw-ready',
  mac: '3E:00:00:00:06:2C',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
await nextTick();
await readySwitchRefresh;
if (
  readySwitchRefreshController.lastRefreshResult.value !== null ||
  readySwitchRefreshController.lastHistoryResult.value !== null ||
  readySwitchRefreshController.isRefreshingBusinessData.value
) {
  throw new Error(
    `Business controller should ignore in-flight RW refresh results after ready-to-ready device switch: ${JSON.stringify({
      lastRefresh: readySwitchRefreshController.lastRefreshResult.value,
      lastHistory: readySwitchRefreshController.lastHistoryResult.value,
      isRefreshing: readySwitchRefreshController.isRefreshingBusinessData.value
    })}`
  );
}

const singleFlightController = useRingBusinessController({ refreshTimeoutMs: 50, historyTimeoutMs: 50 });
let refreshCommandCount = 0;
(singleFlightController.adapter as any).sendBatteryCommand = () => {
  refreshCommandCount += 1;
  return new Promise((resolve) => setTimeout(resolve, 10));
};
(singleFlightController.adapter as any).waitForParsedData = () =>
  new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          type: 'battery',
          value: 80,
          protocol: 'legacy'
        }),
      10
    )
  );
const [singleFlightFirst, singleFlightSecond] = await Promise.all([
  singleFlightController.refreshBusinessData(),
  singleFlightController.refreshBusinessData()
]);

if (singleFlightFirst !== singleFlightSecond || refreshCommandCount !== 1 || singleFlightController.isRefreshingBusinessData.value) {
  throw new Error(
    `Business controller should reuse in-flight refreshes: ${JSON.stringify({
      same: singleFlightFirst === singleFlightSecond,
      refreshCommandCount,
      isRefreshing: singleFlightController.isRefreshingBusinessData.value
    })}`
  );
}

const silentRefreshController = useRingBusinessController({ refreshTimeoutMs: 50, historyTimeoutMs: 1 });
silentRefreshController.deviceInfo.value = {
  deviceId: 'silent-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(silentRefreshController.adapter as any).protocol = 'rw';
(silentRefreshController.adapter as any).sendBatteryCommand = async () =>
  new Promise((resolve) => setTimeout(resolve, 10));
(silentRefreshController.adapter as any).sendFirmwareVersion = async () => undefined;
(silentRefreshController.adapter as any).readCollectPeriodCommand = async () => undefined;
(silentRefreshController.adapter as any).sendActiveMeasureCommand = async () => undefined;
(silentRefreshController.adapter as any).sendOxyGenCommand = async () => undefined;
(silentRefreshController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean, timeoutMs?: number) => {
  const candidates = [
    { type: 'battery', value: 58, protocol: 'rw' },
    { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' },
    { type: 'rw_health_data', name: 'heart_rate', value: 69, data: [69], protocol: 'rw' },
    { type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' }
  ];
  const parsed = candidates.find(predicate);
  if (parsed) return Promise.resolve(parsed);
  return new Promise((_, reject) => setTimeout(() => reject(new Error('missing silent metric')), (timeoutMs || 1) + 1));
};
const silentRefresh = silentRefreshController.refreshBusinessData({ silent: true });
await nextTick();
if (silentRefreshController.isRefreshingBusinessData.value) {
  throw new Error('Silent RW refresh should not show foreground refreshing state.');
}
await silentRefresh;
if (silentRefreshController.isRefreshingBusinessData.value || silentRefreshController.lastRefreshResult.value?.status !== 'success') {
  throw new Error(
    `Silent RW refresh should update data and settle without foreground loading: ${JSON.stringify({
      isRefreshing: silentRefreshController.isRefreshingBusinessData.value,
      last: silentRefreshController.lastRefreshResult.value
    })}`
  );
}
silentRefreshController.clearBusinessData();

const boundRwProtocolFallbackController = useRingBusinessController({
  refreshTimeoutMs: 20,
  historyTimeoutMs: 1,
  rwMaintainRefreshIntervalMs: 1,
  rwPendingRetryMaxCount: 0
});
boundRwProtocolFallbackController.ringStore.setBoundDevice({
  deviceId: 'bound-rw-no-current-protocol',
  mac: '3E:00:00:00:05:1B',
  protocol: 'rw',
  name: 'SY03'
} as any);
boundRwProtocolFallbackController.deviceInfo.value = {
  deviceId: 'bound-rw-no-current-protocol',
  ...RW_READY_FIELDS
} as any;
(boundRwProtocolFallbackController.adapter as any).protocol = 'rw';
let boundRwFallbackRefreshCount = 0;
(boundRwProtocolFallbackController.adapter as any).sendBatteryCommand = async () => {
  boundRwFallbackRefreshCount += 1;
};
(boundRwProtocolFallbackController.adapter as any).sendActiveMeasureCommand = async () => {
  boundRwFallbackRefreshCount += 1;
};
boundRwProtocolFallbackController.resumeBusinessAutoRefresh();
await new Promise((resolve) => setTimeout(resolve, 40));
if (boundRwFallbackRefreshCount !== 0) {
  throw new Error(
    `RW bound-device protocol fallback should keep background refresh disabled when current protocol is temporarily missing: ${boundRwFallbackRefreshCount}`
  );
}
boundRwProtocolFallbackController.clearBusinessData();

const rwEmptyRecoveryController = useRingBusinessController({
  refreshTimeoutMs: 20,
  historyTimeoutMs: 1,
  rwEmptyRefreshRetryIntervalMs: 1,
  rwEmptyRefreshRetryMaxCount: 1,
  rwPendingRetryMaxCount: 0,
  rwMaintainRefreshIntervalMs: 100000
});
rwEmptyRecoveryController.deviceInfo.value = {
  deviceId: 'empty-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(rwEmptyRecoveryController.adapter as any).protocol = 'rw';
let rwEmptyRecoveryRefreshCount = 0;
(rwEmptyRecoveryController.adapter as any).sendBatteryCommand = async () => {
  rwEmptyRecoveryRefreshCount += 1;
};
(rwEmptyRecoveryController.adapter as any).sendFirmwareVersion = async () => undefined;
(rwEmptyRecoveryController.adapter as any).readCollectPeriodCommand = async () => undefined;
(rwEmptyRecoveryController.adapter as any).sendActiveMeasureCommand = async () => undefined;
(rwEmptyRecoveryController.adapter as any).sendOxyGenCommand = async () => undefined;
(rwEmptyRecoveryController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean, timeoutMs?: number) => {
  const candidates =
    rwEmptyRecoveryRefreshCount >= 1
      ? [
          { type: 'battery', value: 55, protocol: 'rw' },
          { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' },
          { type: 'rw_health_data', name: 'heart_rate', value: 68, data: [68], protocol: 'rw' },
          { type: 'rw_health_data', name: 'blood_oxygen', value: 97, data: [97], protocol: 'rw' }
        ]
      : [];
  const parsed = candidates.find(predicate);
  if (parsed) return Promise.resolve(parsed);
  return new Promise((_, reject) => setTimeout(() => reject(new Error('missing empty recovery metric')), (timeoutMs || 1) + 1));
};
await rwEmptyRecoveryController.refreshBusinessData({ silent: true });
await new Promise((resolve) => setTimeout(resolve, 80));
if (
  rwEmptyRecoveryRefreshCount !== 1 ||
  rwEmptyRecoveryController.lastRefreshResult.value?.failed.some((item) => item.step === 'rw_empty_refresh') ||
  rwEmptyRecoveryController.metrics.value.battery !== null ||
  rwEmptyRecoveryController.metrics.value.heartRate !== null ||
  rwEmptyRecoveryController.metrics.value.bloodOxygen !== null ||
  rwEmptyRecoveryController.isRefreshingBusinessData.value
) {
  throw new Error(
    `RW empty refresh should remain one-shot when no core data returns: ${JSON.stringify({
      refreshCount: rwEmptyRecoveryRefreshCount,
      metrics: rwEmptyRecoveryController.metrics.value,
      isRefreshing: rwEmptyRecoveryController.isRefreshingBusinessData.value,
      last: rwEmptyRecoveryController.lastRefreshResult.value
    })}`
  );
}
rwEmptyRecoveryController.clearBusinessData();

const rwSoftwareOnlyController = useRingBusinessController({
  refreshTimeoutMs: 20,
  historyTimeoutMs: 1,
  rwEmptyRefreshRetryIntervalMs: 1,
  rwEmptyRefreshRetryMaxCount: 1,
  rwPendingRetryMaxCount: 0,
  rwMaintainRefreshIntervalMs: 100000
});
rwSoftwareOnlyController.deviceInfo.value = {
  deviceId: 'software-only-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(rwSoftwareOnlyController.adapter as any).protocol = 'rw';
let rwSoftwareOnlyRefreshCount = 0;
(rwSoftwareOnlyController.adapter as any).sendBatteryCommand = async () => {
  rwSoftwareOnlyRefreshCount += 1;
};
(rwSoftwareOnlyController.adapter as any).sendFirmwareVersion = async () => undefined;
(rwSoftwareOnlyController.adapter as any).sendSoftwareVersion = async () => undefined;
(rwSoftwareOnlyController.adapter as any).readCollectPeriodCommand = async () => undefined;
(rwSoftwareOnlyController.adapter as any).sendActiveMeasureCommand = async () => undefined;
(rwSoftwareOnlyController.adapter as any).sendOxyGenCommand = async () => undefined;
(rwSoftwareOnlyController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean, timeoutMs?: number) => {
  const candidates = [{ type: 'softwareVersion', value: '303e0001', protocol: 'rw' }];
  const parsed = candidates.find(predicate);
  return parsed ? Promise.resolve(parsed) : new Promise((_, reject) => setTimeout(() => reject(new Error('software-only missing')), (timeoutMs || 1) + 1));
};
await rwSoftwareOnlyController.refreshBusinessData({ silent: true });
await new Promise((resolve) => setTimeout(resolve, 80));
if (
  rwSoftwareOnlyRefreshCount !== 1 ||
  rwSoftwareOnlyController.lastRefreshResult.value?.failed.some((item) => item.step === 'rw_empty_refresh') ||
  rwSoftwareOnlyController.metrics.value.softwareVersion !== '303e0001'
) {
  throw new Error(
    `RW software-only device-info refresh should not be treated as an empty refresh: ${JSON.stringify({
      refreshCount: rwSoftwareOnlyRefreshCount,
      metrics: rwSoftwareOnlyController.metrics.value,
      last: rwSoftwareOnlyController.lastRefreshResult.value
    })}`
  );
}
rwSoftwareOnlyController.clearBusinessData();

const rwEmptyExhaustedController = useRingBusinessController({
  refreshTimeoutMs: 20,
  historyTimeoutMs: 1,
  rwEmptyRefreshRetryIntervalMs: 1,
  rwEmptyRefreshRetryMaxCount: 1,
  rwPendingRetryMaxCount: 0,
  rwMaintainRefreshIntervalMs: 100000
});
rwEmptyExhaustedController.deviceInfo.value = {
  deviceId: 'empty-exhausted-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(rwEmptyExhaustedController.adapter as any).protocol = 'rw';
let rwEmptyExhaustedCount = 0;
(rwEmptyExhaustedController.adapter as any).sendBatteryCommand = async () => {
  rwEmptyExhaustedCount += 1;
};
(rwEmptyExhaustedController.adapter as any).sendFirmwareVersion = async () => undefined;
(rwEmptyExhaustedController.adapter as any).readCollectPeriodCommand = async () => undefined;
(rwEmptyExhaustedController.adapter as any).sendActiveMeasureCommand = async () => undefined;
(rwEmptyExhaustedController.adapter as any).sendOxyGenCommand = async () => undefined;
(rwEmptyExhaustedController.adapter as any).waitForParsedData = () => Promise.reject(new Error('still empty'));
await rwEmptyExhaustedController.refreshBusinessData({ silent: true });
await new Promise((resolve) => setTimeout(resolve, 380));
if (
  rwEmptyExhaustedCount !== 1 ||
  rwEmptyExhaustedController.lastRefreshResult.value?.failed.some((item) => item.step === 'rw_empty_refresh') ||
  rwEmptyExhaustedController.isRefreshingBusinessData.value
) {
  throw new Error(
    `RW empty refresh should settle without scheduling reconnect retries: ${JSON.stringify({
      refreshCount: rwEmptyExhaustedCount,
      last: rwEmptyExhaustedController.lastRefreshResult.value,
      text: rwEmptyExhaustedController.refreshFailedText.value
    })}`
  );
}
rwEmptyExhaustedController.clearBusinessData();

(timeoutController.adapter as any).readLocalData = () => new Promise(() => undefined);
timeoutController.deviceInfo.value = { deviceId: 'timeout-history-ready', ...RW_READY_FIELDS, protocol: 'rw' } as any;
const timeoutHistory = await timeoutController.syncBusinessHistory();
if (
  timeoutHistory.status !== 'history_timeout' ||
  timeoutController.isSyncingHistory.value ||
  timeoutController.lastHistoryResult.value?.status !== 'history_timeout' ||
  !timeoutController.historyResultText.value.includes('\u5386\u53f2\u540c\u6b65\u8d85\u65f6')
) {
  throw new Error(
    `Business controller should settle hanging history sync: ${JSON.stringify({
      result: timeoutHistory,
      isSyncing: timeoutController.isSyncingHistory.value,
      last: timeoutController.lastHistoryResult.value,
      text: timeoutController.historyResultText.value
    })}`
  );
}

timeoutController.lastHistoryResult.value = {
  status: 'filtered',
  records: [],
  parsed: {
    type: 'local_data',
    status: 'filtered',
    selectedFileCount: 0,
    filteredFileCount: 2
  },
  uploaded: false,
  deleted: false
};
if (!timeoutController.historyResultText.value.includes('\u8bfb\u53d6\u6761\u4ef6')) {
  throw new Error(`Business controller should explain filtered RW history: ${timeoutController.historyResultText.value}`);
}

timeoutController.lastHistoryResult.value = {
  status: 'success',
  records: [],
  parsed: {
    type: 'local_data',
    status: 'success'
  },
  uploaded: false,
  deleted: false
};
if (timeoutController.historyResultText.value !== '\u5386\u53f2\u540c\u6b65\u5b8c\u6210') {
  throw new Error(`Business controller should distinguish completed empty history sync from no result: ${timeoutController.historyResultText.value}`);
}

timeoutController.lastHistoryResult.value = {
  status: 'success',
  records: [{ unixTime: 1710000000 }, { unixTime: 1710000300 }],
  parsed: {
    type: 'local_data',
    status: 'success'
  },
  uploaded: true,
  deleted: false
};
if (!timeoutController.historyResultText.value.includes('2 \u6761\u5386\u53f2')) {
  throw new Error(`Business controller should show synced RW history count: ${timeoutController.historyResultText.value}`);
}

(timeoutController.adapter as any).sendCollectPeriodSettingCommand = () => new Promise(() => undefined);
await timeoutController.enableHealthMonitoring(1800);
if (timeoutController.isRefreshingBusinessData.value || timeoutController.lastRefreshResult.value?.failed[0]?.step !== 'refresh') {
  throw new Error(
    `Business controller should settle hanging health-monitoring setup: ${JSON.stringify({
      isRefreshing: timeoutController.isRefreshingBusinessData.value,
      last: timeoutController.lastRefreshResult.value
    })}`
  );
}
timeoutController.clearBusinessData();

const readyRefreshController = useRingBusinessController({ refreshTimeoutMs: 50, historyTimeoutMs: 1 });
readyRefreshController.deviceInfo.value = {
  deviceId: 'ready-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(readyRefreshController.adapter as any).protocol = 'rw';
let readyRefreshCommandCount = 0;
(readyRefreshController.adapter as any).sendBatteryCommand = async () => {
  readyRefreshCommandCount += 1;
};
(readyRefreshController.adapter as any).sendFirmwareVersion = async () => undefined;
(readyRefreshController.adapter as any).readCollectPeriodCommand = async () => undefined;
(readyRefreshController.adapter as any).sendActiveMeasureCommand = async () => undefined;
(readyRefreshController.adapter as any).sendOxyGenCommand = async () => undefined;
(readyRefreshController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean, timeoutMs?: number) => {
  const candidates = [
    { type: 'battery', value: 63, protocol: 'rw' },
    { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' },
    { type: 'rw_health_data', name: 'heart_rate', value: 70, data: [70], protocol: 'rw' },
    { type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' }
  ];
  const parsed = candidates.find(predicate);
  if (parsed) return Promise.resolve(parsed);
  return new Promise((_, reject) => setTimeout(() => reject(new Error('missing optional metric')), (timeoutMs || 1) + 1));
};

const readyRestoreFirst = await readyRefreshController.restoreLastBusinessDevice();
const readyRefreshAfterFirst = readyRefreshCommandCount;
const readyRestoreSecond = await readyRefreshController.restoreLastBusinessDevice();

if (!readyRestoreFirst || !readyRestoreSecond || readyRefreshAfterFirst !== 0 || readyRefreshCommandCount !== 0) {
  throw new Error(
    `Connected RW business entries should restore connection without automatic device-info or realtime reads: ${JSON.stringify({
      readyRestoreFirst,
      readyRestoreSecond,
      readyRefreshAfterFirst,
      readyRefreshCommandCount,
      last: readyRefreshController.lastRefreshResult.value
    })}`
  );
}

const incompleteReadyController = useRingBusinessController({ refreshTimeoutMs: 1, historyTimeoutMs: 1 });
incompleteReadyController.deviceInfo.value = {
  deviceId: 'incomplete-rw',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any;
await nextTick();
if (incompleteReadyController.isReady.value) {
  throw new Error('Business controller should not mark a half-discovered BLE device as ready without write and notify characteristics.');
}
incompleteReadyController.clearBusinessData();

const rwMissingCoreController = useRingBusinessController({
  refreshTimeoutMs: 30,
  historyTimeoutMs: 1,
  rwPendingRetryMaxCount: 0,
  rwMaintainRefreshIntervalMs: 100000
});
rwMissingCoreController.deviceInfo.value = {
  deviceId: 'missing-core-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(rwMissingCoreController.adapter as any).protocol = 'rw';
let rwMissingCoreRefreshCount = 0;
(rwMissingCoreController.adapter as any).sendBatteryCommand = async () => {
  rwMissingCoreRefreshCount += 1;
};
(rwMissingCoreController.adapter as any).sendActiveMeasureCommand = async () => {
  rwMissingCoreRefreshCount += 1;
};
(rwMissingCoreController.adapter as any).sendFirmwareVersion = async () => undefined;
(rwMissingCoreController.adapter as any).readCollectPeriodCommand = async () => undefined;
(rwMissingCoreController.adapter as any).sendOxyGenCommand = async () => undefined;
(rwMissingCoreController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean, timeoutMs?: number) => {
  const candidates = [
    { type: 'battery', value: 59, protocol: 'rw' },
    { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' },
    ...(rwMissingCoreRefreshCount >= 2
      ? [
          { type: 'rw_health_data', name: 'heart_rate', value: 69, data: [69], protocol: 'rw' },
          { type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' }
        ]
      : [])
  ];
  const parsed = candidates.find(predicate);
  if (parsed) return Promise.resolve(parsed);
  return new Promise((_, reject) => setTimeout(() => reject(new Error('missing core metric')), (timeoutMs || 1) + 1));
};

await rwMissingCoreController.restoreLastBusinessDevice();
await rwMissingCoreController.restoreLastBusinessDevice();
if (
  rwMissingCoreRefreshCount !== 0 ||
  rwMissingCoreController.lastRefreshResult.value !== null ||
  rwMissingCoreController.metrics.value.heartRate !== null ||
  rwMissingCoreController.metrics.value.bloodOxygen !== null
) {
  throw new Error(
    `Connected RW entries should not start device-info or realtime measurements during restore: ${JSON.stringify({
      rwMissingCoreRefreshCount,
      metrics: rwMissingCoreController.metrics.value,
      last: rwMissingCoreController.lastRefreshResult.value
    })}`
  );
}
rwMissingCoreController.clearBusinessData();

const rwTimeoutRecoveryController = useRingBusinessController({
  refreshTimeoutMs: 1,
  historyTimeoutMs: 1,
  rwPendingRetryMaxCount: 0,
  rwMaintainRefreshIntervalMs: 100000,
  rwBackgroundRefreshEnabled: true
});

if (
  !normalizedControllerSource.includes('forceDeviceInfo?: boolean') ||
  !normalizedControllerSource.includes('const includeDeviceInfo =\n      refreshOptions.includeDeviceInfo ??\n      (refreshOptions.forceDeviceInfo || !silent || !lastRefreshResult.value || !hasRwDeviceInfoCoreSnapshot());') ||
  !normalizedControllerSource.includes('includeDeviceInfo,\n      includeRealtimeMetrics,\n      realtimeMetricNames: refreshOptions.realtimeMetricNames,\n      includeHistorySnapshot') ||
  !normalizedControllerSource.includes('forceDeviceInfo: true,\n        includeRealtimeMetrics: false,\n        includeHistorySnapshot: false')
) {
  throw new Error('RW timeout recovery refresh should force device-info commands even when cached metrics exist.');
}

rwTimeoutRecoveryController.deviceInfo.value = {
  deviceId: 'timeout-recovery-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(rwTimeoutRecoveryController.adapter as any).protocol = 'rw';
let rwTimeoutRecoveryRefreshCount = 0;
(rwTimeoutRecoveryController.adapter as any).sendBatteryCommand = async () => {
  rwTimeoutRecoveryRefreshCount += 1;
};
(rwTimeoutRecoveryController.adapter as any).sendFirmwareVersion = async () => undefined;
(rwTimeoutRecoveryController.adapter as any).readCollectPeriodCommand = async () => undefined;
(rwTimeoutRecoveryController.adapter as any).sendActiveMeasureCommand = async () => undefined;
(rwTimeoutRecoveryController.adapter as any).sendOxyGenCommand = async () => undefined;
(rwTimeoutRecoveryController.adapter as any).waitForParsedData = () => new Promise(() => undefined);
await rwTimeoutRecoveryController.refreshBusinessData();
rwTimeoutRecoveryController.resumeBusinessAutoRefresh();
await new Promise((resolve) => setTimeout(resolve, 20));
if (rwTimeoutRecoveryRefreshCount < 2) {
  throw new Error(
    `RW business controller should retry immediately after a recent timeout when auto refresh resumes: ${JSON.stringify({
      rwTimeoutRecoveryRefreshCount,
      last: rwTimeoutRecoveryController.lastRefreshResult.value
    })}`
  );
}
rwTimeoutRecoveryController.clearBusinessData();

const rwRetryController = useRingBusinessController({
  refreshTimeoutMs: 20,
  historyTimeoutMs: 1,
  rwPendingRetryIntervalMs: 1,
  rwPendingRetryMaxCount: 2
});
rwRetryController.deviceInfo.value = {
  deviceId: 'retry-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(rwRetryController.adapter as any).protocol = 'rw';
let rwRetryRefreshCount = 0;
(rwRetryController.adapter as any).sendBatteryCommand = async () => {
  rwRetryRefreshCount += 1;
};
(rwRetryController.adapter as any).sendActiveMeasureCommand = async () => {
  rwRetryRefreshCount += 1;
};
(rwRetryController.adapter as any).sendFirmwareVersion = async () => undefined;
(rwRetryController.adapter as any).readCollectPeriodCommand = async () => undefined;
(rwRetryController.adapter as any).sendOxyGenCommand = async () => undefined;
(rwRetryController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean, timeoutMs?: number) => {
  const candidates = [
    { type: 'battery', value: 63, protocol: 'rw' },
    { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' },
    ...(rwRetryRefreshCount > 0
      ? [
          { type: 'rw_health_data', name: 'heart_rate', value: 71, data: [71], protocol: 'rw' },
          { type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' }
        ]
      : [])
  ];
  const parsed = candidates.find(predicate);
  if (parsed) return Promise.resolve(parsed);
  return new Promise((_, reject) => setTimeout(() => reject(new Error('missing retry metric')), (timeoutMs || 1) + 1));
};
await rwRetryController.refreshBusinessData({
  includeRealtimeMetrics: true,
  realtimeMetricNames: ['heart_rate'],
  includeHistorySnapshot: false
});
await new Promise((resolve) => setTimeout(resolve, 200));
if (rwRetryRefreshCount !== 2 || rwRetryController.isRefreshingBusinessData.value) {
  throw new Error(
    `RW business controller should issue the requested realtime metric only once: ${JSON.stringify({
      rwRetryRefreshCount,
      isRefreshing: rwRetryController.isRefreshingBusinessData.value,
      last: rwRetryController.lastRefreshResult.value
    })}`
  );
}
rwRetryController.clearBusinessData();

const rwExpandedRetryController = useRingBusinessController({
  refreshTimeoutMs: 20,
  historyTimeoutMs: 1,
  rwPendingRetryIntervalMs: 1,
  rwPendingRetryMaxCount: 2
});
rwExpandedRetryController.deviceInfo.value = {
  deviceId: 'expanded-retry-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(rwExpandedRetryController.adapter as any).protocol = 'rw';
let rwExpandedRetryRefreshCount = 0;
(rwExpandedRetryController.adapter as any).sendActiveMeasureCommand = async () => {
  rwExpandedRetryRefreshCount += 1;
};
(rwExpandedRetryController.adapter as any).sendBatteryCommand = async () => undefined;
(rwExpandedRetryController.adapter as any).sendFirmwareVersion = async () => undefined;
(rwExpandedRetryController.adapter as any).readCollectPeriodCommand = async () => undefined;
(rwExpandedRetryController.adapter as any).sendOxyGenCommand = async () => undefined;
(rwExpandedRetryController.adapter as any).controlRwHealthData = async (name: string) => {
  if (name === 'hrv') rwExpandedRetryRefreshCount += 1;
};
(rwExpandedRetryController.adapter as any).readRwHealthData = async () => undefined;
(rwExpandedRetryController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean, timeoutMs?: number) => {
  const candidates = [
    { type: 'battery', value: 63, protocol: 'rw' },
    { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' },
    { type: 'rw_health_data', name: 'heart_rate', value: 71, data: [71], protocol: 'rw' },
    { type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' },
    ...(rwExpandedRetryRefreshCount > 1
      ? [{ type: 'rw_health_data', name: 'hrv', value: 42, data: [42], protocol: 'rw' }]
      : [])
  ];
  const parsed = candidates.find(predicate);
  if (parsed) return Promise.resolve(parsed);
  return new Promise((_, reject) => setTimeout(() => reject(new Error('missing expanded retry metric')), (timeoutMs || 1) + 1));
};
await rwExpandedRetryController.refreshBusinessData({
  includeRealtimeMetrics: true,
  realtimeMetricNames: ['hrv'],
  includeHistorySnapshot: false
});
await new Promise((resolve) => setTimeout(resolve, 200));
if (
  rwExpandedRetryRefreshCount !== 1 ||
  rwExpandedRetryController.metrics.value.heartRate !== null ||
  rwExpandedRetryController.metrics.value.bloodOxygen !== null ||
  rwExpandedRetryController.isRefreshingBusinessData.value
) {
  throw new Error(
    `RW business controller should issue only the explicitly requested realtime metric once: ${JSON.stringify({
      rwExpandedRetryRefreshCount,
      isRefreshing: rwExpandedRetryController.isRefreshingBusinessData.value,
      metrics: rwExpandedRetryController.metrics.value,
      last: rwExpandedRetryController.lastRefreshResult.value
    })}`
  );
}
rwExpandedRetryController.clearBusinessData();

const rwOptionalBloodOxygenController = useRingBusinessController({
  refreshTimeoutMs: 5000,
  historyTimeoutMs: 1,
  rwPendingRetryIntervalMs: 1,
  rwPendingRetryMaxCount: 2,
  rwMaintainRefreshIntervalMs: 100000
});
rwOptionalBloodOxygenController.deviceInfo.value = {
  deviceId: 'optional-oxygen-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(rwOptionalBloodOxygenController.adapter as any).protocol = 'rw';
let rwOptionalBloodOxygenRefreshCount = 0;
(rwOptionalBloodOxygenController.adapter as any).sendBatteryCommand = async () => {
  rwOptionalBloodOxygenRefreshCount += 1;
};
(rwOptionalBloodOxygenController.adapter as any).sendActiveMeasureCommand = async () => {
  rwOptionalBloodOxygenRefreshCount += 1;
};
(rwOptionalBloodOxygenController.adapter as any).sendFirmwareVersion = async () => undefined;
(rwOptionalBloodOxygenController.adapter as any).readCollectPeriodCommand = async () => undefined;
(rwOptionalBloodOxygenController.adapter as any).sendOxyGenCommand = async () => {
  rwOptionalBloodOxygenRefreshCount += 1;
};
(rwOptionalBloodOxygenController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean, timeoutMs?: number) => {
  const candidates = [
    { type: 'battery', value: 61, protocol: 'rw' },
    { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' },
    { type: 'rw_health_data', name: 'heart_rate', value: 70, data: [70], protocol: 'rw' }
  ];
  const parsed = candidates.find(predicate);
  if (parsed) return Promise.resolve(parsed);
  return new Promise((_, reject) => setTimeout(() => reject(new Error('optional oxygen missing')), (timeoutMs || 1) + 1));
};
await rwOptionalBloodOxygenController.refreshBusinessData({
  includeDeviceInfo: false,
  includeRealtimeMetrics: true,
  realtimeMetricNames: ['blood_oxygen'],
  includeHistorySnapshot: false
});
await new Promise((resolve) => setTimeout(resolve, 80));
if (
  rwOptionalBloodOxygenRefreshCount !== 1 ||
  !rwOptionalBloodOxygenController.lastRefreshResult.value?.ok.includes('heart_rate_skipped') ||
  !rwOptionalBloodOxygenController.lastRefreshResult.value?.ok.includes('blood_oxygen_pending') ||
  rwOptionalBloodOxygenController.isRefreshingBusinessData.value
) {
  throw new Error(
    `RW controller should issue only one blood oxygen request when that metric is selected: ${JSON.stringify({
      rwOptionalBloodOxygenRefreshCount,
      isRefreshing: rwOptionalBloodOxygenController.isRefreshingBusinessData.value,
      metrics: rwOptionalBloodOxygenController.metrics.value,
      last: rwOptionalBloodOxygenController.lastRefreshResult.value
    })}`
  );
}
rwOptionalBloodOxygenController.clearBusinessData();

const rwMaintainController = useRingBusinessController({
  refreshTimeoutMs: 20,
  historyTimeoutMs: 1,
  rwMaintainRefreshIntervalMs: 1,
  rwPendingRetryMaxCount: 0
});
rwMaintainController.deviceInfo.value = {
  deviceId: 'maintain-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(rwMaintainController.adapter as any).protocol = 'rw';
let rwMaintainRefreshCount = 0;
(rwMaintainController.adapter as any).sendBatteryCommand = async () => {
  rwMaintainRefreshCount += 1;
};
(rwMaintainController.adapter as any).sendFirmwareVersion = async () => undefined;
(rwMaintainController.adapter as any).readCollectPeriodCommand = async () => undefined;
(rwMaintainController.adapter as any).sendActiveMeasureCommand = async () => {
  rwMaintainRefreshCount += 1;
};
(rwMaintainController.adapter as any).sendOxyGenCommand = async () => undefined;
(rwMaintainController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean, timeoutMs?: number) => {
  const candidates = [
    { type: 'battery', value: 62, protocol: 'rw' },
    { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' },
    { type: 'rw_health_data', name: 'heart_rate', value: 72, data: [72], protocol: 'rw' },
    { type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' }
  ];
  const parsed = candidates.find(predicate);
  if (parsed) return Promise.resolve(parsed);
  return new Promise((_, reject) => setTimeout(() => reject(new Error('missing maintain metric')), (timeoutMs || 1) + 1));
};
await rwMaintainController.restoreLastBusinessDevice();
const rwMaintainInitialRefreshCount = rwMaintainRefreshCount;
await new Promise((resolve) => setTimeout(resolve, 120));
if (rwMaintainRefreshCount !== rwMaintainInitialRefreshCount) {
  throw new Error(
    `RW business controller should keep maintain checks lightweight without automatic business refreshes: ${JSON.stringify({
      initial: rwMaintainInitialRefreshCount,
      rwMaintainRefreshCount,
      last: rwMaintainController.lastRefreshResult.value
    })}`
  );
}
rwMaintainController.clearBusinessData();
const rwMaintainStoppedAt = rwMaintainRefreshCount;
await new Promise((resolve) => setTimeout(resolve, 40));
if (rwMaintainRefreshCount !== rwMaintainStoppedAt) {
  throw new Error(
    `RW business controller should stop maintain refreshes after clear: ${JSON.stringify({
      before: rwMaintainStoppedAt,
      after: rwMaintainRefreshCount
    })}`
  );
}

const rwLifecycleController = useRingBusinessController({
  refreshTimeoutMs: 20,
  historyTimeoutMs: 1,
  rwMaintainRefreshIntervalMs: 1,
  rwPendingRetryMaxCount: 0
});
rwLifecycleController.deviceInfo.value = {
  deviceId: 'lifecycle-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(rwLifecycleController.adapter as any).protocol = 'rw';
let rwLifecycleRefreshCount = 0;
(rwLifecycleController.adapter as any).sendBatteryCommand = async () => {
  rwLifecycleRefreshCount += 1;
};
(rwLifecycleController.adapter as any).sendFirmwareVersion = async () => undefined;
(rwLifecycleController.adapter as any).readCollectPeriodCommand = async () => undefined;
(rwLifecycleController.adapter as any).sendActiveMeasureCommand = async () => {
  rwLifecycleRefreshCount += 1;
};
(rwLifecycleController.adapter as any).sendOxyGenCommand = async () => undefined;
(rwLifecycleController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean, timeoutMs?: number) => {
  const candidates = [
    { type: 'battery', value: 61, protocol: 'rw' },
    { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' },
    { type: 'rw_health_data', name: 'heart_rate', value: 73, data: [73], protocol: 'rw' },
    { type: 'rw_health_data', name: 'blood_oxygen', value: 99, data: [99], protocol: 'rw' }
  ];
  const parsed = candidates.find(predicate);
  if (parsed) return Promise.resolve(parsed);
  return new Promise((_, reject) => setTimeout(() => reject(new Error('missing lifecycle metric')), (timeoutMs || 1) + 1));
};
await rwLifecycleController.restoreLastBusinessDevice();
await new Promise((resolve) => setTimeout(resolve, 30));
rwLifecycleController.pauseBusinessAutoRefresh();
const rwLifecyclePausedAt = rwLifecycleRefreshCount;
await new Promise((resolve) => setTimeout(resolve, 40));
if (rwLifecycleRefreshCount !== rwLifecyclePausedAt) {
  throw new Error(
    `RW business controller should pause auto refresh while app is hidden: ${JSON.stringify({
      pausedAt: rwLifecyclePausedAt,
      after: rwLifecycleRefreshCount
    })}`
  );
}
rwLifecycleController.resumeBusinessAutoRefresh();
await new Promise((resolve) => setTimeout(resolve, 80));
if (rwLifecycleRefreshCount !== rwLifecyclePausedAt) {
  throw new Error(
    `RW business controller should resume lightweight RW maintain checks without automatic business refreshes: ${JSON.stringify({
      pausedAt: rwLifecyclePausedAt,
      after: rwLifecycleRefreshCount
    })}`
  );
}
rwLifecycleController.clearBusinessData();

const rwDisconnectController = useRingBusinessController({
  refreshTimeoutMs: 20,
  historyTimeoutMs: 1,
  rwMaintainRefreshIntervalMs: 1,
  rwPendingRetryMaxCount: 0
});
rwDisconnectController.deviceInfo.value = {
  deviceId: 'disconnect-rw',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(rwDisconnectController.adapter as any).protocol = 'rw';
let rwDisconnectRefreshCount = 0;
(rwDisconnectController.adapter as any).sendBatteryCommand = async () => {
  rwDisconnectRefreshCount += 1;
};
(rwDisconnectController.adapter as any).sendFirmwareVersion = async () => undefined;
(rwDisconnectController.adapter as any).readCollectPeriodCommand = async () => undefined;
(rwDisconnectController.adapter as any).sendActiveMeasureCommand = async () => {
  rwDisconnectRefreshCount += 1;
};
(rwDisconnectController.adapter as any).sendOxyGenCommand = async () => undefined;
(rwDisconnectController.adapter as any).waitForParsedData = (predicate: (parsed: any) => boolean, timeoutMs?: number) => {
  const candidates = [
    { type: 'battery', value: 60, protocol: 'rw' },
    { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' },
    { type: 'rw_health_data', name: 'heart_rate', value: 74, data: [74], protocol: 'rw' },
    { type: 'rw_health_data', name: 'blood_oxygen', value: 99, data: [99], protocol: 'rw' }
  ];
  const parsed = candidates.find(predicate);
  if (parsed) return Promise.resolve(parsed);
  return new Promise((_, reject) => setTimeout(() => reject(new Error('missing disconnect metric')), (timeoutMs || 1) + 1));
};
await rwDisconnectController.restoreLastBusinessDevice();
await new Promise((resolve) => setTimeout(resolve, 30));
rwDisconnectController.deviceInfo.value = {} as any;
await nextTick();
const rwDisconnectedAt = rwDisconnectRefreshCount;
await new Promise((resolve) => setTimeout(resolve, 40));
if (rwDisconnectRefreshCount !== rwDisconnectedAt) {
  throw new Error(
    `RW business controller should stop auto refresh when BLE connection state is cleared: ${JSON.stringify({
      disconnectedAt: rwDisconnectedAt,
      after: rwDisconnectRefreshCount
    })}`
  );
}

const inFlightDisconnectController = useRingBusinessController({
  refreshTimeoutMs: 20,
  historyTimeoutMs: 1,
  rwMaintainRefreshIntervalMs: 1000,
  rwPendingRetryMaxCount: 0
});
inFlightDisconnectController.deviceInfo.value = {
  deviceId: 'in-flight-disconnect',
  ...RW_READY_FIELDS,
  protocol: 'rw'
} as any;
(inFlightDisconnectController.adapter as any).protocol = 'rw';
(inFlightDisconnectController.adapter as any).sendBatteryCommand = () => new Promise(() => undefined);
(inFlightDisconnectController.adapter as any).sendFirmwareVersion = async () => undefined;
(inFlightDisconnectController.adapter as any).readCollectPeriodCommand = async () => undefined;
(inFlightDisconnectController.adapter as any).sendActiveMeasureCommand = async () => undefined;
(inFlightDisconnectController.adapter as any).sendOxyGenCommand = async () => undefined;
(inFlightDisconnectController.adapter as any).waitForParsedData = () => new Promise(() => undefined);
const inFlightRefresh = inFlightDisconnectController.refreshBusinessData();
await nextTick();
if (!inFlightDisconnectController.isRefreshingBusinessData.value) {
  throw new Error('Business controller should enter refreshing state before simulated disconnect.');
}
inFlightDisconnectController.deviceInfo.value = {} as any;
await nextTick();
if (inFlightDisconnectController.isRefreshingBusinessData.value) {
  throw new Error('Business controller should cancel in-flight refresh state as soon as connection is cleared.');
}
await inFlightRefresh;
if (inFlightDisconnectController.lastRefreshResult.value !== null) {
  throw new Error(
    `Business controller should ignore stale in-flight refresh result after disconnect: ${JSON.stringify(
      inFlightDisconnectController.lastRefreshResult.value
    )}`
  );
}

[
  controller,
  freshnessStateController,
  freshnessController,
  sameReadyController,
  switchController,
  timeoutController,
  deviceInfoOnlyController,
  restoreDeviceInfoController,
  staleDeviceInfoController,
  silentTimeoutController,
  staleController,
  staleHistoryRejectController,
  failingHistoryController,
  halfReadyHistoryController,
  halfReadyMonitoringController,
  rwLongMonitoringController,
  connectTimeoutController,
  staleConnectController,
  lateConnectController,
  restoreController,
  restoreTimeoutController,
  lateRefreshController,
  readySwitchRefreshController,
  singleFlightController,
  silentRefreshController,
  rwEmptyRecoveryController,
  rwSoftwareOnlyController,
  rwEmptyExhaustedController,
  readyRefreshController,
  incompleteReadyController,
  rwMissingCoreController,
  rwTimeoutRecoveryController,
  rwRetryController,
  rwExpandedRetryController,
  rwOptionalBloodOxygenController,
  rwMaintainController,
  rwLifecycleController,
  rwDisconnectController,
  inFlightDisconnectController
].forEach((createdController) => createdController.clearBusinessData());

export { assertNoMissingBusinessControllerKeys };
