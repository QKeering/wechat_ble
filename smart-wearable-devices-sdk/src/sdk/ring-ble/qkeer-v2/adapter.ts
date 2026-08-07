import type { RingBleRuntime, RingBleState, RingDeviceInfo, RingParsedData } from '../types';
import type { LegacyRingAdapter, LegacyReadLocalDataOptions, LegacyScanOptions } from '../legacy/adapter';
import { LegacyRingCommand } from '../legacy/commands';
import bleManager from './vendor/common/ble_manager.js';
import bleCmd from './vendor/common/ble_cmd.js';
import bleConfig from './vendor/common/ble_config.js';
import { parseQkeerV2AdvertisInfo, resolveRingProtocol } from '../protocolRegistry';

type BluetoothDeviceFoundCallback = Parameters<typeof uni.onBluetoothDeviceFound>[0];

type Waiter = {
  predicate: (parsed: RingParsedData) => boolean;
  resolve: (parsed: RingParsedData) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type QkeerV2ScanItem = {
  device: RingDeviceInfo;
  advertis: Record<string, any>;
};

const offBluetoothDeviceFound = (callback: BluetoothDeviceFoundCallback) => {
  (uni.offBluetoothDeviceFound as unknown as (callback: BluetoothDeviceFoundCallback) => void)(callback);
};

export const createQkeerV2RingAdapter = (state: RingBleState, runtime?: RingBleRuntime): LegacyRingAdapter => {
  const scannedDevices = new Map<string, QkeerV2ScanItem>();
  const waiters: Waiter[] = [];
  let scanTimeout: ReturnType<typeof setTimeout> | null = null;
  let genericScanCallback: BluetoothDeviceFoundCallback | null = null;
  let connectionListenerRegistered = false;

  const emitParsed = (parsed: RingParsedData | null | undefined) => {
    if (!parsed?.type) return;
    const currentDevice = runtime?.getDeviceInfo?.();
    const currentDeviceRecord = currentDevice as Record<string, any> | undefined;
    const parsedWithDevice: RingParsedData = {
      ...parsed,
      protocol: 'qkeer-v2',
      deviceId: parsed.deviceId || bleManager.connectedDeviceId || currentDevice?.deviceId,
      deviceName: parsed.deviceName || currentDeviceRecord?.name || currentDeviceRecord?.displayName
    };
    runtime?.onParsedData?.(parsedWithDevice);

    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (!waiter.predicate(parsedWithDevice)) continue;

      clearTimeout(waiter.timer);
      waiters.splice(index, 1);
      waiter.resolve(parsedWithDevice);
    }
  };

  const setupDataListener = () => {
    (bleManager as any).setReceiverListener({
      [bleCmd.CMD_GET_DEVICE_INFO]: (_cmd: number, data: Record<string, any>) => {
        emitParsed(toBatteryParsed(data));
        emitParsed(toFirmwareParsed(data));
      },
      [bleCmd.CMD_SYNC_MEASURE]: (_cmd: number, data: Record<string, any>) => {
        emitParsed(toActiveMeasureParsed(data));
        emitParsed(toOxygenMeasureParsed(data));
      },
      [bleCmd.CMD_SYNC_LAST_DATA]: (_cmd: number, data: Record<string, any>) => {
        emitParsed(toBatteryParsed(data));
        emitParsed(toActiveMeasureParsed(data));
        emitParsed(toOxygenMeasureParsed(data));
        emitParsed(toTemperatureParsed(data));
        emitParsed(toDailySummaryParsed(data, 'qkeer_v2_last_data'));
        emitParsed(toSleepSummaryParsed(data, 'qkeer_v2_last_data'));
      },
      [bleCmd.CMD_SYNC_HEARTBEAT]: (_cmd: number, data: Record<string, any>) => {
        emitParsed(toBatteryParsed(data));
        emitParsed(toActiveMeasureParsed(data));
        emitParsed(toOxygenMeasureParsed(data));
        emitParsed(toTemperatureParsed(data));
        emitParsed(toDailySummaryParsed(data, 'qkeer_v2_heartbeat'));
      },
      [bleCmd.CMD_SYNC_STEP]: (_cmd: number, data: Record<string, any>) => {
        emitParsed(toStepParsed(data));
      },
      [bleCmd.CMD_SYNC_STEP_LIST]: (_cmd: number, data: Record<string, any> | Record<string, any>[]) => {
        emitParsed(toHistoryParsed('qkeer_v2_step_list', data, mapStepRecord));
      },
      [bleCmd.CMD_SYNC_SLEEP]: (_cmd: number, data: Record<string, any>) => {
        emitParsed(toSleepParsed(data));
      },
      [bleCmd.CMD_SYNC_SLEEP_LIST]: (_cmd: number, data: Record<string, any> | Record<string, any>[]) => {
        emitParsed(toHistoryParsed('qkeer_v2_sleep_list', data, mapSleepRecord));
      },
      [bleCmd.CMD_SYNC_HEALTH]: (_cmd: number, data: Record<string, any>) => {
        emitParsed(toHealthParsed(data));
      },
      [bleCmd.CMD_SYNC_HEALTH_LIST]: (_cmd: number, data: Record<string, any> | Record<string, any>[]) => {
        emitParsed(toHistoryParsed('qkeer_v2_health_list', data, mapHealthRecord));
      },
      [bleCmd.CMD_SYNC_MEASURE_TIMER]: (_cmd: number, data: Record<string, any>) => {
        emitParsed({
          type: 'collect_period_read',
          protocol: 'qkeer-v2',
          status: data?.isSuccess === 0 ? 'failed' : 'success',
          ...data
        });
      },
      [bleCmd.CMD_SYNC_ECG]: (_cmd: number, data: Record<string, any> | Record<string, any>[]) => {
        emitParsed(toHistoryParsed('qkeer_v2_ecg', data, (record) => record));
      },
      [bleCmd.CMD_SYNC_ENHANCE_SLEEP_SETTING]: (_cmd: number, data: Record<string, any>) => {
        emitParsed({ type: 'qkeer_v2_enhance_sleep_setting', protocol: 'qkeer-v2', ...data });
      },
      [bleCmd.CMD_SYNC_ENHANCE_SLEEP_READ]: (_cmd: number, data: Record<string, any>) => {
        emitParsed({ type: 'qkeer_v2_enhance_sleep_read', protocol: 'qkeer-v2', ...data });
      }
    });
  };

  const initBluetooth = async () => {
    const result = await bleManager.openBluetoothAdapter();
    registerConnectionStateListener();
    runtime?.onBluetoothReadyChange?.(true);
    return result;
  };

  const registerConnectionStateListener = () => {
    if (connectionListenerRegistered) {
      uni.offBLEConnectionStateChange();
    }
    connectionListenerRegistered = true;
    uni.onBLEConnectionStateChange((res) => {
      if (res.connected) return;
      if (bleManager.connectedDeviceId && res.deviceId !== bleManager.connectedDeviceId) return;
      runtime?.onDisconnected?.(res);
    });
  };

  const startScan = async (options: LegacyScanOptions = {}) => {
    await initBluetooth();
    if (scanTimeout) {
      clearTimeout(scanTimeout);
      scanTimeout = null;
    }
    if (!options.preserveDevices) {
      scannedDevices.clear();
      state.devices.value = [];
    }

    await bleManager.startBluetoothDevicesDiscovery();
    state.isScanning.value = true;
    scanTimeout = setTimeout(() => {
      void stopScan();
    }, options.timeoutMs ?? 20000);

    bleManager.onBluetoothDeviceFound((item: QkeerV2ScanItem) => {
      const device = item.device || {};
      const deviceId = device.deviceId;
      if (!deviceId) return;

      const mapped: RingDeviceInfo = {
        ...device,
        protocol: 'qkeer-v2',
        deviceId,
        name: device.name || device.localName || `QKeer V2 ${item.advertis?.macInfo || ''}`,
        displayName: device.name || device.localName || `QKeer V2 ${item.advertis?.macInfo || ''}`,
        mac: item.advertis?.macInfo,
        battery: item.advertis?.batteryLevel,
        serviceId: bleConfig.UUID_SERVICE_TARGET,
        advertis: item.advertis,
        sourceDevice: item
      };

      scannedDevices.set(deviceId, { device: mapped, advertis: item.advertis || {} });
      const next = state.devices.value.filter((existing) => existing.deviceId !== deviceId);
      next.push(mapped);
      state.devices.value = next;
    });

    if (genericScanCallback) offBluetoothDeviceFound(genericScanCallback);
    if (options.includeUnknown) {
      genericScanCallback = (result) => {
        const found = (result.devices || [])
          .map((device) => normalizeBusinessScanDevice(device as RingDeviceInfo))
          .filter((device) => isAllowedBusinessScanDevice(device, options));

        if (found.length === 0) return;

        const next = [...state.devices.value];
        for (const device of found) {
          const key = device.deviceId || device.uniMacId || device.mac || device.name;
          if (!key || next.some((item) => item.deviceId === device.deviceId || item.uniMacId === key || item.mac === key)) continue;
          next.push(device);
        }
        state.devices.value = next;
      };
      uni.onBluetoothDeviceFound(genericScanCallback);
    } else {
      genericScanCallback = null;
    }
  };

  const stopScan = async () => {
    if (scanTimeout) {
      clearTimeout(scanTimeout);
      scanTimeout = null;
    }
    if (genericScanCallback) {
      offBluetoothDeviceFound(genericScanCallback);
      genericScanCallback = null;
    }
    await bleManager.stopBluetoothDevicesDiscovery();
    state.isScanning.value = false;
  };

  const connectAndDiscover = async (deviceId: string, deviceName = 'QKeer V2 Ring', sourceDevice?: RingDeviceInfo) => {
    const scanned = scannedDevices.get(deviceId);
    const sourceScanItem = sourceDevice?.sourceDevice as QkeerV2ScanItem | undefined;
    const sourceRawDevice = sourceScanItem?.device || sourceDevice;
    const sourceAdvertis = sourceScanItem?.advertis || sourceDevice?.advertis || {};
    const fallbackName = deviceName || sourceRawDevice?.name || sourceRawDevice?.localName || 'QKeer V2 Ring';
    const device = {
      ...(sourceRawDevice || {}),
      ...(scanned?.device || {}),
      deviceId,
      name: scanned?.device?.name || sourceRawDevice?.name || fallbackName,
      localName: scanned?.device?.localName || sourceRawDevice?.localName || fallbackName
    };
    const advertis = scanned?.advertis || sourceAdvertis || {};

    await stopScan();
    await bleManager.createBLEConnection({ device, advertis });
    setupDataListener();

    const connected: RingDeviceInfo = {
      ...device,
      protocol: 'qkeer-v2',
      name: deviceName || device.name || device.localName,
      deviceId,
      mac: advertis.macInfo || device.mac,
      uniMacId: advertis.macInfo || sourceRawDevice?.uniMacId || scanned?.device?.uniMacId,
      advertis,
      serviceId: bleConfig.UUID_SERVICE_TARGET,
      cmdCharId: bleConfig.UUID_TARGET_CHARACTERISTIC,
      dataCharId: bleConfig.UUID_TARGET_NOTIFY,
      dataServiceId: bleConfig.UUID_SERVICE_TARGET,
      notifyEnabled: true
    };

    runtime?.onDeviceReady?.(connected);
    return connected;
  };

  const waitForParsedData = (predicate: (parsed: RingParsedData) => boolean, timeoutMs = 12000) => {
    const promise = new Promise<RingParsedData>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((item) => item.timer === timer);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error('QKeer V2 parsed data wait timeout.'));
      }, timeoutMs);

      waiters.push({ predicate, resolve, reject, timer });
    });
    promise.catch(() => undefined);
    return promise;
  };

  const clearParsedWaiters = (message: string) => {
    waiters.splice(0).forEach((waiter) => {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    });
  };

  const clearDataListener = () => {
    clearParsedWaiters('QKeer V2 data listener was cleared.');
    (bleManager as any).setReceiverListener({});
  };

  const sendData = async (cmd: number, payload: unknown = {}) => {
    await bleManager.sendData(cmd, (payload && typeof payload === 'object' ? payload : {}) as any);
  };

  const readTimeRangePayload = (options: LegacyReadLocalDataOptions = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return {
      startTimestamp: options.readAll ? 0 : Math.floor((options.sinceTimestamp || Date.now()) / 1000),
      endTimestamp: now
    };
  };

  return {
    protocol: 'qkeer-v2',
    state,
    initBluetooth,
    openBluetoothAdapter: initBluetooth,
    registerConnectionStateListener,
    checkBluetoothState: async () => Boolean(bleManager.isBluetoothAvailable),
    startScan,
    stopScan,
    setMTU: async () => bleManager.setBLEMTU(),
    connectDevice: connectAndDiscover,
    connectAndDiscover,
    discoverServicesAndChars: connectAndDiscover,
    enableNotify: async () => true,
    checkByRSSI: async () => Boolean(bleManager.connectedDeviceId),
    isDeviceConnected: async (deviceId: string) => bleManager.connectedDeviceId === deviceId,
    cacheServiceId: () => undefined,
    getCachedServiceId: () => bleConfig.UUID_SERVICE_TARGET,
    disconnect: async (deviceId = bleManager.connectedDeviceId) => {
      clearDataListener();
      if (!deviceId) return true;
      const result = await bleManager.closeBLEConnection(deviceId);
      runtime?.onDisconnected?.();
      return result;
    },
    cleanup: async () => {
      await stopScan();
      if (connectionListenerRegistered) {
        connectionListenerRegistered = false;
        uni.offBLEConnectionStateChange();
      }
      clearDataListener();
    },
    sendBytes: async () => {
      throw new Error('QKeer V2 adapter sends structured SDK commands, not raw bytes.');
    },
    sendCommand: (cmd: number, _subcmd: number, payload?: unknown) => sendData(cmd, payload || {}),
    sendNamedCommand: (command: LegacyRingCommand, payload?: unknown) => {
      const commandMap: Partial<Record<LegacyRingCommand, number>> = {
        [LegacyRingCommand.Battery]: bleCmd.CMD_GET_DEVICE_INFO,
        [LegacyRingCommand.ActiveMeasure]: bleCmd.CMD_SYNC_MEASURE,
        [LegacyRingCommand.BloodOxygen]: bleCmd.CMD_SYNC_MEASURE,
        [LegacyRingCommand.BodyTemperature]: bleCmd.CMD_SYNC_LAST_DATA
      };
      const cmd = commandMap[command];
      if (cmd == null) throw new Error(`QKeer V2 command is not mapped: ${command}`);
      return sendData(cmd, payload || {});
    },
    waitForParsedData,
    setupDataListener,
    clearDataListener,
    sendBatteryCommand: () => sendData(bleCmd.CMD_GET_DEVICE_INFO, { version: 1 }),
    sendActiveMeasureCommand: () => sendData(bleCmd.CMD_SYNC_MEASURE, { measureHeartRate: true, open: true }),
    sendOxyGenCommand: () => sendData(bleCmd.CMD_SYNC_MEASURE, { measureSpo2: true, open: true }),
    sendBodyTemperatureCommand: () => sendData(bleCmd.CMD_SYNC_LAST_DATA, {}),
    sendFirmwareVersion: () => sendData(bleCmd.CMD_GET_DEVICE_INFO, { version: 1 }),
    sendSoftwareVersion: () => sendData(bleCmd.CMD_GET_DEVICE_INFO, { version: 1 }),
    sendReadLocalDataCommand: async (sinceTimestamp?: number, readAll?: boolean) => {
      const payload = readTimeRangePayload({ sinceTimestamp, readAll });
      await sendData(bleCmd.CMD_SYNC_HEALTH_LIST, payload);
      await sendData(bleCmd.CMD_SYNC_STEP_LIST, payload);
      await sendData(bleCmd.CMD_SYNC_SLEEP_LIST, payload);
    },
    readLocalData: async (options?: LegacyReadLocalDataOptions) => {
      const payload = readTimeRangePayload(options);
      await sendData(bleCmd.CMD_SYNC_HEALTH_LIST, payload);
      await sendData(bleCmd.CMD_SYNC_STEP_LIST, payload);
      await sendData(bleCmd.CMD_SYNC_SLEEP_LIST, payload);
    },
    readDeviceTime: async () => {
      emitParsed({ type: 'device_time', protocol: 'qkeer-v2', timestamp: Date.now(), timezone: 8 });
    },
    updateDeviceTime: async () => {
      emitParsed({ type: 'device_time', protocol: 'qkeer-v2', timestamp: Date.now(), timezone: 8 });
    },
    sendCollectPeriodSettingCommand: (seconds = 1800) =>
      sendData(bleCmd.CMD_SYNC_MEASURE_TIMER, {
        isSetup: true,
        enable: true,
        startHour: 0,
        startMin: 0,
        endHour: 23,
        endMin: 59,
        frequency: Math.max(1, Math.round(seconds / 60))
      }),
    readCollectPeriodCommand: async () => {
      emitParsed({ type: 'collect_period_read', protocol: 'qkeer-v2', period: 1800, minutes: 30 });
    },
    sendResetCommand: () => sendData(bleCmd.CMD_SYNC_RESET, {}),
    sendFactoryResetWithTimeCommand: () => sendData(bleCmd.CMD_SYNC_RESET, {}),
    sendDeleteAllLocalDataCommand: () => sendData(bleCmd.CMD_SYNC_RESET, {})
  };
};

