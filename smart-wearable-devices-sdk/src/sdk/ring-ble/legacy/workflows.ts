import { RING_PARSED_EMITTED, type RingBleRuntime, type RingDeviceInfo, type RingParsedData } from '../types';
import type { LegacyRingAdapter } from './adapter';
import { syncRwHistoryFiles } from '../rw/history';
import { resolveRingProtocol } from '../protocolRegistry';

export interface EnsureBluetoothOptions {
  showToastOnFail?: boolean;
}

export interface ConnectLegacyRingOptions {
  deviceId: string;
  deviceName: string;
  uniMacId?: string;
  fromScan?: boolean;
  bindAfterConnected?: boolean;
  sourceDevice?: RingDeviceInfo;
}

export interface AutoReconnectOptions {
  maxAttempts?: number;
  delayMs?: number;
}

export interface SyncLegacyHistoryOptions {
  sinceTimestamp?: number;
  readAll?: boolean;
  dataType?: string;
  dataTypes?: string[];
  timeoutMs?: number;
  deleteAfterUpload?: boolean;
}

export interface SyncLegacyHistoryResult {
  status: string;
  records: Array<Record<string, any>>;
  parsed: RingParsedData;
  uploaded: boolean;
  deleted: boolean;
}

export interface RefreshLegacyBusinessMetricsOptions {
  timeoutMs?: number;
  includeDeviceTime?: boolean;
  includeCollectPeriod?: boolean;
  includeDeviceInfo?: boolean;
  includeRealtimeMetrics?: boolean;
  realtimeMetricNames?: string[];
  includeHistorySnapshot?: boolean;
}

export interface RefreshLegacyBusinessMetricsResult {
  status: 'success' | 'partial' | 'failed';
  ok: string[];
  failed: Array<{ step: string; message: string }>;
}

const getPlatform = () => {
  return `${uni.getSystemInfoSync().platform || ''}`.toLowerCase();
};

const isIOS = () => getPlatform().includes('ios');

const isColonSeparatedBleMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());
const getRwStableMacCandidate = (device?: RingDeviceInfo | null) => {
  if (!device) return '';
  return (
    device.mac ||
    device.advertis?.macInfo ||
    (isColonSeparatedBleMac(device.uniMacId) ? device.uniMacId : '') ||
    (isColonSeparatedBleMac(device.deviceId) ? device.deviceId : '')
  );
};

const getMacFromAdvertisData = (buffer?: ArrayBuffer | number[] | any[]) => {
  if (!buffer) return '';

  const bytes = Array.isArray(buffer) ? new Uint8Array(buffer) : new Uint8Array(buffer);
  if (bytes.byteLength < 6) return '';

  const hexArr = Array.from(bytes, (value) => value.toString(16).padStart(2, '0').toUpperCase());
  return hexArr.slice(-6).reverse().join(':');
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTaskTimeout = async <T>(task: Promise<T>, timeoutMs: number, message: string) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  task.catch(() => undefined);
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const showToast = (title: string) => {
  uni.showToast({ title, icon: 'none' });
};

const getLocation = () => {
  return new Promise<unknown>((resolve, reject) => {
    uni.getLocation({
      type: 'gcj02',
      success: resolve,
      fail: reject
    });
  });
};

const getSetting = () => {
  return new Promise<UniApp.GetSettingSuccessResult>((resolve, reject) => {
    uni.getSetting({
      success: resolve,
      fail: reject
    });
  });
};

const hasLocationPermission = (setting: UniApp.GetSettingSuccessResult) => {
  return Boolean(setting.authSetting?.['scope.userLocation']);
};

export const ensureLegacyBluetoothReady = async (
  adapter: LegacyRingAdapter,
  runtime?: RingBleRuntime,
  options: EnsureBluetoothOptions = {}
) => {
  const showToastOnFail = options.showToastOnFail ?? true;
  const systemInfo = uni.getSystemInfoSync();
  const isWeixin = systemInfo.uniPlatform === 'mp-weixin';

  try {
    if (isWeixin) {
      const setting = await getSetting();
      if (!hasLocationPermission(setting)) {
        await getLocation();
      }
    }

    const result = await adapter.initBluetooth();
    runtime?.onBluetoothReadyChange?.(true);
    return result;
  } catch (error: any) {
    runtime?.onBluetoothReadyChange?.(false);
    if (showToastOnFail) {
      showToast(error?.errMsg || '蓝牙初始化失败');
    }
    throw error;
  }
};

export const transformLegacyMacToUuid = (targetMac: string, timeoutMs = 10000) => {
  const formattedMac = targetMac.toUpperCase();

  return new Promise<string>((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      uni.stopBluetoothDevicesDiscovery();
      uni.offBluetoothDeviceFound();
    };

    uni.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: false,
      success: () => {
        uni.onBluetoothDeviceFound((result) => {
          for (const device of result.devices || []) {
            const currentMac = getMacFromAdvertisData(device.advertisData);
            if (currentMac !== formattedMac) continue;

            done = true;
            cleanup();
            resolve(device.deviceId);
            return;
          }
        });
      },
      fail: (error) => {
        cleanup();
        reject(error);
      }
    });

    timer = setTimeout(() => {
      if (done) return;
      cleanup();
      reject(new Error('转换超时，未发现匹配 MAC 的设备'));
    }, timeoutMs);
  });
};

export const connectLegacyRing = async (
  adapter: LegacyRingAdapter,
  runtime: RingBleRuntime | undefined,
  options: ConnectLegacyRingOptions
) => {
  if (!options.deviceId || !options.deviceName) {
    throw new Error('缺少设备 ID 或设备名称');
  }

  await adapter.stopScan();
  adapter.registerConnectionStateListener?.();

  let deviceId = options.deviceId;
  let bindMac =
    adapter.protocol === 'rw'
      ? getRwStableMacCandidate(options.sourceDevice) ||
        (isColonSeparatedBleMac(options.uniMacId) ? options.uniMacId || '' : '') ||
        (isColonSeparatedBleMac(options.deviceId) ? options.deviceId : '')
      : options.sourceDevice?.mac || options.sourceDevice?.advertis?.macInfo || options.uniMacId || options.deviceId;

  if (adapter.protocol === 'legacy' && isIOS() && options.fromScan) {
    deviceId = await transformLegacyMacToUuid(options.deviceId);
    bindMac = options.deviceId;
  }

  const deviceInfo = await adapter.connectAndDiscover(deviceId, options.deviceName, options.sourceDevice);
  const connectedProtocol = deviceInfo.protocol || adapter.protocol;
  bindMac =
    connectedProtocol === 'rw'
      ? getRwStableMacCandidate(deviceInfo) || getRwStableMacCandidate(options.sourceDevice) || bindMac
      : deviceInfo.mac || deviceInfo.advertis?.macInfo || bindMac;
  const bindUniMacId = connectedProtocol === 'rw' ? bindMac : options.uniMacId;

  const boundDevice = {
    ...deviceInfo,
    mac: bindMac,
    uniMacId: connectedProtocol === 'rw' ? bindUniMacId : deviceInfo.uniMacId,
    name: options.deviceName
  };

  if ((options.bindAfterConnected ?? true) && (connectedProtocol !== 'rw' || bindMac)) {
    await runtime?.bindDevice?.({
      mac: bindMac,
      deviceId,
      serviceId: deviceInfo.serviceId,
      cmdCharId: deviceInfo.cmdCharId,
      dataCharId: deviceInfo.dataCharId,
      dataServiceId: deviceInfo.dataServiceId,
      uniMacId: bindUniMacId,
      deviceName: options.deviceName,
      protocol: connectedProtocol,
      advertis: deviceInfo.advertis || options.sourceDevice?.advertis
    });
  }

  runtime?.onDeviceReady?.(boundDevice);
  return boundDevice;
};