function normalizeBusinessScanDevice(device: RingDeviceInfo): RingDeviceInfo {
  const protocol = resolveRingProtocol(device);
  return {
    ...device,
    protocol,
    name: device.name || device.localName,
    displayName: device.name || device.localName,
    advertis: protocol === 'qkeer-v2' ? device.advertis || parseQkeerV2AdvertisInfo(device) || undefined : device.advertis
  };
}

function isAllowedBusinessScanDevice(device: RingDeviceInfo, options: LegacyScanOptions) {
  if (!options.includeUnknown) return false;
  const protocol = resolveRingProtocol(device);
  if (protocol === 'rw' || protocol === 'qkeer-v2') return true;

  const name = `${device.name || device.localName || device.displayName || ''}`.toUpperCase();
  return ['HR', 'IF', 'QK', 'QKEERING', 'PPLUS', 'MUSLEEP_RING', 'QKV2'].some((prefix) => name.startsWith(prefix));
}

const toArray = (data: Record<string, any> | Record<string, any>[]) => {
  if (Array.isArray(data)) return data;
  return data ? [data] : [];
};

const timestampToUnixTime = (timestamp: unknown) => {
  if (typeof timestamp !== 'number') return undefined;
  return timestamp > 100000000000 ? Math.round(timestamp / 1000) : timestamp;
};

const mapHealthRecord = (record: Record<string, any>) => ({
  ...record,
  dataType: record.dataType || 'vital',
  unixTime: timestampToUnixTime(record.timestamp),
  heartRate: record.heartRate ?? record.heartrate,
  bloodOxygen: record.bloodOxygen ?? record.spo2,
  temperature: record.temperature
});

const mapStepRecord = (record: Record<string, any>) => ({
  ...record,
  unixTime: timestampToUnixTime(record.timestamp),
  step: record.step,
  stepCount: record.step
});

const sleepStatusText: Record<number, string> = {
  0: '进入睡眠',
  1: '浅睡',
  2: '深睡',
  3: '清醒',
  4: 'REM',
  5: '退出睡眠'
};

const mapSleepRecord = (record: Record<string, any>) => ({
  ...record,
  unixTime: timestampToUnixTime(record.timestamp),
  sleepType: record.type,
  sleepStatus: record.status,
  sleepStatusText: sleepStatusText[record.status],
  durationMinutes: record.timeLen
});

const toHistoryParsed = (
  type: string,
  data: Record<string, any> | Record<string, any>[],
  mapper: (record: Record<string, any>) => Record<string, any>
): RingParsedData => {
  const records = toArray(data).map(mapper);
  return {
    type,
    protocol: 'qkeer-v2',
    status: records.length > 0 ? 'success' : 'empty',
    records,
    totalNum: records.length,
    raw: []
  };
};