export const autoReconnectLegacyRing = async (
  adapter: LegacyRingAdapter,
  runtime?: RingBleRuntime,
  options: AutoReconnectOptions = {}
) => {
  const maxAttempts = options.maxAttempts ?? 3;
  const delayMs = options.delayMs ?? 2000;
  let lastError: unknown;

  const currentDevice = runtime?.getDeviceInfo() as RingDeviceInfo | undefined;
  let boundDevice: RingDeviceInfo | null | undefined = null;
  try {
    boundDevice = await runtime?.getBoundDevice?.();
  } catch {
    boundDevice = null;
  }
  const reconnectDevice = (
    currentDevice?.deviceId
      ? {
          ...boundDevice,
          ...currentDevice,
          mac: currentDevice.mac || boundDevice?.mac,
          uniMacId: currentDevice.uniMacId || boundDevice?.uniMacId,
          name: currentDevice.name || boundDevice?.name,
          deviceName: currentDevice.deviceName || currentDevice.name || boundDevice?.deviceName || boundDevice?.name,
          protocol: currentDevice.protocol || boundDevice?.protocol
        }
      : boundDevice
  ) as RingDeviceInfo | undefined;
  const deviceId = reconnectDevice?.deviceId || reconnectDevice?.mac || reconnectDevice?.uniMacId || reconnectDevice?.advertis?.macInfo;
  const deviceName = (reconnectDevice?.deviceName || reconnectDevice?.name || reconnectDevice?.mac || reconnectDevice?.deviceId || '') as string;

  if (!deviceId) {
    runtime?.onReconnectStatusChange?.('failed');
    runtime?.onReconnectResultChange?.(false);
    return false;
  }

  runtime?.onReconnectStatusChange?.('reconnecting');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) await sleep(delayMs);
      adapter.registerConnectionStateListener?.();
      const connected = await adapter.connectAndDiscover(deviceId, deviceName, reconnectDevice);
      const readyProtocol = connected.protocol || reconnectDevice?.protocol || adapter.protocol;
      const rwReadyStableIdentity =
        readyProtocol === 'rw'
          ? getRingDeviceStableIdentity({
              ...reconnectDevice,
              ...connected,
              protocol: readyProtocol
            })
          : '';
      const readyDevice: RingDeviceInfo = {
        ...connected,
        mac: readyProtocol === 'rw' ? rwReadyStableIdentity : reconnectDevice?.mac || connected.mac || deviceId,
        uniMacId: readyProtocol === 'rw' ? rwReadyStableIdentity : connected.uniMacId || reconnectDevice?.uniMacId,
        name: connected.name || deviceName,
        deviceName: connected.deviceName || connected.name || deviceName,
        protocol: readyProtocol,
        advertis: connected.advertis || reconnectDevice?.advertis
      };
      if (readyProtocol !== 'rw' || rwReadyStableIdentity) {
        await runtime?.bindDevice?.({
          mac: readyDevice.mac || deviceId,
          deviceId: readyDevice.deviceId || deviceId,
          serviceId: readyDevice.serviceId,
          cmdCharId: readyDevice.cmdCharId,
          dataCharId: readyDevice.dataCharId,
          dataServiceId: readyDevice.dataServiceId,
          uniMacId: readyDevice.uniMacId,
          deviceName: readyDevice.deviceName,
          protocol: readyDevice.protocol,
          advertis: readyDevice.advertis
        });
      }
      runtime?.onDeviceReady?.(readyDevice);
      runtime?.onReconnectStatusChange?.('success');
      runtime?.onReconnectResultChange?.(true);
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  runtime?.onReconnectStatusChange?.('failed');
  runtime?.onReconnectResultChange?.(false);
  runtime?.onDisconnected?.(lastError);
  return false;
};

export const disconnectLegacyRing = async (adapter: LegacyRingAdapter, runtime?: RingBleRuntime, deviceId?: string) => {
  const result = await adapter.disconnect(deviceId);
  runtime?.onUploadingStatusChange?.('idle');
  runtime?.onReconnectStatusChange?.('idle');
  runtime?.onDeviceReady?.({} as RingDeviceInfo);
  return result;
};

export const unbindLegacyRing = async (adapter: LegacyRingAdapter, runtime?: RingBleRuntime, bindIdentity?: string) => {
  const currentDevice = runtime?.getDeviceInfo() as RingDeviceInfo | undefined;
  const targetBindIdentity = bindIdentity || getRingDeviceStableIdentity(currentDevice);
  const targetDisconnectDeviceId = currentDevice?.deviceId;

  if (targetBindIdentity) {
    await runtime?.unbindDevice?.({ mac: targetBindIdentity });
  }

  await disconnectLegacyRing(adapter, runtime, targetDisconnectDeviceId);
  runtime?.onReconnectResultChange?.(null);
  return true;
};

export const cleanupLegacyRing = async (adapter: LegacyRingAdapter, runtime?: RingBleRuntime) => {
  await adapter.cleanup();
  runtime?.onUploadingStatusChange?.('idle');
  runtime?.onReconnectStatusChange?.('idle');
  runtime?.onReconnectResultChange?.(null);
  runtime?.onDeviceReady?.({} as RingDeviceInfo);
};

const LEGACY_LOCAL_DATA_TERMINAL_STATUSES = new Set(['empty', 'no_data', 'filtered', 'failed']);

const getLegacyLocalDataChunkRecords = (parsed: RingParsedData) => {
  return Array.isArray(parsed.records) ? parsed.records : [];
};

const getLegacyLocalDataChunkMaxSeq = (parsed: RingParsedData) => {
  return getLegacyLocalDataChunkRecords(parsed).reduce((maxSeq, record) => {
    const seq = Number((record as Record<string, any>)?.seq);
    return Number.isFinite(seq) ? Math.max(maxSeq, seq) : maxSeq;
  }, 0);
};

const isLegacyLocalDataChunkComplete = (parsed: RingParsedData) => {
  if (parsed.type !== 'local_data') return false;
  if (LEGACY_LOCAL_DATA_TERMINAL_STATUSES.has(String(parsed.status || ''))) return true;

  const totalNum = Number(parsed.totalNum);
  if (!Number.isFinite(totalNum) || totalNum <= 0) return false;

  const records = getLegacyLocalDataChunkRecords(parsed);
  const maxSeq = getLegacyLocalDataChunkMaxSeq(parsed);
  return records.length >= totalNum || maxSeq >= totalNum || maxSeq + 1 >= totalNum;
};

const getLegacySyncErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : `${(error as any)?.errMsg || error || ''}`;

const combineLegacyLocalDataChunks = (chunks: RingParsedData[], status?: string, error?: unknown): RingParsedData => {
  const lastChunk = chunks[chunks.length - 1] || ({ type: 'local_data', records: [] } as RingParsedData);
  const records = chunks.flatMap(getLegacyLocalDataChunkRecords);
  const rawChunks = chunks
    .map((chunk) => (Array.isArray(chunk.raw) ? chunk.raw : []))
    .filter((raw): raw is number[] => raw.length > 0);
  const totalNum = chunks.reduce<number | undefined>((latest, chunk) => {
    const value = Number(chunk.totalNum);
    return Number.isFinite(value) ? value : latest;
  }, undefined);
  const maxSeq = chunks.reduce((max, chunk) => Math.max(max, getLegacyLocalDataChunkMaxSeq(chunk)), 0);
  const nextStatus = status || (records.length > 0 ? 'success' : lastChunk.status || 'empty');

  return {
    ...lastChunk,
    type: 'local_data',
    status: nextStatus,
    totalNum,
    maxSeq,
    records,
    rawChunks,
    chunkCount: chunks.length,
    complete: nextStatus !== 'partial',
    ...(error ? { error: getLegacySyncErrorMessage(error) } : {})
  };
};

const readLegacyLocalDataUntilComplete = async (
  adapter: LegacyRingAdapter,
  options: Pick<SyncLegacyHistoryOptions, 'sinceTimestamp' | 'readAll'>,
  timeoutMs: number
) => {
  const chunks: RingParsedData[] = [];
  const pendingLocalData = adapter.waitForParsedData((parsed) => {
    if (parsed.type !== 'local_data') return false;
    chunks.push(parsed);
    return isLegacyLocalDataChunkComplete(parsed);
  }, timeoutMs);

  await adapter.readLocalData(options);

  try {
    await pendingLocalData;
  } catch (error) {
    if (chunks.length > 0) {
      return combineLegacyLocalDataChunks(chunks, 'partial', error);
    }
    throw error;
  }

  return combineLegacyLocalDataChunks(chunks);
};

const isLegacyHistoryUploadSafeToDelete = (uploadResult: unknown) => {
  if (!uploadResult || typeof uploadResult !== 'object') return false;
  const result = uploadResult as Record<string, any>;
  if (result.rawStored === false) return false;
  if (result.rawStored === true) return true;
  if (result.uploaded === true || result.submitted === true || result.success === true) return true;
  return Number(result.count) > 0 || Number(result.storedCount) > 0;
};

export const syncLegacyHistory = async (
  adapter: LegacyRingAdapter,
  runtime?: RingBleRuntime,
  options: SyncLegacyHistoryOptions = {}
): Promise<SyncLegacyHistoryResult> => {
  const sinceTimestamp = options.sinceTimestamp;
  const timeoutMs = options.timeoutMs ?? 20000;
  const deleteAfterUpload = options.deleteAfterUpload ?? false;

  runtime?.onUploadingStatusChange?.('uploading');

  try {
    if (adapter.protocol === 'rw') {
      try {
        const { parsed, records } = await syncRwHistoryFiles(adapter, {
          sinceTimestamp,
          readAll: options.readAll,
          dataType: options.dataType,
          dataTypes: options.dataTypes,
          timeoutMs
        });
        const currentDevice = runtime?.getDeviceInfo?.() as RingDeviceInfo | undefined;
        const recordsWithDevice = records.map((record) => attachDeviceIdentityToRecord(record, currentDevice));
        const parsedWithDevice = attachDeviceIdentityToParsed(
          {
            ...parsed,
            records: recordsWithDevice
          },
          currentDevice
        );

        runtime?.onParsedData?.(parsedWithDevice);

        if (recordsWithDevice.length > 0) {
          await runtime?.uploadHistoricalRecords?.(recordsWithDevice, parsedWithDevice);
        }

        let deleted = false;
        if (recordsWithDevice.length > 0 && deleteAfterUpload) {
          const pendingDelete = adapter.waitForParsedData((item) => item.type === 'delete_all_local_data', timeoutMs);
          await adapter.sendDeleteAllLocalDataCommand();
          const deleteParsed = await pendingDelete;
          deleted = deleteParsed.status !== 'failed' && deleteParsed.success !== false;
        }

        runtime?.onUploadingStatusChange?.('success');

        return {
          status: parsedWithDevice.status || (recordsWithDevice.length > 0 ? 'success' : 'empty'),
          records: recordsWithDevice,
          parsed: parsedWithDevice,
          uploaded: Boolean(recordsWithDevice.length > 0 && runtime?.uploadHistoricalRecords),
          deleted
        };
      } catch (error) {
        const currentDevice = runtime?.getDeviceInfo?.() as RingDeviceInfo | undefined;
        const parsed: RingParsedData = {
          type: 'rw_history_pending',
          protocol: 'rw',
          status: 'pending',
          message: 'RW 历史同步失败，请重试',
          error: error instanceof Error ? error.message : `${(error as any)?.errMsg || error}`
        };
        const parsedWithDevice = attachDeviceIdentityToParsed(parsed, currentDevice);

        runtime?.onParsedData?.(parsedWithDevice);
        throw error;
      }
    }

    const currentDevice = runtime?.getDeviceInfo?.() as RingDeviceInfo | undefined;
    const parsedLocalData = await readLegacyLocalDataUntilComplete(adapter, {
      sinceTimestamp,
      readAll: options.readAll
    }, timeoutMs);
    const recordsWithDevice = getLegacyLocalDataChunkRecords(parsedLocalData).map((record) =>
      attachDeviceIdentityToRecord(record, currentDevice)
    );
    const parsed = attachDeviceIdentityToParsed(
      {
        ...parsedLocalData,
        records: recordsWithDevice
      },
      currentDevice
    );
    runtime?.onParsedData?.(parsed);
    const records = recordsWithDevice;

    if (records.length === 0) {
      runtime?.onUploadingStatusChange?.('success');
      return {
        status: parsed.status || 'empty',
        records,
        parsed,
        uploaded: false,
        deleted: false
      };
    }

    const uploadResult = await runtime?.uploadHistoricalRecords?.(records, parsed);

    let deleted = false;
    if (deleteAfterUpload && parsed.status !== 'partial' && isLegacyHistoryUploadSafeToDelete(uploadResult)) {
      const pendingDelete = adapter.waitForParsedData((item) => item.type === 'delete_all_local_data', timeoutMs);
      await adapter.sendDeleteAllLocalDataCommand();
      const deleteParsed = await pendingDelete;
      deleted = deleteParsed.status !== 'failed' && deleteParsed.success !== false;
    }

    runtime?.onUploadingStatusChange?.('success');
    return {
      status: parsed.status || 'success',
      records,
      parsed,
      uploaded: Boolean(uploadResult),
      deleted
    };
  } catch (error) {
    runtime?.onUploadingStatusChange?.('failed');
    throw error;
  }
};