function toBatteryParsed(data: Record<string, any>): RingParsedData | null {
  if (data?.batteryLevel == null) return null;
  return {
    type: 'battery',
    protocol: 'qkeer-v2',
    value: data.batteryLevel,
    battery: data.batteryLevel,
    chargingStatus: data.isCharging,
    chargingStatusText: data.isCharging ? '充电中' : '未充电',
    raw: []
  };
}

function toFirmwareParsed(data: Record<string, any>): RingParsedData | null {
  if (!data?.hardVersion && !data?.softInfo) return null;
  return {
    type: 'firmware_version',
    protocol: 'qkeer-v2',
    firmwareVersion: data.hardVersion,
    hardwareVersion: data.hardVersion,
    softwareVersion: data.softInfo,
    uiVersion: data.softInfo,
    raw: []
  };
}

function toActiveMeasureParsed(data: Record<string, any>): RingParsedData | null {
  if (data?.heartRate == null) return null;
  return {
    type: 'active_measure',
    protocol: 'qkeer-v2',
    status: data.statusText,
    heartRate: data.heartRate,
    stressIndex: data.fatigue,
    fatigue: data.fatigue,
    fatigueLevel: data.fatigueLevel,
    anxiety: data.anxiety,
    anxietyLevel: data.anxietyLevel,
    alarmText: data.alarmText,
    alarmFlags: data.alarmFlags,
    raw: []
  };
}