export const refreshLegacyBusinessMetrics = async (
  adapter: LegacyRingAdapter,
  runtime?: RingBleRuntime,
  options: RefreshLegacyBusinessMetricsOptions = {}
): Promise<RefreshLegacyBusinessMetricsResult> => {
  if (adapter.protocol === 'rw') {
    return refreshRwBusinessMetrics(adapter, runtime, options);
  }

  if (adapter.protocol === 'qkeer-v2') {
    return refreshQkeerV2BusinessMetrics(adapter, runtime, options);
  }

  const timeoutMs = options.timeoutMs ?? 12000;
  const ok: string[] = [];
  const failed: Array<{ step: string; message: string }> = [];
  const includeRealtimeMetrics = options.includeRealtimeMetrics ?? true;

  const runStep = async (step: string, task: () => Promise<unknown>, wait?: () => Promise<RingParsedData>) => {
    try {
      const pending = wait?.();
      pending?.catch(() => undefined);
      await task();
      if (pending) await pending;
      ok.push(step);
    } catch (error) {
      failed.push({
        step,
        message: error instanceof Error ? error.message : `${(error as any)?.errMsg || error}`
      });
    }
  };

  await runStep(
    'battery',
    () => adapter.sendBatteryCommand(),
    () => adapter.waitForParsedData((parsed) => parsed.type === 'battery', timeoutMs)
  );

  await runStep(
    'firmware',
    () => adapter.sendFirmwareVersion(),
    () =>
      adapter.waitForParsedData(
        (parsed) => parsed.type === 'firmware_version' || parsed.type === 'hardwareVersion',
        timeoutMs
      )
  );

  await runStep(
    'software',
    () => adapter.sendSoftwareVersion(),
    () =>
      adapter.waitForParsedData(
        (parsed) => parsed.type === 'firmware_version' || parsed.type === 'softwareVersion',
        timeoutMs
      )
  );

  if (options.includeDeviceTime ?? true) {
    await runStep(
      'device_time',
      () => adapter.readDeviceTime(),
      () => adapter.waitForParsedData((parsed) => parsed.type === 'device_time', timeoutMs)
    );
  }

  if (includeRealtimeMetrics) {
    await runStep(
      'heart_rate',
      () => adapter.sendActiveMeasureCommand(),
      () =>
        adapter.waitForParsedData(
          (parsed) =>
            parsed.type === 'active_measure' ||
            isRwHealthDataValue(parsed, 'heart_rate'),
          timeoutMs
        )
    );

    await runStep(
      'blood_oxygen',
      () => adapter.sendOxyGenCommand(),
      () =>
        adapter.waitForParsedData(
          (parsed) =>
            parsed.type === 'active_OxyGenMeasure' ||
            isRwHealthDataValue(parsed, 'blood_oxygen'),
          timeoutMs
        )
    );

    await runStep(
      'temperature',
      () => adapter.sendBodyTemperatureCommand(),
      () => adapter.waitForParsedData((parsed) => isRwHealthDataValue(parsed, 'temperature'), timeoutMs)
    );
  }

  if (options.includeCollectPeriod ?? true) {
    await runStep(
      'collect_period',
      () => adapter.readCollectPeriodCommand(),
      () => adapter.waitForParsedData((parsed) => parsed.type === 'collect_period_read', timeoutMs)
    );
  }

  return {
    status: failed.length === 0 ? 'success' : ok.length > 0 ? 'partial' : 'failed',
    ok,
    failed
  };
};

const refreshQkeerV2BusinessMetrics = async (
  adapter: LegacyRingAdapter,
  _runtime?: RingBleRuntime,
  options: RefreshLegacyBusinessMetricsOptions = {}
): Promise<RefreshLegacyBusinessMetricsResult> => {
  const timeoutMs = options.timeoutMs ?? 12000;
  const commandTimeoutMs = Math.min(timeoutMs, 3000);
  const waitTimeoutMs = Math.min(timeoutMs, 6000);
  const historyWaitTimeoutMs = Math.min(timeoutMs, 5000);
  const todayZeroMs = new Date(new Date().toDateString()).getTime();
  const ok: string[] = [];
  const failed: Array<{ step: string; message: string }> = [];

  const runStep = async (step: string, task: () => Promise<unknown>, wait?: () => Promise<RingParsedData>) => {
    try {
      const pending = wait?.();
      pending?.catch(() => undefined);
      await withTaskTimeout(Promise.resolve().then(task), commandTimeoutMs, `${step} command timeout`);
      if (pending) await pending;
      ok.push(step);
    } catch (error) {
      failed.push({
        step,
        message: getSettledErrorMessage(error)
      });
    }
  };

  await runStep(
    'battery',
    () => adapter.sendBatteryCommand(),
    () => adapter.waitForParsedData((parsed) => parsed.type === 'battery', waitTimeoutMs)
  );

  await runStep(
    'firmware',
    () => adapter.sendFirmwareVersion(),
    () => adapter.waitForParsedData((parsed) => parsed.type === 'firmware_version', waitTimeoutMs)
  );
  ok.push('software');

  if (options.includeDeviceTime ?? true) {
    await runStep(
      'device_time',
      () => adapter.readDeviceTime(),
      () => adapter.waitForParsedData((parsed) => parsed.type === 'device_time', waitTimeoutMs)
    );
  }

  await runStep(
    'heart_rate',
    () => adapter.sendActiveMeasureCommand(),
    () =>
      adapter.waitForParsedData(
        (parsed) =>
          parsed.type === 'active_measure' ||
          (parsed.type === 'qkeer_v2_health' && (parsed.heartRate != null || parsed.heartrate != null)),
        waitTimeoutMs
      )
  );

  await runStep(
    'blood_oxygen',
    () => adapter.sendOxyGenCommand(),
    () =>
      adapter.waitForParsedData(
        (parsed) =>
          parsed.type === 'active_OxyGenMeasure' ||
          (parsed.type === 'qkeer_v2_health' && (parsed.bloodOxygen != null || parsed.spo2 != null)),
        waitTimeoutMs
      )
  );

  await runStep(
    'last_data',
    () => adapter.sendBodyTemperatureCommand(),
    () =>
      adapter.waitForParsedData(
        (parsed) =>
          parsed.type === 'active_Temperature' ||
          parsed.type === 'qkeer_v2_last_data' ||
          parsed.type === 'qkeer_v2_last_data_sleep' ||
          parsed.type === 'qkeer_v2_heartbeat',
        waitTimeoutMs
      )
  );

  if (options.includeCollectPeriod ?? true) {
    await runStep(
      'collect_period',
      () => adapter.readCollectPeriodCommand(),
      () => adapter.waitForParsedData((parsed) => parsed.type === 'collect_period_read', waitTimeoutMs)
    );
  }

  await runStep(
    'history_snapshot',
    () => adapter.readLocalData({ sinceTimestamp: todayZeroMs, readAll: false }),
    () =>
      adapter.waitForParsedData(
        (parsed) =>
          parsed.type === 'local_data' ||
          parsed.type === 'qkeer_v2_health_list' ||
          parsed.type === 'qkeer_v2_step_list' ||
          parsed.type === 'qkeer_v2_sleep_list',
        historyWaitTimeoutMs
      )
  );

  return {
    status: failed.length === 0 ? 'success' : ok.length > 0 ? 'partial' : 'failed',
    ok,
    failed
  };
};

const refreshRwBusinessMetrics = async (
  adapter: LegacyRingAdapter,
  runtime?: RingBleRuntime,
  options: RefreshLegacyBusinessMetricsOptions = {}
): Promise<RefreshLegacyBusinessMetricsResult> => {
  const requestedTimeoutMs = options.timeoutMs ?? 5000;
  const coreTimeoutMs = Math.min(requestedTimeoutMs, 3500);
  const useMediumRwRealtimeWait = requestedTimeoutMs >= 8000;
  const useExtendedRwRealtimeWait = requestedTimeoutMs >= 20000;
  const healthQuickWaitMs = Math.min(
    requestedTimeoutMs,
    useExtendedRwRealtimeWait ? Math.max(1000, requestedTimeoutMs - 1000) : useMediumRwRealtimeWait ? 3500 : 1000
  );
  const healthBackgroundTimeoutMs = Math.min(
    requestedTimeoutMs,
    useExtendedRwRealtimeWait ? Math.max(1000, requestedTimeoutMs - 500) : useMediumRwRealtimeWait ? 4500 : healthQuickWaitMs
  );
  const additionalRealtimeTimeoutMs = Math.min(healthBackgroundTimeoutMs, Math.max(20, requestedTimeoutMs - 100));
  const historyBackgroundTimeoutMs = Math.min(requestedTimeoutMs, 2500);
  const commandTimeoutMs = Math.min(options.timeoutMs ?? 2500, 2500);
  const ok: string[] = [];
  const failed: Array<{ step: string; message: string }> = [];
  const includeDeviceInfo = options.includeDeviceInfo ?? true;
  const includeDeviceTime = options.includeDeviceTime ?? true;
  const includeRealtimeMetrics = options.includeRealtimeMetrics ?? true;
  const includeHistorySnapshot = options.includeHistorySnapshot ?? true;
  const monitoringNames = ['heart_rate', 'spo2', 'hrv', 'stress', 'blood_sugar', 'blood_pressure', 'temperature'];
  const allRealtimeNames = ['heart_rate', 'blood_oxygen', 'temperature', 'blood_sugar', 'hrv', 'stress', 'blood_pressure'] as const;
  const requestedRealtimeNames = new Set(
    (options.realtimeMetricNames?.length ? options.realtimeMetricNames : allRealtimeNames)
      .map(normalizeRwWorkflowMetricName)
      .filter((name) => allRealtimeNames.includes(name as (typeof allRealtimeNames)[number]))
  );
  const shouldReadRealtimeMetric = (name: string) =>
    includeRealtimeMetrics && requestedRealtimeNames.has(normalizeRwWorkflowMetricName(name));
  const heartRateRequested = shouldReadRealtimeMetric('heart_rate');
  const bloodOxygenRequested = shouldReadRealtimeMetric('blood_oxygen');
  const temperatureRequested = shouldReadRealtimeMetric('temperature');
  const additionalRealtimeNames = (['blood_sugar', 'hrv', 'stress', 'blood_pressure'] as const).filter(
    shouldReadRealtimeMetric
  );
  const optionalRealtimeFailures: Array<{ step: string; message: string }> = [];

  const emitRwHealthDataPending = (name: string, message = '\u8bbe\u5907\u672a\u8fd4\u56de\u5b9e\u65f6\u6570\u503c', status = 'pending') => {
    runtime?.onParsedData?.({
      type: 'rw_health_data_pending',
      protocol: 'rw',
      name,
      status,
      message,
      data: []
    });
  };

  const emitRwHistoryPending = (message: string, status = 'pending', error?: string) => {
    runtime?.onParsedData?.({
      type: 'rw_history_pending',
      protocol: 'rw',
      status,
      message,
      error
    });
  };

  const isRuntimeBleParsedPacket = (parsed: RingParsedData) =>
    Boolean(parsed.serviceId || parsed.characteristicId || parsed.receivedAt || parsed.parsedAt);

  const emitParsedIfNotAlreadyEmitted = (parsed?: RingParsedData | null, replayCurrentBlePacket = false) => {
    if (!parsed) return;
    if (
      (parsed as unknown as Record<PropertyKey, unknown>)[RING_PARSED_EMITTED] &&
      !(replayCurrentBlePacket && isRuntimeBleParsedPacket(parsed))
    ) {
      return;
    }
    runtime?.onParsedData?.(attachDeviceIdentityToParsed(parsed, runtime?.getDeviceInfo?.() as RingDeviceInfo | undefined));
  };

  const sendBestEffort = async (step: string, task: () => Promise<unknown>) => {
    try {
      await withTaskTimeout(Promise.resolve().then(task), commandTimeoutMs, `${step} timeout`);
      return true;
    } catch (error) {
      ok.push(`${step}_pending`);
      runtime?.onParsedData?.({
        type: 'rw_health_data_pending',
        protocol: 'rw',
        name: step,
        status: 'pending',
        message: getSettledErrorMessage(error),
        data: []
      });
      return false;
    }
  };

  const waitWithinHealthWindow = (promise: Promise<RingParsedData>) => {
    return Promise.race([
      promise
        .then((parsed) => ({ status: 'fulfilled' as const, parsed }))
        .catch((reason) => ({ status: 'rejected' as const, reason })),
      sleep(healthQuickWaitMs).then(() => ({ status: 'timeout' as const }))
    ]);
  };

  const waitWithinCoreWindow = <T>(promise: Promise<T>) => {
    return Promise.race([
      promise
        .then((parsed) => ({ status: 'fulfilled' as const, parsed }))
        .catch((reason) => ({ status: 'rejected' as const, reason })),
      sleep(coreTimeoutMs).then(() => ({ status: 'timeout' as const }))
    ]);
  };

  const getWaitResultMessage = (result: { status: string; parsed?: unknown; reason?: unknown }, timeoutMessage: string) => {
    if (result.status === 'rejected') {
      return getSettledErrorMessage(result.reason);
    }
    return timeoutMessage;
  };

  const waitForFirstParsed = (promises: Promise<RingParsedData>[]) => {
    return new Promise<RingParsedData>((resolve, reject) => {
      let pending = promises.length;
      let lastError: unknown;
      promises.forEach((promise) => {
        promise
          .then(resolve)
          .catch((error) => {
            lastError = error;
            pending -= 1;
            if (pending <= 0) reject(lastError);
          });
      });
    });
  };

  const batteryWait = includeDeviceInfo
    ? adapter.waitForParsedData((parsed) => parsed.type === 'battery', coreTimeoutMs)
    : Promise.resolve(null);
  const firmwareWait = includeDeviceInfo
    ? adapter.waitForParsedData(
        (parsed) => parsed.type === 'firmware_version' || parsed.type === 'hardwareVersion',
        coreTimeoutMs
      )
    : Promise.resolve(null);
  const softwareWait = includeDeviceInfo
    ? adapter.waitForParsedData(
        (parsed) =>
          parsed.type === 'softwareVersion' ||
          (parsed.type === 'firmware_version' && (parsed as Record<string, any>).softwareVersion != null),
        coreTimeoutMs
      )
    : Promise.resolve(null);
  const deviceTimeWait = includeDeviceTime
    ? adapter.waitForParsedData((parsed) => parsed.type === 'device_time', coreTimeoutMs)
    : Promise.resolve(null);
  batteryWait.catch(() => undefined);
  firmwareWait.catch(() => undefined);
  softwareWait.catch(() => undefined);
  deviceTimeWait.catch(() => undefined);
  const heartRateWait = heartRateRequested
    ? adapter.waitForParsedData(
        (parsed) => isRwHealthDataValue(parsed, 'heart_rate'),
        healthBackgroundTimeoutMs
      )
    : Promise.resolve(null as any);
  const bloodOxygenWait = bloodOxygenRequested
    ? adapter.waitForParsedData(
        (parsed) => isRwHealthDataValue(parsed, 'blood_oxygen'),
        healthBackgroundTimeoutMs
      )
    : Promise.resolve(null as any);
  const temperatureWait = temperatureRequested
    ? adapter.waitForParsedData(
        (parsed) => isRwHealthDataValue(parsed, 'temperature'),
        healthBackgroundTimeoutMs
      )
    : Promise.resolve(null as any);
  heartRateWait.catch(() => undefined);
  bloodOxygenWait.catch(() => undefined);
  temperatureWait.catch(() => undefined);
  const historySnapshotWait = includeHistorySnapshot
    ? adapter.waitForParsedData(
        (parsed) =>
          parsed.type === 'rw_file_list' ||
          parsed.type === 'local_data' ||
          parsed.type === 'rw_history_pending',
        historyBackgroundTimeoutMs
      )
    : Promise.resolve(null as any);
  historySnapshotWait.catch(() => undefined);

  if (options.includeCollectPeriod ?? true) {
    emitRwHealthDataPending('collect_period', '\u6b63\u5728\u8bfb\u53d6\u76d1\u542c\u914d\u7f6e', 'requested');
  }

  if (includeDeviceInfo) {
    await sendBestEffort('battery_command', () => adapter.sendBatteryCommand());
    if (coreTimeoutMs >= 600) {
      await sleep(80);
    }
    await sendBestEffort('firmware_command', () => adapter.sendFirmwareVersion());
  }

  if (includeDeviceTime) {
    try {
      await withTaskTimeout(Promise.resolve().then(() => adapter.readDeviceTime()), commandTimeoutMs, 'device_time_command timeout');
    } catch {
      ok.push('device_time_command_pending');
    }
  }

  if (includeHistorySnapshot) {
    emitRwHistoryPending('RW 历史快照已请求', 'requested');
    try {
      await withTaskTimeout(
        adapter.readLocalData({ sinceTimestamp: new Date(new Date().toDateString()).getTime(), readAll: false }),
        commandTimeoutMs,
        'history_snapshot_command timeout'
      );
    } catch (error) {
      const message = getSettledErrorMessage(error);
      ok.push('history_snapshot_command_pending');
      emitRwHistoryPending(message, 'pending', message);
    }
    void historySnapshotWait
      .then(emitParsedIfNotAlreadyEmitted)
      .catch((error) => emitRwHistoryPending(getSettledErrorMessage(error), 'pending', getSettledErrorMessage(error)));
  }

  const monitoringWaits =
    options.includeCollectPeriod ?? true
      ? monitoringNames.map((name) => ({
          name,
          wait: adapter.waitForParsedData(
            (parsed) => parsed.type === 'rw_health_monitoring' && (parsed as Record<string, any>).name === name,
            coreTimeoutMs
          )
        }))
      : [];
  monitoringWaits.forEach(({ wait }) => {
    wait
      .then(emitParsedIfNotAlreadyEmitted)
      .catch(() => undefined);
  });
  const collectPeriodQuickWait =
    monitoringWaits.length > 0
      ? waitForFirstParsed(monitoringWaits.map(({ wait }) => wait))
      : Promise.resolve(null);
  collectPeriodQuickWait.catch(() => undefined);

  if (options.includeCollectPeriod ?? true) {
    if (coreTimeoutMs >= 600) {
      await sleep(80);
    }
    await sendBestEffort('collect_period_command', () => adapter.readCollectPeriodCommand());
    if (healthQuickWaitMs >= 600) {
      await sleep(80);
    }
  } else if (includeDeviceInfo) {
    if (healthQuickWaitMs >= 600) {
      await sleep(80);
    }
  }

  const additionalRealtimeWaits = includeRealtimeMetrics
    ? additionalRealtimeNames.map((name) => ({
        name,
        wait: adapter.waitForParsedData(
          (parsed) => isRwHealthDataValue(parsed, name),
          additionalRealtimeTimeoutMs
        )
      }))
    : [];
  additionalRealtimeWaits.forEach(({ wait }) => wait.catch(() => undefined));
  const additionalRealtimeResultsPromise = Promise.all(
    additionalRealtimeWaits.map(({ wait }) => waitWithinHealthWindow(wait))
  );
  additionalRealtimeResultsPromise.catch(() => undefined);

  if (heartRateRequested) {
    await sendBestEffort('heart_rate_command', () => adapter.sendActiveMeasureCommand());
    emitRwHealthDataPending('heart_rate', '\u5df2\u8bf7\u6c42\u5fc3\u7387\uff0c\u7b49\u5f85\u8bbe\u5907\u4e0a\u62a5', 'requested');
  }
  if (heartRateRequested && bloodOxygenRequested && healthQuickWaitMs >= 600) {
    await sleep(300);
  }
  if (bloodOxygenRequested) {
    await sendBestEffort('blood_oxygen_command', () => adapter.sendOxyGenCommand());
    emitRwHealthDataPending('blood_oxygen', '\u5df2\u8bf7\u6c42\u8840\u6c27\uff0c\u7b49\u5f85\u8bbe\u5907\u4e0a\u62a5', 'requested');
  }
  if (bloodOxygenRequested && temperatureRequested && healthQuickWaitMs >= 600) {
    await sleep(120);
  }
  if (temperatureRequested) {
    await sendBestEffort('temperature_command', () => adapter.sendBodyTemperatureCommand());
    emitRwHealthDataPending('temperature', '\u5df2\u8bf7\u6c42\u4f53\u6e29\uff0c\u7b49\u5f85\u8bbe\u5907\u4e0a\u62a5', 'requested');
  }
  if (additionalRealtimeNames.length > 0 && adapter.controlRwHealthData) {
    additionalRealtimeNames.forEach((name) => {
      emitRwHealthDataPending(name, `\u5df2\u8bf7\u6c42${getRwMetricLabel(name)}\uff0c\u7b49\u5f85\u8bbe\u5907\u4e0a\u62a5`, 'requested');
    });
    void sendRwControlFallbacks(adapter, additionalRealtimeNames);
  }

  const [batteryResult, firmwareResult, softwareResult, deviceTimeResult, heartRateResult, bloodOxygenResult, temperatureResult] = await Promise.all([
    waitWithinCoreWindow(batteryWait),
    waitWithinCoreWindow(firmwareWait),
    waitWithinCoreWindow(softwareWait),
    waitWithinCoreWindow(deviceTimeWait),
    waitWithinHealthWindow(heartRateWait),
    waitWithinHealthWindow(bloodOxygenWait),
    waitWithinHealthWindow(temperatureWait)
  ]);
  const additionalRealtimeResults = await Promise.all(
    additionalRealtimeWaits.map(({ wait }) =>
      Promise.race([
        waitWithinHealthWindow(wait),
        sleep(0).then(() => ({ status: 'pending' as const }))
      ])
    )
  );
  const hasPendingAdditionalRealtime = additionalRealtimeResults.some((result) => result.status === 'pending');

  if (hasPendingAdditionalRealtime) {
    void additionalRealtimeResultsPromise
      .then((results) => {
        results.forEach((result, index) => {
          const name = additionalRealtimeWaits[index]?.name;
          if (!name) return;
          if (result.status === 'fulfilled') {
            emitParsedIfNotAlreadyEmitted(result.parsed, true);
            return;
          }
          emitRwHealthDataPending(name, `\u5f53\u524dRW\u8bbe\u5907\u672a\u8fd4\u56de\u5b9e\u65f6${getRwMetricLabel(name)}`);
        });
      })
      .catch(() => undefined);
  }

  if (!includeDeviceInfo) {
    ok.push('battery_cached', 'firmware_cached', 'software_cached');
  } else if (batteryResult.status === 'fulfilled' && batteryResult.parsed) {
    emitParsedIfNotAlreadyEmitted(batteryResult.parsed, true);
    ok.push('battery');
  } else {
    ok.push('battery_pending');
    runtime?.onParsedData?.({
      type: 'rw_health_data_pending',
      protocol: 'rw',
      name: 'battery',
      status: 'pending',
      message: getWaitResultMessage(batteryResult, 'RW \u7535\u91cf\u7b49\u5f85\u8bbe\u5907\u8fd4\u56de'),
      data: []
    });
  }

  if (!includeDeviceInfo) {
    // Device info was intentionally skipped for a light foreground refresh.
  } else if (firmwareResult.status === 'fulfilled' && firmwareResult.parsed) {
    emitParsedIfNotAlreadyEmitted(firmwareResult.parsed, true);
    ok.push('firmware');
  } else {
    ok.push('firmware_pending');
    runtime?.onParsedData?.({
      type: 'rw_health_data_pending',
      protocol: 'rw',
      name: 'firmware',
      status: 'pending',
      message: getWaitResultMessage(firmwareResult, 'RW \u56fa\u4ef6\u7248\u672c\u7b49\u5f85\u8bbe\u5907\u8fd4\u56de'),
      data: []
    });
  }

  if (!includeDeviceInfo) {
    // Device info was intentionally skipped for a light foreground refresh.
  } else if (softwareResult.status === 'fulfilled' && softwareResult.parsed) {
    emitParsedIfNotAlreadyEmitted(softwareResult.parsed, true);
    ok.push('software');
  } else {
    ok.push('software_pending');
    runtime?.onParsedData?.({
      type: 'rw_health_data_pending',
      protocol: 'rw',
      name: 'software',
      status: 'pending',
      message: getWaitResultMessage(softwareResult, 'RW 软件版本等待设备返回'),
      data: []
    });
  }

  if (!includeDeviceTime) {
    // Device time was intentionally skipped for a light foreground refresh.
  } else if (deviceTimeResult.status === 'fulfilled' && deviceTimeResult.parsed) {
    emitParsedIfNotAlreadyEmitted(deviceTimeResult.parsed, true);
    ok.push('device_time');
  } else {
    ok.push('device_time_pending');
  }

  if (monitoringWaits.length > 0) {
    const collectPeriodReady = await Promise.race([
      collectPeriodQuickWait
        .then((parsed) => ({ status: 'fulfilled' as const, parsed }))
        .catch((reason) => ({ status: 'rejected' as const, reason })),
      sleep(0).then(() => ({ status: 'pending' as const, parsed: null }))
    ]);

    if (collectPeriodReady.status === 'fulfilled' && collectPeriodReady.parsed) {
      ok.push('collect_period');
    } else {
      ok.push('collect_period_pending');
      emitRwHealthDataPending(
        'collect_period',
        collectPeriodReady.status === 'rejected'
          ? getSettledErrorMessage(collectPeriodReady.reason)
          : '\u76d1\u542c\u914d\u7f6e\u5df2\u8bf7\u6c42',
        'requested'
      );
    }
  }

  if (!heartRateRequested) {
    ok.push('heart_rate_skipped');
  } else if (heartRateResult.status === 'fulfilled') {
    emitParsedIfNotAlreadyEmitted(heartRateResult.parsed, true);
    ok.push('heart_rate');
  } else if (heartRateResult.status === 'timeout') {
    optionalRealtimeFailures.push({ step: 'heart_rate', message: 'RW parsed data wait timeout.' });
    emitRwHealthDataPending('heart_rate', `当前RW设备未返回实时${getRwMetricLabel('heart_rate')}`);
  } else {
    optionalRealtimeFailures.push({ step: 'heart_rate', message: getSettledErrorMessage(heartRateResult.reason) });
    emitRwHealthDataPending('heart_rate', `当前RW设备未返回实时${getRwMetricLabel('heart_rate')}`);
  }

  if (!bloodOxygenRequested) {
    ok.push('blood_oxygen_skipped');
  } else if (bloodOxygenResult.status === 'fulfilled') {
    emitParsedIfNotAlreadyEmitted(bloodOxygenResult.parsed, true);
    ok.push('blood_oxygen');
  } else if (bloodOxygenResult.status === 'timeout') {
    optionalRealtimeFailures.push({ step: 'blood_oxygen', message: 'RW parsed data wait timeout.' });
    emitRwHealthDataPending('blood_oxygen', `当前RW设备未返回实时${getRwMetricLabel('blood_oxygen')}`);
  } else {
    optionalRealtimeFailures.push({ step: 'blood_oxygen', message: getSettledErrorMessage(bloodOxygenResult.reason) });
    emitRwHealthDataPending('blood_oxygen', `当前RW设备未返回实时${getRwMetricLabel('blood_oxygen')}`);
  }

  if (!temperatureRequested) {
    ok.push('temperature_skipped');
  } else if (temperatureResult.status === 'fulfilled') {
    emitParsedIfNotAlreadyEmitted(temperatureResult.parsed, true);
    ok.push('temperature');
  } else if (temperatureResult.status === 'timeout') {
    optionalRealtimeFailures.push({ step: 'temperature', message: 'RW parsed data wait timeout.' });
    emitRwHealthDataPending('temperature', `当前RW设备未返回实时${getRwMetricLabel('temperature')}`);
  } else {
    optionalRealtimeFailures.push({ step: 'temperature', message: getSettledErrorMessage(temperatureResult.reason) });
    emitRwHealthDataPending('temperature', `当前RW设备未返回实时${getRwMetricLabel('temperature')}`);
  }

  const additionalRealtimeOk: string[] = [];
  const additionalRealtimePending: string[] = [];
  additionalRealtimeResults.forEach((result, index) => {
    const name = additionalRealtimeWaits[index]?.name;
    if (!name) return;

    if (result.status === 'fulfilled') {
      emitParsedIfNotAlreadyEmitted(result.parsed, true);
      additionalRealtimeOk.push(name);
      return;
    }

    additionalRealtimePending.push(`${name}_pending`);
    emitRwHealthDataPending(name, `\u5f53\u524dRW\u8bbe\u5907\u672a\u8fd4\u56de\u5b9e\u65f6${getRwMetricLabel(name)}`);
  });

  ok.push(
    ...additionalRealtimeOk,
    ...optionalRealtimeFailures.map((item) => `${item.step}_pending`),
    ...additionalRealtimePending,
    includeHistorySnapshot ? 'history_snapshot_pending' : 'history_snapshot_skipped'
  );

  return {
    status: failed.length === 0 ? 'success' : ok.length > 0 ? 'partial' : 'failed',
    ok,
    failed
  };
};

const getSettledErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : `${(error as any)?.errMsg || error}`;
};

const sendRwDirectReadFallbacks = async (adapter: LegacyRingAdapter, names?: readonly string[]) => {
  if (!adapter.readRwHealthData) return;
  const readNames = (names?.length
    ? names
    : ['heart_rate', 'blood_oxygen', 'temperature', 'blood_sugar', 'hrv', 'stress', 'blood_pressure']) as Parameters<
    NonNullable<LegacyRingAdapter['readRwHealthData']>
  >[0][];
  for (const name of readNames) {
    await sleep(120);
    try {
      await adapter.readRwHealthData(name);
    } catch {
      // Direct reads are a background fallback; the foreground refresh already reports pending status.
    }
  }
};

const getDeviceIdentityPayload = (device?: RingDeviceInfo) => {
  if (!device) return {};
  const stableIdentity = getRingDeviceStableIdentity(device);
  const isRwDevice = resolveRingProtocol(device) === 'rw';
  return {
    deviceId: device.deviceId,
    uniMacId: isRwDevice ? stableIdentity : device.uniMacId,
    mac: device.mac || device.advertis?.macInfo || (isRwDevice ? stableIdentity : ''),
    deviceName: device.deviceName || device.name,
    advertis: device.advertis
  };
};