function toOxygenMeasureParsed(data: Record<string, any>): RingParsedData | null {
  if (data?.spo2 == null) return null;
  return {
    type: 'active_OxyGenMeasure',
    protocol: 'qkeer-v2',
    status: data.statusText,
    heartRate: data.heartRate,
    bloodOxygen: data.spo2,
    fatigue: data.fatigue,
    fatigueLevel: data.fatigueLevel,
    anxiety: data.anxiety,
    anxietyLevel: data.anxietyLevel,
    alarmText: data.alarmText,
    alarmFlags: data.alarmFlags,
    raw: []
  };
}

function toTemperatureParsed(data: Record<string, any>): RingParsedData | null {
  if (data?.temperature == null) return null;
  return {
    type: 'active_Temperature',
    protocol: 'qkeer-v2',
    temperature: data.temperature,
    raw: []
  };
}

function toDailySummaryParsed(data: Record<string, any>, type: string): RingParsedData | null {
  if (data?.step == null && data?.isWorn == null && data?.fatigue == null && data?.anxiety == null) return null;
  return {
    type,
    protocol: 'qkeer-v2',
    step: data.step,
    stepCount: data.step,
    isWorn: data.isWorn,
    fatigue: data.fatigue,
    fatigueLevel: data.fatigueLevel,
    anxiety: data.anxiety,
    anxietyLevel: data.anxietyLevel,
    raw: []
  };
}