const getRingDeviceStableIdentity = (device?: RingDeviceInfo) => {
  const stableMac = device?.mac || device?.advertis?.macInfo;
  if (stableMac) return stableMac;

  if (device && resolveRingProtocol(device) === 'rw') {
    if (isColonSeparatedBleMac(device.uniMacId)) return device.uniMacId;
    if (isColonSeparatedBleMac(device.deviceId)) return device.deviceId;
    return '';
  }

  return device?.uniMacId || device?.deviceId || '';
};

const attachDeviceIdentityToParsed = (parsed: RingParsedData, device?: RingDeviceInfo): RingParsedData => {
  const identity = getDeviceIdentityPayload(device);
  return {
    ...parsed,
    deviceId: parsed.deviceId || identity.deviceId,
    uniMacId: parsed.uniMacId || identity.uniMacId,
    mac: parsed.mac || identity.mac,
    deviceName: parsed.deviceName || identity.deviceName,
    advertis: parsed.advertis || identity.advertis
  };
};

const attachDeviceIdentityToRecord = (record: Record<string, any>, device?: RingDeviceInfo) => {
  const identity = getDeviceIdentityPayload(device);
  return {
    ...record,
    deviceId: record.deviceId || identity.deviceId,
    uniMacId: record.uniMacId || identity.uniMacId,
    mac: record.mac || identity.mac,
    deviceName: record.deviceName || identity.deviceName,
    advertis: record.advertis || identity.advertis
  };
};

const getRwMetricLabel = (name: string) => {
  if (name === 'temperature') return '体温';
  if (name === 'blood_sugar') return '血糖';
  if (name === 'hrv') return 'HRV';
  if (name === 'stress') return '压力';
  if (name === 'blood_pressure') return '血压';
  if (name === 'heart_rate') return '心率';
  if (name === 'blood_oxygen') return '血氧';
  return name;
};

const normalizeRwWorkflowMetricName = (name: unknown) => {
  const normalized = `${name || ''}`.trim().replace(/-/g, '_').toLowerCase();
  const compact = normalized.replace(/[_\s]/g, '');
  if (compact === 'spo2' || compact === 'bloodoxygen' || compact === 'oxygen') return 'blood_oxygen';
  if (compact === 'heartrate' || compact === 'heart' || compact === 'hr') return 'heart_rate';
  if (compact === 'bodytemperature' || compact === 'bodytemp' || compact === 'skintemperature' || compact === 'skintemp' || compact === 'temp') {
    return 'temperature';
  }
  if (compact === 'bloodsugar' || compact === 'glucose' || compact === 'bs') return 'blood_sugar';
  if (compact === 'bloodpressure' || compact === 'bp') return 'blood_pressure';
  return normalized;
};

const getRwWorkflowTemperatureValue = (item: Record<string, any>) =>
  item.temperature ??
  item.temperatureValue ??
  item.temp ??
  item.bodyTemperature ??
  item.body_temperature ??
  item.bodyTemp ??
  item.body_temp ??
  item.skinTemperature ??
  item.skin_temperature ??
  item.skinTemp ??
  item.skin_temp;

const getFirstRwWorkflowMetricValue = (item: Record<string, any>, aliases: string[]) => {
  for (const alias of aliases) {
    const value = item[alias];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const sendRwControlFallbacks = async (adapter: LegacyRingAdapter, names?: readonly string[]) => {
  if (!adapter.controlRwHealthData) return;
  const controlNames = (names?.length ? names : ['temperature', 'blood_sugar', 'blood_pressure']) as Parameters<
    NonNullable<LegacyRingAdapter['controlRwHealthData']>
  >[0][];
  for (const name of controlNames) {
    await sleep(120);
    try {
      await adapter.controlRwHealthData(name, true);
      if (adapter.readRwHealthData) {
        await sleep(120);
        await adapter.readRwHealthData(name);
      }
    } catch {
      // Active metric controls/reads are best-effort; foreground refresh keeps pending status visible.
    }
  }
};

const isRwHealthDataValue = (parsed: RingParsedData, name: string) => {
  const metricName = normalizeRwWorkflowMetricName(name);
  const item = parsed as Record<string, any>;

  if (parsed.type === 'rw_health_data' && normalizeRwWorkflowMetricName(parsed.name) === metricName) {
    if (parsed.value != null) {
      if (typeof parsed.value === 'object') return true;
      return isReturnedMetricValue(parsed.value);
    }
    if (!Array.isArray(parsed.data)) return false;
    return parsed.data.some(isReturnedMetricByte);
  }

  if (metricName === 'heart_rate' && parsed.type === 'active_measure') {
    return isReturnedMetricValue(getFirstRwWorkflowMetricValue(item, ['heartRate', 'heart_rate', 'heartrate', 'hr']));
  }

  if (metricName === 'blood_oxygen' && parsed.type === 'active_OxyGenMeasure') {
    return isReturnedMetricValue(
      getFirstRwWorkflowMetricValue(item, ['bloodOxygen', 'blood_oxygen', 'bloodOxygenSaturation', 'bloodOxy', 'spo2', 'oxygen'])
    );
  }

  if (metricName === 'temperature' && parsed.type === 'active_Temperature') {
    return isReturnedMetricValue(getRwWorkflowTemperatureValue(item));
  }

  return false;
};

const isReturnedMetricByte = (value: unknown) => typeof value === 'number' && value > 0 && value !== 0x31;

const isReturnedMetricValue = (value: unknown) => {
  if (typeof value === 'number') return isReturnedMetricByte(value);
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== '0' && value.trim() !== '0x31';
};

export const createUnsupportedLegacyOtaTask = () => {
  throw new Error('Legacy ring OTA is not migrated yet. Confirm the complete OTA protocol before enabling it.');
};