function toSleepSummaryParsed(data: Record<string, any>, type: string): RingParsedData | null {
  if (
    data?.sleepTotalMinutes == null &&
    data?.sleepDeepMinutes == null &&
    data?.sleepLightMinutes == null &&
    data?.sleepRemMinutes == null &&
    data?.sleepAwakeMinutes == null
  ) {
    return null;
  }

  return {
    type: `${type}_sleep`,
    protocol: 'qkeer-v2',
    sleepTotalMinutes: data.sleepTotalMinutes,
    sleepDeepMinutes: data.sleepDeepMinutes,
    sleepLightMinutes: data.sleepLightMinutes,
    sleepRemMinutes: data.sleepRemMinutes,
    sleepAwakeMinutes: data.sleepAwakeMinutes,
    raw: []
  };
}

function toStepParsed(data: Record<string, any>): RingParsedData | null {
  if (data?.step == null) return null;
  return {
    type: 'qkeer_v2_step',
    protocol: 'qkeer-v2',
    ...mapStepRecord(data),
    raw: []
  };
}

function toSleepParsed(data: Record<string, any>): RingParsedData | null {
  if (data?.timeLen == null && data?.status == null) return null;
  return {
    protocol: 'qkeer-v2',
    ...mapSleepRecord(data),
    type: 'qkeer_v2_sleep',
    raw: []
  };
}

function toHealthParsed(data: Record<string, any>): RingParsedData | null {
  if (data?.heartRate == null && data?.heartrate == null && data?.spo2 == null && data?.temperature == null) return null;
  return {
    type: 'qkeer_v2_health',
    protocol: 'qkeer-v2',
    ...mapHealthRecord(data),
    raw: []
  };
}
