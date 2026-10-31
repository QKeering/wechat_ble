<script setup lang="ts">
import '@/pagesA/mines/i18n/pack';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRingBLE } from '@/composables/useRingBLE';
import { useRingStore, useUserStore } from '@/stores';
import { tryClaimLegacyBleCommandSession } from '@/sdk/ring-ble/legacy/commandSession';
import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';

type AnyRecord = Record<string, any>;
type DebugStatus = 'info' | 'success' | 'error';
type CommandKey =
  | 'oxygen'
  | 'heart'
  | 'temperature'
  | 'battery'
  | 'deviceTime'
  | 'firmware'
  | 'software'
  | 'historyAll'
  | 'wearMeasure'
  | 'wearNotWorn'
  | 'mtuHistory'
  | 'collectPeriod'
  | 'batteryMonitor'
  | 'factoryReset';

type DebugLog = {
  id: number;
  time: string;
  title: string;
  status: DebugStatus;
  detail: string;
};

type CommandConfig = {
  key: CommandKey;
  label: string;
  desc: string;
  timeoutMs: number;
  run: () => Promise<unknown>;
  matcher?: (record: AnyRecord) => boolean;
  timeoutText?: string;
  skipWait?: boolean;
  formatResult?: (result: unknown) => unknown;
};

const ringStore = useRingStore();
const userStore = useUserStore();
const ble = useRingBLE() as any;

const logs = ref<DebugLog[]>([]);
const runningKey = ref<CommandKey | ''>('');
const logSeq = ref(0);
const collectPeriodOptions = [20, 30];
const testingCollectPeriodMinutes = ref(0);
const batteryTestMode = ref<'passive' | 'polling' | ''>('');
const batteryTestStopRequested = ref(false);
let stopBatteryTestWait: (() => void) | null = null;
let stopWearObservationWait: (() => void) | null = null;
let stopMtuHistoryObservationWait: (() => void) | null = null;
let stopMtuHistoryCapture: (() => void) | null = null;
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
const lastWearMeasureReport = ref<AnyRecord | null>(null);
const lastMtuHistoryReport = ref<AnyRecord | null>(null);

const unwrap = <T = unknown>(value: any): T => {
  if (value && typeof value === 'object' && 'value' in value) return value.value as T;
  return value as T;
};

const formatClock = (timestamp = Date.now()) => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const stringify = (value: unknown) => {
  if (value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    const details: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
    Object.getOwnPropertyNames(value).forEach((key) => {
      if (!(key in details)) details[key] = (value as unknown as Record<string, unknown>)[key];
    });
    return JSON.stringify(details, null, 2);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const normalizeText = (value: unknown) => String(value ?? '').toLowerCase();

const readArray = (value: unknown): AnyRecord[] => {
  const unwrapped = unwrap<unknown>(value);
  return Array.isArray(unwrapped) ? (unwrapped.filter(Boolean) as AnyRecord[]) : [];
};

const getRecordTimestamp = (record: AnyRecord) => {
  const candidates = [record.timestamp, record.time, record.recordTime, record.record_time, record.createdAt, record.create_time];
  for (const item of candidates) {
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item === 'string') {
      const parsed = Date.parse(item);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
};

const getRecordKey = (record: AnyRecord, index: number) => {
  const raw = Array.isArray(record.raw) ? record.raw.join(',') : stringify(record.raw ?? record.payloadHex ?? record.hex ?? '');
  return [
    record.type || record.name || record.event || 'record',
    record.frameId ?? record.frame_id ?? '',
    getRecordTimestamp(record),
    raw,
    index
  ].join('|');
};

const mergedRecords = computed(() => {
  const records = [
    ...readArray(ringStore.receivedData),
    ...readArray(userStore.receivedData),
    ...readArray((ringStore as any).normalizedData),
    ...readArray((userStore as any).normalizedData)
  ];
  const dedup = new Map<string, AnyRecord>();
  records.forEach((record, index) => {
    dedup.set(getRecordKey(record, index), record);
  });
  return Array.from(dedup.values())
    .sort((a, b) => getRecordTimestamp(b) - getRecordTimestamp(a))
    .slice(0, 30);
});

const latestRecordViews = computed(() =>
  mergedRecords.value.map((record, index) => ({
    key: getRecordKey(record, index),
    title: String(record.type || record.name || record.event || '未知回执'),
    time: getRecordTimestamp(record) ? formatClock(getRecordTimestamp(record)) : '-',
    json: stringify(record)
  }))
);

const currentDevice = computed<AnyRecord>(() => {
  const ringDevice = unwrap<AnyRecord>(ringStore.deviceInfo) || {};
  const userDevice = unwrap<AnyRecord>(userStore.deviceInfo) || {};
  return { ...userDevice, ...ringDevice };
});

const latestMetrics = computed<AnyRecord>(() => {
  const ringMetrics = unwrap<AnyRecord>(ringStore.latestMetrics) || {};
  const userMetrics = unwrap<AnyRecord>(userStore.latestMetrics) || {};
  return { ...userMetrics, ...ringMetrics };
});

const connectedText = computed(() => {
  const isConnected = Boolean(unwrap(ringStore.isConnected) || unwrap(userStore.isConnected));
  return isConnected ? '已连接' : '未连接';
});

const batteryText = computed(() => {
  const value =
    currentDevice.value?.metrics?.battery ??
    currentDevice.value?.battery ??
    currentDevice.value?.batteryValue ??
    latestMetrics.value?.battery ??
    unwrap<any>(ringStore.healthData)?.battery ??
    unwrap<any>(userStore.healthData)?.battery;
  if (value === undefined || value === null || value === '') return '-';
  return `${value}%`;
});

const deviceRows = computed(() => [
  ['连接状态', connectedText.value],
  ['产品名称', currentDevice.value.modelName || currentDevice.value.productName || currentDevice.value.deviceName || '轻刻智能戒指'],
  [
    'BLE 名称',
    currentDevice.value.bleName || currentDevice.value.localName || currentDevice.value.bluetoothName || currentDevice.value.name || '-'
  ],
  ['通信 deviceId', currentDevice.value.deviceId || '-'],
  ['MAC', currentDevice.value.mac || currentDevice.value.uniMacId || currentDevice.value.advertis?.macInfo || '-'],
  ['协议', currentDevice.value.protocol || '-'],
  ['电量', batteryText.value],
  ['Service', currentDevice.value.serviceId || '-'],
  ['CMD Char', currentDevice.value.cmdCharId || '-'],
  ['DATA Char', currentDevice.value.dataCharId || '-']
]);

const pushLog = (title: string, status: DebugStatus, detail: unknown) => {
  logs.value.unshift({
    id: ++logSeq.value,
    time: formatClock(),
    title,
    status,
    detail: stringify(detail)
  });
  logs.value = logs.value.slice(0, 80);
};

const waitForReply = (matcher: (record: AnyRecord) => boolean, timeoutMs: number) =>
  new Promise<AnyRecord | null>((resolve) => {
    const startedAt = Date.now() - 1000;
    let settled = false;
    let stopWatch: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (record: AnyRecord | null) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        pendingTimers.delete(timer);
      }
      if (stopWatch) stopWatch();
      resolve(record);
    };

    stopWatch = watch(
      mergedRecords,
      (records) => {
        const hit = records.find((record) => {
          const timestamp = getRecordTimestamp(record);
          return (!timestamp || timestamp >= startedAt) && matcher(record);
        });
        if (hit) finish(hit);
      },
      { immediate: true }
    );

    timer = setTimeout(() => finish(null), timeoutMs);
    pendingTimers.add(timer);
  });

const typeContains = (record: AnyRecord, patterns: string[]) => {
  const target = [
    record.type,
    record.name,
    record.event,
    record.command,
    record.cmd,
    record.measureType,
    record.metricType,
    record.payloadType
  ]
    .map(normalizeText)
    .join('|');
  return patterns.some((pattern) => target.includes(pattern));
};

const normalizeTimestampMs = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value < 100000000000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const formatDateTime = (timestamp: unknown) => {
  const value = normalizeTimestampMs(timestamp);
  if (!value) return '-';
  const date = new Date(value);
  const pad = (item: number) => String(item).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const readHistoryRecords = (result: unknown): AnyRecord[] => {
  const item = unwrap<AnyRecord>(result);
  const candidates = [
    item?.records,
    item?.parsed?.records,
    item?.data?.records,
    item?.data?.parsed?.records,
    item?.result?.records,
    item?.result?.parsed?.records
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter(Boolean) as AnyRecord[];
  }
  return [];
};

const getLastNightSleepWindow = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 21, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0, 0, 0);
  return { start: start.getTime(), end: end.getTime() };
};

const summarizeHistoryResult = (result: unknown) => {
  const item = unwrap<AnyRecord>(result) || {};
  const records = readHistoryRecords(item);
  const timestamps = records
    .map((record) => normalizeTimestampMs(getRecordTimestamp(record)))
    .filter((value) => value > 0);
  const lastNightWindow = getLastNightSleepWindow();
  const lastNightRecords = records.filter((record) => {
    const timestamp = normalizeTimestampMs(getRecordTimestamp(record));
    return timestamp >= lastNightWindow.start && timestamp <= lastNightWindow.end;
  });
  const typeCount = records.reduce<Record<string, number>>((acc, record) => {
    const type = String(record.type || record.name || record.event || record.dataType || 'unknown');
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  const sleepSamples = records
    .filter((record) => record.sleepState !== undefined || record.sleep_state !== undefined || typeContains(record, ['sleep']))
    .slice(0, 30);
  return {
    status: item.status ?? item.data?.status ?? '-',
    uploaded: item.uploaded ?? item.data?.uploaded ?? false,
    deleted: item.deleted ?? item.data?.deleted ?? false,
    recordCount: records.length,
    minTime: timestamps.length ? formatDateTime(Math.min(...timestamps)) : '-',
    maxTime: timestamps.length ? formatDateTime(Math.max(...timestamps)) : '-',
    lastNightWindow: `${formatDateTime(lastNightWindow.start)} ~ ${formatDateTime(lastNightWindow.end)}`,
    lastNightRecordCount: lastNightRecords.length,
    lastNightSleepRecordCount: lastNightRecords.filter(
      (record) => record.sleepState !== undefined || record.sleep_state !== undefined || typeContains(record, ['sleep'])
    ).length,
    typeCount,
    sleepSampleCount: sleepSamples.length,
    sleepSamples
  };
};

const commandConfigs: CommandConfig[] = [
  {
    key: 'oxygen',
    label: '血氧测量',
    desc: '期待 active_OxyGenMeasure 回执',
    timeoutMs: 30000,
    run: () => Promise.resolve(ble.sendOxyGenCommand?.()),
    matcher: (record) =>
      typeContains(record, ['oxygen', 'oxygenmeasure', 'oxygen_measure', 'oxygenmeasure', 'active_oxygen', 'active_oxygenmeasure', 'oxygen']) ||
      typeContains(record, ['oxygen', 'oxygenmeasure', 'oxygen_measure', 'oxygenmeasure', 'oxygen']) ||
      typeContains(record, ['oxygen', 'oxygenmeasure', 'oxygen_measure', 'oxygenmeasure', 'oxygen', 'oxygen']) ||
      typeContains(record, ['oxygen', 'oxy']) ||
      record.type === 'active_OxyGenMeasure',
    timeoutText: '30秒内未收到 active_OxyGenMeasure / 血氧回执'
  },
  {
    key: 'heart',
    label: '心率/HRV测量',
    desc: '期待心率或 HRV 测量回执',
    timeoutMs: 30000,
    run: () => Promise.resolve(ble.sendActiveMeasureCommand?.()),
    matcher: (record) => typeContains(record, ['heartrate', 'heart_rate', 'hrv', 'active_heart']) || record.type === 'active_HeartRateMeasure',
    timeoutText: '30秒内未收到心率/HRV回执'
  },
  {
    key: 'temperature',
    label: '皮肤温度',
    desc: '期待温度测量回执',
    timeoutMs: 30000,
    run: () => Promise.resolve(ble.sendBodyTemperatureCommand?.()),
    matcher: (record) => typeContains(record, ['temperature', 'bodytemperature', 'temp']),
    timeoutText: '30秒内未收到皮肤温度回执'
  },
  {
    key: 'battery',
    label: '读取电量',
    desc: '读取电量/充电状态',
    timeoutMs: 12000,
    run: () => Promise.resolve(ble.readBattery?.() ?? ble.sendBatteryCommand?.()),
    matcher: (record) => typeContains(record, ['battery']) || record.battery !== undefined || record.valueName === 'battery',
    timeoutText: '12秒内未收到电量回执'
  },
  {
    key: 'deviceTime',
    label: '读取设备时间',
    desc: '确认设备时间命令是否有回包',
    timeoutMs: 12000,
    run: () => Promise.resolve(ble.readDeviceTime?.()),
    matcher: (record) => typeContains(record, ['time', 'devicetime', 'device_time']),
    timeoutText: '12秒内未收到设备时间回执'
  },
  {
    key: 'firmware',
    label: '固件版本',
    desc: '读取固件版本',
    timeoutMs: 12000,
    run: () => Promise.resolve(ble.readFirmwareVersion?.() ?? ble.sendFirmwareVersion?.()),
    matcher: (record) => typeContains(record, ['firmware', 'hardwareversion', 'version']),
    timeoutText: '12秒内未收到固件版本回执'
  },
  {
    key: 'software',
    label: '软件版本',
    desc: '读取软件版本',
    timeoutMs: 12000,
    run: () => Promise.resolve(ble.readSoftwareVersion?.() ?? ble.sendSoftwareVersion?.()),
    matcher: (record) => typeContains(record, ['software', 'softwareversion', 'version']),
    timeoutText: '12秒内未收到软件版本回执'
  },
  {
    key: 'historyAll',
    label: '全量历史',
    desc: '读取设备全部历史数据，skipUpload=true，仅用于排查设备是否返回昨晚数据',
    timeoutMs: 90000,
    run: async () => {
      const result = await ble.readLocalData?.(true, '', undefined, {
        timeoutMs: 90000,
        skipUpload: true,
        silentUploadStatus: true
      });
      return summarizeHistoryResult(result);
    },
    skipWait: true
  }
];

const commandRows = computed(() =>
  commandConfigs.map((item) => ({
    ...item,
    disabled: Boolean(runningKey.value) && runningKey.value !== item.key,
    running: runningKey.value === item.key
  }))
);

const runCollectPeriodTest = async (targetMinutes: number) => {
  if (runningKey.value) return;

  const targetSeconds = targetMinutes * 60;
  const startedAt = Date.now();
  const commandTarget: AnyRecord = {
    ...currentDevice.value,
    advertis: currentDevice.value.advertis ? { ...currentDevice.value.advertis } : undefined
  };
  const releaseCommandSession = tryClaimLegacyBleCommandSession(12000, {
    reason: 'ble-command-debug:collect-period',
    caller: 'bleCommandDebug.runCollectPeriodTest',
    deviceId: commandTarget.deviceId || commandTarget.mac || commandTarget.uniMacId || ''
  });
  if (!releaseCommandSession) {
    uni.showToast({ title: '设备正在同步，请稍后重试', icon: 'none' });
    return;
  }

  runningKey.value = 'collectPeriod';
  testingCollectPeriodMinutes.value = targetMinutes;
  let setAckError = '';
  pushLog('采集周期 - 开始测试', 'info', {
    targetMinutes,
    targetSeconds,
    deviceId: commandTarget.deviceId || '-',
    mac: commandTarget.mac || commandTarget.uniMacId || '-'
  });
  appendRingDiagnosticLog('BLE COMMAND DEBUG', 'collect-period-test-start', {
    targetMinutes,
    targetSeconds,
    deviceId: commandTarget.deviceId || '',
    deviceMac: commandTarget.mac || commandTarget.uniMacId || ''
  });

  try {
    if (typeof ble.waitForParsedData !== 'function') throw new Error('当前 BLE 适配器不支持回读等待');
    if (typeof ble.sendCollectPeriodSettingCommand !== 'function') throw new Error('当前设备不支持采集周期设置');
    if (typeof ble.readCollectPeriodCommand !== 'function') throw new Error('当前设备不支持采集周期回读');

    const setAckPromise = ble
      .waitForParsedData((parsed: AnyRecord) => parsed?.type === 'collect_period_set', 3000)
      .catch((error: unknown) => {
        setAckError = stringify(error);
        return null;
      });
    await ble.sendCollectPeriodSettingCommand(targetSeconds);
    const setAck = await setAckPromise;
    if (setAck && setAck.status && setAck.status !== 'success') {
      throw new Error('设备拒绝采集周期设置');
    }

    await new Promise((resolve) => setTimeout(resolve, 160));
    const readResultPromise = ble.waitForParsedData(
      (parsed: AnyRecord) => parsed?.type === 'collect_period_read',
      3500
    );
    await ble.readCollectPeriodCommand();
    const readResult: AnyRecord = await readResultPromise;
    const actualSeconds = Number(readResult?.period);
    if (!Number.isFinite(actualSeconds) || actualSeconds <= 0) {
      throw new Error('设备回读的采集周期无效');
    }

    const actualMinutes = actualSeconds / 60;
    const matched = actualSeconds === targetSeconds;
    const result = {
      targetMinutes,
      targetSeconds,
      actualMinutes,
      actualSeconds,
      matched,
      setAckStatus: setAck?.status || 'missing',
      setAckError,
      elapsedMs: Date.now() - startedAt,
      raw: readResult?.raw
    };
    pushLog(
      matched ? '采集周期 - 测试成功' : '采集周期 - 设备值不一致',
      matched ? 'success' : 'error',
      result
    );
    appendRingDiagnosticLog('BLE COMMAND DEBUG', 'collect-period-test-result', result);
    uni.showToast({
      title: matched ? `设备实际 ${actualMinutes} 分钟` : `目标${targetMinutes}，实际${actualMinutes}分钟`,
      icon: matched ? 'success' : 'none'
    });
  } catch (error) {
    const result = {
      targetMinutes,
      targetSeconds,
      setAckError,
      elapsedMs: Date.now() - startedAt,
      error: stringify(error)
    };
    pushLog('采集周期 - 测试失败', 'error', result);
    appendRingDiagnosticLog('BLE COMMAND DEBUG', 'collect-period-test-failed', result);
    uni.showToast({ title: '采集周期测试失败', icon: 'none' });
  } finally {
    releaseCommandSession();
    runningKey.value = '';
    testingCollectPeriodMinutes.value = 0;
  }
};

const isHeartRateMeasureRecord = (record: AnyRecord) =>
  record?.type === 'active_measure' ||
  typeContains(record, ['active_measure', 'heartrate', 'heart_rate', 'hrv']);

const getWearMeasureRecordSignature = (record: AnyRecord) =>
  [
    record?.type || record?.name || record?.event || '',
    record?.frameId ?? record?.frame_id ?? '',
    record?.heartbeatStatus ?? record?.metrics?.status ?? record?.status ?? '',
    record?.heartRate ?? record?.metrics?.heartRate ?? '',
    record?.heartRateVariability ?? record?.hrv ?? record?.metrics?.heartRateVariability ?? '',
    Array.isArray(record?.raw) ? record.raw.join(',') : stringify(record?.raw ?? record?.payloadHex ?? '')
  ].join('|');

const summarizeWearMeasureRecord = (record: AnyRecord) => ({
  type: record?.type || record?.name || record?.event || '-',
  frameId: record?.frameId ?? record?.frame_id ?? '-',
  heartbeatStatus: record?.heartbeatStatus ?? record?.metrics?.status ?? '-',
  status: record?.status ?? record?.statusText ?? record?.message ?? '-',
  isWorn: record?.isWorn ?? record?.is_worn ?? '-',
  heartRate: record?.heartRate ?? record?.metrics?.heartRate ?? '-',
  hrv: record?.heartRateVariability ?? record?.hrv ?? record?.metrics?.heartRateVariability ?? '-',
  receivedAt: record?.receivedAt ?? record?.parsedAt ?? record?.timestamp ?? '-',
  raw: record?.raw ?? record?.payloadHex ?? '-'
});

const isBatteryRecord = (record: AnyRecord) =>
  typeContains(record, ['battery']) ||
  record.battery !== undefined ||
  record.batteryLevel !== undefined ||
  record.batteryRawValue !== undefined ||
  record.valueName === 'battery';

const getBatteryRecordSignature = (record: AnyRecord) =>
  [
    getRecordTimestamp(record),
    record.frameId ?? record.frame_id ?? '',
    record.batteryRawValue ?? '',
    Array.isArray(record.raw) ? record.raw.join(',') : stringify(record.raw ?? '')
  ].join('|');

const summarizeBatteryRecord = (record: AnyRecord) => {
  const raw = Array.isArray(record.raw) ? record.raw : [];
  const rawValue = Number(record.batteryRawValue ?? (raw.length > 4 ? raw[4] : Number.NaN));
  const level = Number(record.battery ?? record.batteryLevel);
  const status =
    record.status ||
    (rawValue === 101 ? 'charging' : rawValue === 102 ? 'charged' : Number.isFinite(level) ? 'normal' : 'unknown');
  return {
    receivedAt: formatClock(getRecordTimestamp(record) || Date.now()),
    status,
    statusText: status === 'charging' ? '充电中' : status === 'charged' ? '充电完成' : status === 'normal' ? '正常电量' : '未知',
    batteryRawValue: Number.isFinite(rawValue) ? rawValue : null,
    battery: Number.isFinite(level) ? level : null,
    value: record.value ?? null,
    frameId: record.frameId ?? record.frame_id ?? null,
    raw
  };
};

const waitBatteryTest = (timeoutMs: number) =>
  new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingTimers.delete(timer);
      if (stopBatteryTestWait === finish) stopBatteryTestWait = null;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    pendingTimers.add(timer);
    stopBatteryTestWait = finish;
  });

const stopBatteryTest = () => {
  batteryTestStopRequested.value = true;
  stopBatteryTestWait?.();
};

const runBatteryIsolationTest = async (mode: 'passive' | 'polling') => {
  if (runningKey.value) return;

  const commandTarget: AnyRecord = {
    ...currentDevice.value,
    advertis: currentDevice.value.advertis ? { ...currentDevice.value.advertis } : undefined
  };
  const releaseCommandSession = tryClaimLegacyBleCommandSession(45000, {
    reason: `ble-command-debug:battery-${mode}`,
    caller: 'bleCommandDebug.runBatteryIsolationTest',
    deviceId: commandTarget.deviceId || commandTarget.mac || commandTarget.uniMacId || ''
  });
  if (!releaseCommandSession) {
    uni.showToast({ title: '设备正在同步，请稍后重试', icon: 'none' });
    return;
  }

  const startedAt = Date.now();
  const samples: AnyRecord[] = [];
  const connectionChanges: AnyRecord[] = [];
  const seen = new Set(mergedRecords.value.filter(isBatteryRecord).map(getBatteryRecordSignature));
  let lastConnectionText = connectedText.value;
  runningKey.value = 'batteryMonitor';
  batteryTestMode.value = mode;
  batteryTestStopRequested.value = false;

  const testLabel = mode === 'passive' ? '充电状态纯监听' : '充电状态定时查询';
  const recordBatterySample = (record: AnyRecord, source: '主动上报' | '命令查询') => {
    const signature = getBatteryRecordSignature(record);
    if (seen.has(signature)) return;
    seen.add(signature);
    const sample = { source, ...summarizeBatteryRecord(record) };
    samples.push(sample);
    pushLog(`${testLabel} - 收到电量帧`, 'success', sample);
    appendRingDiagnosticLog('BLE COMMAND DEBUG', 'battery-isolation-sample', {
      mode,
      deviceId: commandTarget.deviceId || '',
      deviceMac: commandTarget.mac || commandTarget.uniMacId || '',
      ...sample
    });
  };

  const stopRecordWatch = watch(
    mergedRecords,
    (records) => {
      records.forEach((record) => {
        if (!isBatteryRecord(record)) return;
        const timestamp = getRecordTimestamp(record);
        if (timestamp && timestamp < startedAt - 500) return;
        recordBatterySample(record, mode === 'passive' ? '主动上报' : '命令查询');
      });
    },
    { deep: true }
  );
  const stopConnectionWatch = watch(connectedText, (value) => {
    if (value === lastConnectionText) return;
    const change = {
      time: formatClock(),
      from: lastConnectionText,
      to: value,
      elapsedMs: Date.now() - startedAt
    };
    lastConnectionText = value;
    connectionChanges.push(change);
    pushLog(`${testLabel} - 连接状态变化`, value === '已连接' ? 'success' : 'error', change);
  });

  pushLog(`${testLabel} - 开始`, 'info', {
    durationSeconds: 30,
    mode: mode === 'passive' ? '不发送任何命令，只观察设备主动通知' : '每5秒读取一次电量，不读取历史、不上传数据',
    operation: '现在将戒指放入充电仓，再拿出充电仓',
    deviceId: commandTarget.deviceId || '-',
    mac: commandTarget.mac || commandTarget.uniMacId || '-'
  });
  appendRingDiagnosticLog('BLE COMMAND DEBUG', 'battery-isolation-start', {
    mode,
    deviceId: commandTarget.deviceId || '',
    deviceMac: commandTarget.mac || commandTarget.uniMacId || ''
  });

  try {
    if (mode === 'passive') {
      await waitBatteryTest(30000);
    } else {
      const deadline = startedAt + 30000;
      let sequence = 0;
      while (!batteryTestStopRequested.value && Date.now() < deadline) {
        sequence += 1;
        try {
          if (typeof ble.readBattery !== 'function') throw new Error('当前 BLE 适配器不支持电量读取');
          const result = await ble.readBattery({ timeoutMs: 3500, retryReady: false });
          if (result && isBatteryRecord(result)) recordBatterySample(result, '命令查询');
        } catch (error) {
          pushLog(`${testLabel} - 第${sequence}次查询失败`, 'error', {
            connected: connectedText.value,
            elapsedMs: Date.now() - startedAt,
            error: stringify(error)
          });
        }
        if (batteryTestStopRequested.value || Date.now() >= deadline) break;
        await waitBatteryTest(Math.min(5000, Math.max(0, deadline - Date.now())));
      }
    }

    const chargingSamples = samples.filter((item) => item.batteryRawValue === 101 || item.status === 'charging');
    const chargedSamples = samples.filter((item) => item.batteryRawValue === 102 || item.status === 'charged');
    const result = {
      mode,
      stoppedManually: batteryTestStopRequested.value,
      elapsedMs: Date.now() - startedAt,
      sampleCount: samples.length,
      chargingSampleCount: chargingSamples.length,
      chargedSampleCount: chargedSamples.length,
      connectionChanges,
      conclusion:
        mode === 'passive'
          ? chargingSamples.length || chargedSamples.length
            ? '监听到充电状态，固件存在主动上报'
            : '未监听到充电状态；请再执行定时查询测试'
          : chargingSamples.length || chargedSamples.length
            ? '查询命令可以读到充电状态'
            : '查询命令未读到101/102，请对比原始帧与连接变化'
    };
    pushLog(`${testLabel} - 完成`, chargingSamples.length || chargedSamples.length ? 'success' : 'info', result);
    appendRingDiagnosticLog('BLE COMMAND DEBUG', 'battery-isolation-result', {
      ...result,
      deviceId: commandTarget.deviceId || '',
      deviceMac: commandTarget.mac || commandTarget.uniMacId || ''
    });
    uni.showToast({ title: result.conclusion, icon: 'none', duration: 3000 });
  } finally {
    stopRecordWatch();
    stopConnectionWatch();
    stopBatteryTestWait = null;
    releaseCommandSession();
    runningKey.value = '';
    batteryTestMode.value = '';
    batteryTestStopRequested.value = false;
  }
};

/**
 * 复现业务页当前的真实链路：通信就绪 -> 佩戴前置门禁 -> 复用同一条心率测量 -> 最终数值。
 * 测试过程中不读取历史、不上传健康数据；每个阶段及原始解析帧都会回传诊断日志。
 */
const runWearMeasureChainTest = async () => {
  if (runningKey.value) return;

  const commandTarget: AnyRecord = {
    ...currentDevice.value,
    advertis: currentDevice.value.advertis ? { ...currentDevice.value.advertis } : undefined
  };
  const releaseCommandSession = tryClaimLegacyBleCommandSession(45_000, {
    reason: 'ble-command-debug:wear-measure',
    caller: 'bleCommandDebug.runWearMeasureChainTest',
    deviceId: commandTarget.deviceId || commandTarget.mac || commandTarget.uniMacId || ''
  });
  if (!releaseCommandSession) {
    uni.showToast({ title: '设备正在同步，请稍后重试', icon: 'none' });
    return;
  }

  runningKey.value = 'wearMeasure';
  const startedAt = Date.now();
  const capturedFrames: AnyRecord[] = [];
  const initialSignatures = new Set(
    mergedRecords.value.filter(isHeartRateMeasureRecord).map(getWearMeasureRecordSignature)
  );
  const capturedSignatures = new Set<string>();
  let preflightResult: AnyRecord | null = null;
  let measureResult: unknown = null;

  const captureRecords = (records: AnyRecord[]) => {
    records.filter(isHeartRateMeasureRecord).forEach((record) => {
      const signature = getWearMeasureRecordSignature(record);
      if (initialSignatures.has(signature) || capturedSignatures.has(signature)) return;
      capturedSignatures.add(signature);
      const sample = summarizeWearMeasureRecord(record);
      capturedFrames.push(sample);
      pushLog('佩戴门禁链路 - 收到心率帧', 'info', sample);
      appendRingDiagnosticLog('BLE COMMAND DEBUG', 'wear-measure-chain-frame', {
        elapsedMs: Date.now() - startedAt,
        deviceId: commandTarget.deviceId || '',
        deviceMac: commandTarget.mac || commandTarget.uniMacId || '',
        ...sample
      });
    });
  };
  const stopCapture = watch(mergedRecords, captureRecords, { deep: true });

  pushLog('佩戴门禁链路 - 开始测试', 'info', {
    step: '通信就绪 -> 佩戴状态 -> 心率最终值',
    deviceId: commandTarget.deviceId || '-',
    mac: commandTarget.mac || commandTarget.uniMacId || '-',
    protocol: commandTarget.protocol || '-',
    note: '请正确佩戴并保持手部静止约30秒；测试不读取历史、不上传健康数据'
  });
  appendRingDiagnosticLog('BLE COMMAND DEBUG', 'wear-measure-chain-start', {
    deviceId: commandTarget.deviceId || '',
    deviceMac: commandTarget.mac || commandTarget.uniMacId || '',
    protocol: commandTarget.protocol || ''
  });

  try {
    const readyStartedAt = Date.now();
    const ready = await ble.ensureCommunicationReady?.();
    pushLog('佩戴门禁链路 - 通信就绪', ready ? 'success' : 'error', {
      ready: Boolean(ready),
      elapsedMs: Date.now() - readyStartedAt
    });
    if (!ready) throw new Error('设备通信未就绪');
    if (typeof ble.queryCurrentWearState !== 'function') throw new Error('当前版本未提供佩戴门禁命令');

    const preflightStartedAt = Date.now();
    preflightResult = await ble.queryCurrentWearState('heart_rate', 8000);
    const preflightLog = {
      supported: preflightResult?.supported,
      protocol: preflightResult?.protocol,
      state: preflightResult?.state,
      elapsedMs: Date.now() - preflightStartedAt,
      record: summarizeWearMeasureRecord(preflightResult?.record || {})
    };
    pushLog(
      '佩戴门禁链路 - 门禁结果',
      preflightResult?.state === 'worn' ? 'success' : 'error',
      preflightLog
    );
    appendRingDiagnosticLog('BLE COMMAND DEBUG', 'wear-measure-chain-preflight', {
      deviceId: commandTarget.deviceId || '',
      deviceMac: commandTarget.mac || commandTarget.uniMacId || '',
      ...preflightLog
    });

    if (preflightResult?.state !== 'worn') {
      throw new Error(`佩戴门禁未放行：${String(preflightResult?.state || 'unknown')}`);
    }

    const measureStartedAt = Date.now();
    measureResult = await ble.refreshHealthData?.({
      includeDeviceTime: false,
      includeCollectPeriod: false,
      includeDeviceInfo: false,
      includeRealtimeMetrics: true,
      includeHistorySnapshot: false,
      realtimeMetricNames: ['heart_rate'],
      timeoutMs: 35_000
    });
    captureRecords(mergedRecords.value);
    const directRecord = (measureResult as AnyRecord)?.record as AnyRecord | undefined;
    const finalFrame = [...capturedFrames]
      .reverse()
      .find((record) => Number(record.heartRate) > 0) ||
      (Number(directRecord?.heartRate) > 0 ? summarizeWearMeasureRecord(directRecord || {}) : undefined);
    const succeeded = Boolean(finalFrame && Number(finalFrame.heartRate) > 0);
    const report = {
      succeeded,
      elapsedMs: Date.now() - startedAt,
      preflightState: preflightResult?.state || 'unknown',
      measureElapsedMs: Date.now() - measureStartedAt,
      measureResult,
      frameCount: capturedFrames.length,
      frames: capturedFrames,
      finalHeartRate: finalFrame?.heartRate ?? null
    };
    lastWearMeasureReport.value = report;
    pushLog(
      succeeded ? '佩戴门禁链路 - 测试成功' : '佩戴门禁链路 - 未收到最终值',
      succeeded ? 'success' : 'error',
      report
    );
    appendRingDiagnosticLog('BLE COMMAND DEBUG', 'wear-measure-chain-result', {
      deviceId: commandTarget.deviceId || '',
      deviceMac: commandTarget.mac || commandTarget.uniMacId || '',
      ...report
    });
    uni.showToast({ title: succeeded ? `心率 ${finalFrame?.heartRate}` : '未收到最终心率', icon: succeeded ? 'success' : 'none' });
  } catch (error) {
    captureRecords(mergedRecords.value);
    const report = {
      succeeded: false,
      elapsedMs: Date.now() - startedAt,
      preflightState: preflightResult?.state || 'unknown',
      measureResult,
      frameCount: capturedFrames.length,
      frames: capturedFrames,
      error: stringify(error)
    };
    lastWearMeasureReport.value = report;
    pushLog('佩戴门禁链路 - 测试失败', 'error', report);
    appendRingDiagnosticLog('BLE COMMAND DEBUG', 'wear-measure-chain-failed', {
      deviceId: commandTarget.deviceId || '',
      deviceMac: commandTarget.mac || commandTarget.uniMacId || '',
      ...report
    });
    uni.showToast({ title: '门禁链路测试失败', icon: 'none' });
  } finally {
    stopCapture();
    releaseCommandSession();
    runningKey.value = '';
  }
};

const copyWearMeasureReport = () => {
  if (!lastWearMeasureReport.value) {
    uni.showToast({ title: '请先执行测试', icon: 'none' });
    return;
  }
  uni.setClipboardData({
    data: stringify(lastWearMeasureReport.value),
    success: () => uni.showToast({ title: '测试日志已复制', icon: 'success' })
  });
};

const normalizeBleIdentity = (value: unknown) => String(value ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();

const bytesToHex = (bytes: Uint8Array, maxLength = 24) =>
  Array.from(bytes.slice(0, maxLength))
    .map((value) => value.toString(16).padStart(2, '0').toUpperCase())
    .join('');

const waitForMtuHistoryObservation = (timeoutMs: number) =>
  new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingTimers.delete(timer);
      if (stopMtuHistoryObservationWait === finish) stopMtuHistoryObservationWait = null;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    pendingTimers.add(timer);
    stopMtuHistoryObservationWait = finish;
  });

const requestBleMtu = (deviceId: string, mtu: number) =>
  new Promise<AnyRecord>((resolve) => {
    const api = uni as any;
    if (typeof api.setBLEMTU !== 'function') {
      resolve({ supported: false, ok: false, requestedMtu: mtu, error: 'setBLEMTU API unavailable' });
      return;
    }
    api.setBLEMTU({
      deviceId,
      mtu,
      success: (result: unknown) => resolve({ supported: true, ok: true, requestedMtu: mtu, result }),
      fail: (error: unknown) => resolve({ supported: true, ok: false, requestedMtu: mtu, error })
    });
  });

const readBleMtu = (deviceId: string, writeType: 'write' | 'writeNoResponse') =>
  new Promise<AnyRecord>((resolve) => {
    const api = uni as any;
    if (typeof api.getBLEMTU !== 'function') {
      resolve({ supported: false, ok: false, writeType, error: 'getBLEMTU API unavailable' });
      return;
    }
    api.getBLEMTU({
      deviceId,
      writeType,
      success: (result: AnyRecord) => resolve({ supported: true, ok: true, writeType, mtu: Number(result?.mtu) || null, result }),
      fail: (error: unknown) => resolve({ supported: true, ok: false, writeType, error })
    });
  });

const waitWearObservation = (timeoutMs: number) =>
  new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingTimers.delete(timer);
      if (stopWearObservationWait === finish) stopWearObservationWait = null;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    pendingTimers.add(timer);
    stopWearObservationWait = finish;
  });

/**
 * 仅在 BLE 测试页验证“未佩戴”门禁，不调用 refreshHealthData，也不修改业务状态。
 * 旧协议的佩戴探测本身会发送正式测量命令，因此门禁返回后继续监听一段时间，
 * 用于区分“状态误判为 worn”和“状态已拦截但探测命令仍产生数据帧”。
 */
const runNotWornGateValidation = async () => {
  if (runningKey.value) return;

  const commandTarget: AnyRecord = {
    ...currentDevice.value,
    advertis: currentDevice.value.advertis ? { ...currentDevice.value.advertis } : undefined
  };
  const releaseCommandSession = tryClaimLegacyBleCommandSession(45_000, {
    reason: 'ble-command-debug:wear-not-worn-validation',
    caller: 'bleCommandDebug.runNotWornGateValidation',
    deviceId: commandTarget.deviceId || commandTarget.mac || commandTarget.uniMacId || ''
  });
  if (!releaseCommandSession) {
    uni.showToast({ title: '设备正在同步，请稍后重试', icon: 'none' });
    return;
  }

  runningKey.value = 'wearNotWorn';
  const startedAt = Date.now();
  const frames: AnyRecord[] = [];
  const initialSignatures = new Set(
    mergedRecords.value.filter(isHeartRateMeasureRecord).map(getWearMeasureRecordSignature)
  );
  const capturedSignatures = new Set<string>();
  let preflightResult: AnyRecord | null = null;

  const captureRecords = (records: AnyRecord[]) => {
    records.filter(isHeartRateMeasureRecord).forEach((record) => {
      const signature = getWearMeasureRecordSignature(record);
      if (initialSignatures.has(signature) || capturedSignatures.has(signature)) return;
      capturedSignatures.add(signature);
      const sample = summarizeWearMeasureRecord(record);
      frames.push(sample);
      pushLog('未佩戴校验 - 收到探测帧', 'info', sample);
      appendRingDiagnosticLog('BLE COMMAND DEBUG', 'wear-not-worn-frame', {
        elapsedMs: Date.now() - startedAt,
        deviceId: commandTarget.deviceId || '',
        deviceMac: commandTarget.mac || commandTarget.uniMacId || '',
        ...sample
      });
    });
  };
  const stopCapture = watch(mergedRecords, captureRecords, { deep: true });

  pushLog('未佩戴门禁校验 - 开始', 'info', {
    expected: '请将戒指完全摘下并放在桌面，再执行本测试',
    steps: '通信就绪 -> 只发佩戴探测 -> 不调用业务刷新 -> 监听探测回包',
    deviceId: commandTarget.deviceId || '-',
    mac: commandTarget.mac || commandTarget.uniMacId || '-',
    protocol: commandTarget.protocol || '-'
  });
  appendRingDiagnosticLog('BLE COMMAND DEBUG', 'wear-not-worn-start', {
    deviceId: commandTarget.deviceId || '',
    deviceMac: commandTarget.mac || commandTarget.uniMacId || '',
    protocol: commandTarget.protocol || ''
  });

  try {
    const ready = await ble.ensureCommunicationReady?.();
    if (!ready) throw new Error('设备通信未就绪');
    if (typeof ble.queryCurrentWearState !== 'function') throw new Error('当前版本未提供佩戴门禁命令');

    const preflightStartedAt = Date.now();
    preflightResult = await ble.queryCurrentWearState('heart_rate', 8000);
    const preflightState = String(preflightResult?.state || 'unknown');
    const observationMs = preflightState === 'worn' ? 32_000 : 12_000;
    pushLog('未佩戴门禁校验 - 门禁回包', preflightState === 'not_worn' ? 'success' : 'error', {
      supported: preflightResult?.supported,
      protocol: preflightResult?.protocol,
      expectedState: 'not_worn',
      actualState: preflightState,
      elapsedMs: Date.now() - preflightStartedAt,
      observationMs,
      record: summarizeWearMeasureRecord(preflightResult?.record || {})
    });

    // 不调用 refreshHealthData。这里收到的数据只能来自佩戴探测命令自身或设备主动通知。
    await waitWearObservation(observationMs);
    captureRecords(mergedRecords.value);

    const valueFrames = frames.filter((record) => Number(record.heartRate) > 0);
    const gateBlocked = preflightState !== 'worn';
    const stateConfirmed = preflightState === 'not_worn';
    const valueReturnedAfterProbe = valueFrames.length > 0;
    const passed = stateConfirmed;
    const conclusion = !gateBlocked
      ? '失败：戒指已摘下，但门禁仍判定为已佩戴，业务会被错误放行'
      : !stateConfirmed
        ? `门禁已阻断，但返回状态为 ${preflightState}，尚未明确确认未佩戴`
        : valueReturnedAfterProbe
          ? '门禁状态判定正确，但探测命令仍返回心率数据；业务页必须忽略门禁失败后的这些帧'
          : '通过：未佩戴状态识别正确，且观察期内没有返回心率数值';
    const report = {
      testMode: 'not-worn-gate-only',
      passed,
      conclusion,
      expectedState: 'not_worn',
      actualState: preflightState,
      gateBlocked,
      businessRefreshDispatched: false,
      valueReturnedAfterProbe,
      finalHeartRate: valueFrames[valueFrames.length - 1]?.heartRate ?? null,
      elapsedMs: Date.now() - startedAt,
      frameCount: frames.length,
      frames,
      preflightRecord: preflightResult?.record || null
    };
    lastWearMeasureReport.value = report;
    pushLog('未佩戴门禁校验 - 结论', passed ? 'success' : 'error', report);
    appendRingDiagnosticLog('BLE COMMAND DEBUG', 'wear-not-worn-result', {
      deviceId: commandTarget.deviceId || '',
      deviceMac: commandTarget.mac || commandTarget.uniMacId || '',
      ...report
    });
    uni.showToast({ title: conclusion, icon: 'none', duration: 4000 });
  } catch (error) {
    captureRecords(mergedRecords.value);
    const report = {
      testMode: 'not-worn-gate-only',
      passed: false,
      expectedState: 'not_worn',
      actualState: preflightResult?.state || 'unknown',
      businessRefreshDispatched: false,
      elapsedMs: Date.now() - startedAt,
      frameCount: frames.length,
      frames,
      error: stringify(error)
    };
    lastWearMeasureReport.value = report;
    pushLog('未佩戴门禁校验 - 失败', 'error', report);
    appendRingDiagnosticLog('BLE COMMAND DEBUG', 'wear-not-worn-failed', {
      deviceId: commandTarget.deviceId || '',
      deviceMac: commandTarget.mac || commandTarget.uniMacId || '',
      ...report
    });
    uni.showToast({ title: '未佩戴门禁校验失败', icon: 'none' });
  } finally {
    stopWearObservationWait?.();
    stopCapture();
    releaseCommandSession();
    runningKey.value = '';
  }
};

/**
 * Android/Huawei compatibility probe for the L19 history channel.
 * It deliberately sends exactly one incremental history command and never
 * disconnects, uploads, deletes, or mutates health data.
 */
const runMtuHistoryCompatibilityTest = async () => {
  if (runningKey.value) return;

  const initialTarget: AnyRecord = {
    ...currentDevice.value,
    advertis: currentDevice.value.advertis ? { ...currentDevice.value.advertis } : undefined
  };
  const releaseCommandSession = tryClaimLegacyBleCommandSession(30_000, {
    reason: 'ble-command-debug:mtu-history',
    caller: 'bleCommandDebug.runMtuHistoryCompatibilityTest',
    deviceId: initialTarget.deviceId || initialTarget.mac || initialTarget.uniMacId || ''
  });
  if (!releaseCommandSession) {
    uni.showToast({ title: '设备正在同步，请稍后重试', icon: 'none' });
    return;
  }

  runningKey.value = 'mtuHistory';
  lastMtuHistoryReport.value = null;
  const startedAt = Date.now();
  const rawPackets: AnyRecord[] = [];
  const connectionEvents: AnyRecord[] = [];
  const packetLengthCounts: Record<string, number> = {};
  let totalNotifyCount = 0;
  let historyNotifyCount = 0;
  let shortPacketCount = 0;
  let firstNotifyElapsedMs: number | null = null;
  let lastNotifyElapsedMs: number | null = null;
  let firstHistoryNotifyElapsedMs: number | null = null;
  let target: AnyRecord = initialTarget;
  let deviceId = String(initialTarget.deviceId || '');
  let setMtuResult: AnyRecord | null = null;
  let mtuBefore: AnyRecord | null = null;
  let mtuAfter: AnyRecord | null = null;
  let commandResult: unknown = null;
  let commandWritten = false;

  pushLog('MTU/历史链路 - 开始测试', 'info', {
    purpose: '验证华为手机实际 MTU、历史 Notify 分片及物理断开',
    mode: '单次增量历史命令，观察10秒；不主动断开、不上传、不删除数据',
    deviceId: initialTarget.deviceId || '-',
    mac: initialTarget.mac || initialTarget.uniMacId || '-'
  });

  try {
    const readyStartedAt = Date.now();
    const ready = await ble.ensureCommunicationReady?.();
    if (!ready) throw new Error('设备通信未就绪');

    target = {
      ...currentDevice.value,
      advertis: currentDevice.value.advertis ? { ...currentDevice.value.advertis } : undefined
    };
    deviceId = String(target.deviceId || initialTarget.deviceId || '');
    const protocol = String(target.protocol || initialTarget.protocol || '');
    if (!deviceId) throw new Error('缺少当前通信 deviceId');
    if (protocol && protocol !== 'legacy') throw new Error(`当前测试仅适用于 L19/legacy，实际协议为 ${protocol}`);

    const api = uni as any;
    const adapter = ble.adapter as AnyRecord | undefined;
    if (!adapter || typeof adapter.sendReadLocalDataCommand !== 'function') {
      throw new Error('当前适配器不支持原始历史命令测试');
    }

    const systemInfo = (() => {
      try {
        const info = api.getSystemInfoSync?.() || {};
        return {
          brand: info.brand,
          model: info.model,
          platform: info.platform,
          system: info.system,
          version: info.version,
          SDKVersion: info.SDKVersion
        };
      } catch (error) {
        return { error: stringify(error) };
      }
    })();
    const targetIdentity = normalizeBleIdentity(deviceId);
    const notifyHandler = (result: AnyRecord) => {
      if (targetIdentity && normalizeBleIdentity(result?.deviceId) !== targetIdentity) return;
      const bytes = new Uint8Array(result?.value || new ArrayBuffer(0));
      const packet = {
        elapsedMs: Date.now() - startedAt,
        deviceId: result?.deviceId || '',
        serviceId: result?.serviceId || '',
        characteristicId: result?.characteristicId || '',
        byteLength: bytes.byteLength,
        frameType: bytes.length > 0 ? `0x${bytes[0].toString(16).padStart(2, '0').toUpperCase()}` : '-',
        frameId: bytes.length > 1 ? bytes[1] : null,
        command: bytes.length > 2 ? `0x${bytes[2].toString(16).padStart(2, '0').toUpperCase()}` : '-',
        subcommand: bytes.length > 3 ? `0x${bytes[3].toString(16).padStart(2, '0').toUpperCase()}` : '-',
        headHex: bytesToHex(bytes)
      };
      totalNotifyCount += 1;
      firstNotifyElapsedMs ??= packet.elapsedMs;
      lastNotifyElapsedMs = packet.elapsedMs;
      packetLengthCounts[String(packet.byteLength)] = (packetLengthCounts[String(packet.byteLength)] || 0) + 1;
      if (packet.command === '0x36') {
        historyNotifyCount += 1;
        firstHistoryNotifyElapsedMs ??= packet.elapsedMs;
      }
      if (packet.byteLength > 0 && packet.byteLength < 29) shortPacketCount += 1;
      // Keep a bounded in-memory sample for the copied report. Uploading every
      // history frame produced hundreds of diagnostic rows and displaced the
      // connection/MTU evidence that this test is intended to capture.
      if (rawPackets.length < 24) rawPackets.push(packet);
      if (totalNotifyCount === 1 || (packet.command === '0x36' && historyNotifyCount === 1)) {
        appendRingDiagnosticLog('BLE COMMAND DEBUG', 'mtu-history-test-first-notify', {
          ...packet,
          deviceId,
          deviceMac: target.mac || target.uniMacId || ''
        });
      }
    };
    const connectionHandler = (result: AnyRecord) => {
      if (targetIdentity && normalizeBleIdentity(result?.deviceId) !== targetIdentity) return;
      const event = {
        elapsedMs: Date.now() - startedAt,
        deviceId: result?.deviceId || '',
        connected: Boolean(result?.connected)
      };
      connectionEvents.push(event);
      pushLog(
        'MTU/历史链路 - 连接状态变化',
        event.connected ? 'success' : 'error',
        event
      );
      appendRingDiagnosticLog('BLE COMMAND DEBUG', 'mtu-history-test-connection', {
        deviceMac: target.mac || target.uniMacId || '',
        ...event
      });
    };

    api.onBLECharacteristicValueChange?.(notifyHandler);
    api.onBLEConnectionStateChange?.(connectionHandler);
    stopMtuHistoryCapture = () => {
      api.offBLECharacteristicValueChange?.(notifyHandler);
      api.offBLEConnectionStateChange?.(connectionHandler);
      stopMtuHistoryCapture = null;
    };

    pushLog('MTU/历史链路 - 通信就绪', 'success', {
      elapsedMs: Date.now() - readyStartedAt,
      systemInfo,
      deviceId,
      mac: target.mac || target.uniMacId || '-',
      serviceId: target.serviceId || '-',
      dataCharId: target.dataCharId || '-'
    });

    mtuBefore = await readBleMtu(deviceId, 'writeNoResponse');
    setMtuResult = await requestBleMtu(deviceId, 247);
    await new Promise((resolve) => setTimeout(resolve, 250));
    mtuAfter = await readBleMtu(deviceId, 'writeNoResponse');
    pushLog('MTU/历史链路 - MTU协商结果', mtuAfter.ok ? 'success' : 'error', {
      before: mtuBefore,
      request: setMtuResult,
      after: mtuAfter,
      minimumRequiredMtu: 32,
      recommendedMtu: 92,
      note: '历史帧至少29字节，ATT有效载荷为 MTU-3；理论最长89字节时建议 MTU≥92'
    });
    appendRingDiagnosticLog('BLE COMMAND DEBUG', 'mtu-history-test-mtu-result', {
      deviceId,
      deviceMac: target.mac || target.uniMacId || '',
      systemInfo,
      mtuBefore,
      setMtuResult,
      mtuAfter
    });

    const sinceTimestamp = Math.max(0, Math.floor(Date.now() / 1000) - 48 * 60 * 60);
    const commandStartedAt = Date.now();
    commandResult = await adapter.sendReadLocalDataCommand(sinceTimestamp, false);
    commandWritten = true;
    pushLog('MTU/历史链路 - 历史命令已写入', 'success', {
      elapsedMs: Date.now() - commandStartedAt,
      command: '0x36/0x00',
      sinceTimestamp,
      retryCount: 0,
      result: commandResult
    });
    appendRingDiagnosticLog('BLE COMMAND DEBUG', 'mtu-history-test-command-written', {
      deviceId,
      deviceMac: target.mac || target.uniMacId || '',
      command: '0x36/0x00',
      sinceTimestamp,
      retryCount: 0,
      result: commandResult
    });

    await waitForMtuHistoryObservation(10_000);
    adapter.finishHistoryReadTrace?.('ble-debug-mtu-history-observation-finished', {
      observationMs: 10_000,
      packetCount: totalNotifyCount
    });

    const actualMtu = Number(mtuAfter?.mtu || mtuBefore?.mtu) || null;
    const disconnected = connectionEvents.some((event) => event.connected === false);
    let finalConnected: boolean | null = null;
    try {
      if (typeof ble.isDeviceConnected === 'function' && target.serviceId) {
        finalConnected = Boolean(await ble.isDeviceConnected(deviceId, target.serviceId));
      }
    } catch {
      finalConnected = false;
    }

    const conclusion = disconnected
      ? '失败：历史读取过程中发生物理断开'
      : historyNotifyCount === 0
        ? '异常：命令写入成功，但10秒内未收到0x36历史Notify'
        : shortPacketCount > 0
          ? '异常：收到短分片，需验证历史帧重组'
          : '通过：收到完整历史Notify，连接未断开';
    const passed = !disconnected && historyNotifyCount > 0 && shortPacketCount === 0;
    const report = {
      passed,
      conclusion,
      elapsedMs: Date.now() - startedAt,
      summary: {
        actualMtu,
        effectivePayload: actualMtu ? Math.max(0, actualMtu - 3) : null,
        commandWritten,
        totalNotifyCount,
        historyNotifyCount,
        shortPacketCount,
        packetLengthCounts,
        firstNotifyElapsedMs,
        firstHistoryNotifyElapsedMs,
        lastNotifyElapsedMs,
        disconnected,
        finalConnected
      },
      systemInfo,
      device: {
        deviceId,
        mac: target.mac || target.uniMacId || '',
        protocol: target.protocol || 'legacy',
        serviceId: target.serviceId || '',
        dataCharId: target.dataCharId || ''
      },
      mtu: {
        requested: 247,
        actual: actualMtu,
        effectivePayload: actualMtu ? Math.max(0, actualMtu - 3) : null,
        minimumRequiredMtu: 32,
        recommendedMtu: 92,
        before: mtuBefore,
        request: setMtuResult,
        after: mtuAfter
      },
      history: {
        command: '0x36/0x00',
        commandWritten,
        retryCount: 0,
        commandResult,
        observationMs: 10_000,
        packetCount: totalNotifyCount,
        historyPacketCount: historyNotifyCount,
        packetLengthCounts,
        shortPacketCount,
        firstNotifyElapsedMs,
        firstHistoryNotifyElapsedMs,
        lastNotifyElapsedMs,
        packetSamples: rawPackets
      },
      connection: {
        disconnected,
        finalConnected,
        events: connectionEvents
      }
    };
    lastMtuHistoryReport.value = report;
    pushLog('MTU/历史链路 - 测试结论', passed ? 'success' : 'error', report);
    appendRingDiagnosticLog('BLE COMMAND DEBUG', 'mtu-history-test-result', report);
    uni.showToast({ title: passed ? '链路测试通过' : '已记录异常证据', icon: passed ? 'success' : 'none', duration: 3000 });
  } catch (error) {
    const report = {
      passed: false,
      conclusion: '测试执行失败',
      elapsedMs: Date.now() - startedAt,
      deviceId,
      deviceMac: target.mac || target.uniMacId || '',
      commandWritten,
      mtuBefore,
      setMtuResult,
      mtuAfter,
      packetCount: totalNotifyCount,
      historyNotifyCount,
      shortPacketCount,
      packetLengthCounts,
      packetSamples: rawPackets,
      connectionEvents,
      error: stringify(error)
    };
    lastMtuHistoryReport.value = report;
    pushLog('MTU/历史链路 - 测试失败', 'error', report);
    appendRingDiagnosticLog('BLE COMMAND DEBUG', 'mtu-history-test-failed', report);
    uni.showToast({ title: 'MTU链路测试失败', icon: 'none' });
  } finally {
    stopMtuHistoryObservationWait?.();
    stopMtuHistoryCapture?.();
    try {
      (ble.adapter as AnyRecord | undefined)?.finishHistoryReadTrace?.('ble-debug-mtu-history-test-finished', {
        packetCount: totalNotifyCount
      });
    } catch {
      // Test cleanup must never alter the connection state.
    }
    releaseCommandSession();
    runningKey.value = '';
  }
};

const copyMtuHistoryReport = () => {
  if (!lastMtuHistoryReport.value) {
    uni.showToast({ title: '请先执行测试', icon: 'none' });
    return;
  }
  uni.setClipboardData({
    data: stringify(lastMtuHistoryReport.value),
    success: () => uni.showToast({ title: '测试报告已复制', icon: 'success' })
  });
};

const runCommand = async (config: CommandConfig) => {
  if (runningKey.value) return;
  // Keep an immutable identity for the whole command. A physical disconnect
  // clears the stores, so recovery must not read its target from page state.
  const commandTarget: AnyRecord = {
    ...currentDevice.value,
    advertis: currentDevice.value.advertis ? { ...currentDevice.value.advertis } : undefined
  };
  const releaseCommandSession = tryClaimLegacyBleCommandSession(config.timeoutMs, {
    reason: `ble-command-debug:${config.key}`,
    caller: 'bleCommandDebug.runCommand',
    deviceId: commandTarget.deviceId || commandTarget.mac || commandTarget.uniMacId || ''
  });
  if (!releaseCommandSession) {
    uni.showToast({ title: '设备正在同步，请稍后重试', icon: 'none' });
    return;
  }
  runningKey.value = config.key;
  pushLog(`${config.label} - 发送`, 'info', {
    deviceId: commandTarget.deviceId || '-',
    mac: commandTarget.mac || commandTarget.uniMacId || '-',
    expect: config.desc
  });

  let shouldRecoverHistoryChannel = false;
  try {
    const commandResult = await config.run();
    pushLog(`${config.label} - 命令返回`, 'success', commandResult ?? '命令已发出，等待设备通知回执');
  } catch (error) {
    const errorText = stringify(error);
    pushLog(`${config.label} - 命令失败`, 'error', {
      error: errorText,
      device: {
        deviceId: commandTarget.deviceId || '-',
        mac: commandTarget.mac || commandTarget.uniMacId || '-',
        serviceId: commandTarget.serviceId || '-',
        dataCharId: commandTarget.dataCharId || '-',
        connected: connectedText.value
      }
    });
    shouldRecoverHistoryChannel =
      config.key === 'historyAll' &&
      /Ring data listener was cleared|physical-disconnect|disconnected|not connected|未连接/i.test(errorText);
  }

  if (shouldRecoverHistoryChannel) {
    releaseCommandSession();
    try {
      const ready = await ble.recoverCommunicationForDevice?.(commandTarget);
      pushLog(`${config.label} - 连接恢复`, ready ? 'success' : 'error', {
        ready: Boolean(ready),
        deviceId: commandTarget.deviceId || '-',
        mac: commandTarget.mac || commandTarget.uniMacId || '-'
      });
      if (ready) {
        const releaseRetrySession = tryClaimLegacyBleCommandSession(config.timeoutMs, {
          reason: `ble-command-debug:${config.key}:disconnect-retry`,
          caller: 'bleCommandDebug.runCommand.retry',
          deviceId: commandTarget.deviceId || commandTarget.mac || commandTarget.uniMacId || ''
        });
        if (releaseRetrySession) {
          try {
            const retryResult = await config.run();
            pushLog(`${config.label} - 断连重试返回`, 'success', retryResult ?? '命令已重新发出');
          } catch (retryError) {
            pushLog(`${config.label} - 断连重试失败`, 'error', stringify(retryError));
          } finally {
            releaseRetrySession();
          }
        }
      }
    } catch (recoveryError) {
      pushLog(`${config.label} - 连接恢复失败`, 'error', stringify(recoveryError));
    }
    runningKey.value = '';
    return;
  }

  if (config.skipWait) {
    releaseCommandSession();
    runningKey.value = '';
    return;
  }
  if (!config.matcher) {
    pushLog(`${config.label} - 配置错误`, 'error', '当前命令缺少回执匹配规则');
    releaseCommandSession();
    runningKey.value = '';
    return;
  }
  const reply = await waitForReply(config.matcher, config.timeoutMs);
  if (reply) {
    pushLog(`${config.label} - 收到回执`, 'success', reply);
  } else {
    pushLog(`${config.label} - 等待超时`, 'error', config.timeoutText);
  }
  releaseCommandSession();
  runningKey.value = '';
};

const clearLogs = () => {
  logs.value = [];
};

const jumpOtaUpgrade = () => {
  uni.navigateTo({ url: '/pagesA/mines/otaUpgrade' });
};

const executeFactoryReset = async () => {
  if (runningKey.value) return;
  runningKey.value = 'factoryReset';
  pushLog('恢复出厂设置 - 开始', 'info', {
    deviceId: currentDevice.value.deviceId || '-',
    mac: currentDevice.value.mac || currentDevice.value.uniMacId || '-'
  });
  try {
    const ready = await ble.ensureCommunicationReady?.();
    if (!ready) throw new Error('设备未连接，请重新连接后再试');
    if (typeof ble.sendFactoryResetWithTimeCommand !== 'function') {
      throw new Error('当前设备不支持恢复出厂设置');
    }
    await ble.sendFactoryResetWithTimeCommand();
    pushLog('恢复出厂设置 - 命令已发送', 'success', '设备将清除数据并重新启动');
    uni.showToast({ title: '恢复命令已发送', icon: 'success' });
  } catch (error) {
    pushLog('恢复出厂设置 - 失败', 'error', error);
    uni.showToast({ title: '恢复出厂失败', icon: 'none' });
  } finally {
    runningKey.value = '';
  }
};

const handleFactoryReset = () => {
  if (runningKey.value) return;
  uni.showModal({
    title: '恢复出厂设置',
    content: '此操作会清除戒指内的数据，确定继续吗？',
    confirmText: '确定恢复',
    confirmColor: '#ef4444',
    success: (result) => {
      if (result.confirm) void executeFactoryReset();
    }
  });
};

onBeforeUnmount(() => {
  stopBatteryTest();
  stopWearObservationWait?.();
  stopMtuHistoryObservationWait?.();
  stopMtuHistoryCapture?.();
  pendingTimers.forEach((timer) => clearTimeout(timer));
  pendingTimers.clear();
});
</script>

<template>
  <view class="debug-page">
    <view class="debug-card">
      <view class="section-head">
        <view class="section-title">当前设备</view>
        <view class="section-status" :class="{ connected: connectedText === '已连接' }">{{ connectedText }}</view>
      </view>
      <view v-for="row in deviceRows" :key="row[0]" class="kv-row">
        <text class="kv-label">{{ row[0] }}</text>
        <text class="kv-value" selectable>{{ row[1] }}</text>
      </view>
    </view>

    <view class="debug-card">
      <view class="section-head">
        <view class="section-title">命令按钮集合</view>
        <button class="clear-btn" size="mini" @click="clearLogs">清空日志</button>
      </view>
      <view class="button-grid">
        <button
          v-for="item in commandRows"
          :key="item.key"
          class="cmd-btn"
          :class="{ running: item.running }"
          :disabled="item.disabled || item.running"
          @click="runCommand(item)"
        >
          {{ item.running ? '等待回执...' : item.label }}
        </button>
      </view>
      <view class="hint">用于临时验证 D7 等设备命令回执。血氧会等待 30 秒，超时会明确记录“未收到回执”。</view>

      <view class="period-test">
        <view class="period-test-head">
          <view>
            <view class="period-test-title">华为 MTU / 历史链路测试</view>
            <view class="period-test-desc">校验实际 MTU、历史 Notify 长度/分片、物理断开与连接恢复</view>
          </view>
        </view>
        <view class="battery-test-guide">
          <text>测试只发送一次 0x36 增量历史命令并观察10秒；不主动断开、不删除历史、不上传健康数据。请在设备已连接时执行。</text>
        </view>
        <view v-if="lastMtuHistoryReport" class="battery-test-guide">
          <text>{{ lastMtuHistoryReport.conclusion }}</text>
          <text>实际 MTU：{{ lastMtuHistoryReport.mtu?.actual ?? '未读取到' }}；历史包：{{ lastMtuHistoryReport.history?.historyPacketCount ?? 0 }}；物理断开：{{ lastMtuHistoryReport.connection?.disconnected ? '是' : '否' }}</text>
        </view>
        <view class="battery-test-grid">
          <button
            class="period-test-btn"
            :class="{ running: runningKey === 'mtuHistory' }"
            :disabled="Boolean(runningKey)"
            @click="runMtuHistoryCompatibilityTest"
          >
            {{ runningKey === 'mtuHistory' ? '测试中（约10秒）...' : '开始链路测试' }}
          </button>
          <button class="period-test-btn secondary" :disabled="!lastMtuHistoryReport || Boolean(runningKey)" @click="copyMtuHistoryReport">
            复制测试报告
          </button>
        </view>
      </view>

      <view class="period-test">
        <view class="period-test-head">
          <view>
            <view class="period-test-title">佩戴门禁与心率测量链路</view>
            <view class="period-test-desc">分开校验正确佩戴链路，以及摘下戒指后的门禁与探测回包</view>
          </view>
        </view>
        <view class="battery-test-guide">
          <text>“正确佩戴测试”需佩戴并保持静止；“摘下戒指校验”需将戒指放在桌面。两项均不读取历史、不上传健康数据。</text>
        </view>
        <view class="battery-test-grid">
          <button
            class="period-test-btn"
            :class="{ running: runningKey === 'wearMeasure' }"
            :disabled="Boolean(runningKey)"
            @click="runWearMeasureChainTest"
          >
            {{ runningKey === 'wearMeasure' ? '测试中...' : '正确佩戴测试' }}
          </button>
          <button
            class="period-test-btn"
            :class="{ running: runningKey === 'wearNotWorn' }"
            :disabled="Boolean(runningKey)"
            @click="runNotWornGateValidation"
          >
            {{ runningKey === 'wearNotWorn' ? '校验中...' : '摘下戒指校验' }}
          </button>
          <button class="period-test-btn secondary" :disabled="!lastWearMeasureReport || Boolean(runningKey)" @click="copyWearMeasureReport">
            复制测试日志
          </button>
        </view>
      </view>

      <view class="period-test">
        <view class="period-test-head">
          <view>
            <view class="period-test-title">充电与电量隔离测试</view>
            <view class="period-test-desc">不读取历史、不上传数据。测试开始后，将戒指放入充电仓，再拿出充电仓。</view>
          </view>
        </view>
        <view class="battery-test-guide">
          <text>先跑“纯监听”：收到 101/102 表示固件主动上报；再跑“定时查询”：可确认电量命令是否返回充电状态。</text>
        </view>
        <view class="battery-test-grid">
          <button
            class="period-test-btn"
            :class="{ running: batteryTestMode === 'passive' }"
            :disabled="Boolean(runningKey)"
            @click="runBatteryIsolationTest('passive')"
          >
            {{ batteryTestMode === 'passive' ? '监听中...' : '纯监听 30 秒' }}
          </button>
          <button
            class="period-test-btn"
            :class="{ running: batteryTestMode === 'polling' }"
            :disabled="Boolean(runningKey)"
            @click="runBatteryIsolationTest('polling')"
          >
            {{ batteryTestMode === 'polling' ? '查询中...' : '定时查询 30 秒' }}
          </button>
          <button v-if="batteryTestMode" class="period-test-btn stop" @click="stopBatteryTest">停止测试</button>
        </view>
      </view>

      <view class="period-test">
        <view class="period-test-head">
          <view>
            <view class="period-test-title">采集周期写入回读</view>
            <view class="period-test-desc">仅测试设备有效的 20 / 30 分钟，写入后读取设备实际值</view>
          </view>
        </view>
        <view class="period-button-grid">
          <button
            v-for="minutes in collectPeriodOptions"
            :key="minutes"
            class="period-test-btn"
            :class="{ running: runningKey === 'collectPeriod' && testingCollectPeriodMinutes === minutes }"
            :disabled="Boolean(runningKey)"
            @click="runCollectPeriodTest(minutes)"
          >
            {{ runningKey === 'collectPeriod' && testingCollectPeriodMinutes === minutes ? '测试中...' : `${minutes} 分钟` }}
          </button>
        </view>
      </view>

      <view class="period-test">
        <view class="period-test-head">
          <view>
            <view class="period-test-title">设备维护</view>
            <view class="period-test-desc">仅供测试人员执行 OTA 或恢复出厂设置</view>
          </view>
        </view>
        <view class="maintenance-button-grid">
          <button class="period-test-btn" :disabled="Boolean(runningKey)" @click="jumpOtaUpgrade">OTA 升级</button>
          <button
            class="period-test-btn danger"
            :class="{ running: runningKey === 'factoryReset' }"
            :disabled="Boolean(runningKey)"
            @click="handleFactoryReset"
          >
            {{ runningKey === 'factoryReset' ? '恢复中...' : '恢复出厂设置' }}
          </button>
        </view>
      </view>
    </view>

    <view class="debug-card">
      <view class="section-title">命令日志</view>
      <view v-if="!logs.length" class="empty">暂无命令日志</view>
      <view v-for="log in logs" :key="log.id" class="log-item" :class="`log-${log.status}`">
        <view class="log-title">
          <text>{{ log.title }}</text>
          <text class="log-time">{{ log.time }}</text>
        </view>
        <text class="log-detail" selectable>{{ log.detail }}</text>
      </view>
    </view>

    <view class="debug-card">
      <view class="section-title">最近回执 / 解析数据</view>
      <view v-if="!latestRecordViews.length" class="empty">暂无回执数据</view>
      <view v-for="record in latestRecordViews" :key="record.key" class="record-item">
        <view class="record-title">
          <text>{{ record.title }}</text>
          <text class="record-time">{{ record.time }}</text>
        </view>
        <text class="record-json" selectable>{{ record.json }}</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.debug-page {
  min-height: 100vh;
  padding: 28rpx;
  box-sizing: border-box;
  background: #f1f3f6;
}

.debug-card {
  margin-bottom: 24rpx;
  padding: 28rpx;
  border-radius: 28rpx;
  background: #fff;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
}

.section-title {
  color: #111827;
  font-size: 32rpx;
  font-weight: 700;
}

.section-status {
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  color: #ef4444;
  background: #fee2e2;
  font-size: 22rpx;
}

.section-status.connected {
  color: #2563eb;
  background: #dbeafe;
}

.kv-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24rpx;
  padding: 14rpx 0;
  border-bottom: 1rpx solid #f1f3f6;
}

.kv-row:last-child {
  border-bottom: 0;
}

.kv-label {
  flex: 0 0 170rpx;
  color: #6b7280;
  font-size: 24rpx;
}

.kv-value {
  flex: 1;
  color: #111827;
  font-size: 24rpx;
  line-height: 1.35;
  text-align: right;
  word-break: break-all;
}

.button-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18rpx;
}

.cmd-btn,
.clear-btn {
  margin: 0;
  border: 0;
  border-radius: 20rpx;
  color: #fff;
  background: #3478f6;
  font-size: 26rpx;
  line-height: 76rpx;
}

.cmd-btn.running {
  background: #94a3b8;
}

.cmd-btn[disabled] {
  color: #fff;
  background: #cbd5e1;
}

.clear-btn {
  padding: 0 22rpx;
  background: #eef2ff;
  color: #3478f6;
  font-size: 22rpx;
  line-height: 52rpx;
}

.hint {
  margin-top: 18rpx;
  color: #6b7280;
  font-size: 22rpx;
  line-height: 1.5;
}

.period-test {
  margin-top: 28rpx;
  padding-top: 26rpx;
  border-top: 1rpx solid #e5e7eb;
}

.period-test-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
}

.period-test-title {
  color: #111827;
  font-size: 28rpx;
  font-weight: 700;
}

.period-test-desc {
  margin-top: 8rpx;
  color: #6b7280;
  font-size: 21rpx;
  line-height: 1.4;
}

.period-button-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14rpx;
  margin-top: 22rpx;
}

.battery-test-guide {
  margin-top: 18rpx;
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  color: #475569;
  background: #f8fafc;
  font-size: 22rpx;
  line-height: 1.55;
}

.battery-test-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
  margin-top: 22rpx;
}

.maintenance-button-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
  margin-top: 22rpx;
}

.period-test-btn {
  width: 100%;
  margin: 0;
  border: 0;
  border-radius: 20rpx;
  color: #fff;
  background: #3478f6;
  font-size: 26rpx;
  line-height: 78rpx;
}

.period-test-btn.running,
.period-test-btn[disabled] {
  color: #fff;
  background: #94a3b8;
}

.period-test-btn.danger {
  background: #ef4444;
}

.period-test-btn.stop {
  grid-column: 1 / -1;
  background: #f59e0b;
}

.empty {
  padding: 32rpx 0;
  color: #9aa1ae;
  font-size: 24rpx;
  text-align: center;
}

.log-item,
.record-item {
  margin-top: 18rpx;
  padding: 18rpx;
  border-radius: 18rpx;
  background: #f8fafc;
}

.log-success {
  background: #ecfdf5;
}

.log-error {
  background: #fef2f2;
}

.log-info {
  background: #eff6ff;
}

.log-title,
.record-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  color: #111827;
  font-size: 24rpx;
  font-weight: 700;
}

.log-time,
.record-time {
  color: #9aa1ae;
  font-size: 20rpx;
  font-weight: 400;
}

.log-detail,
.record-json {
  display: block;
  margin-top: 12rpx;
  color: #374151;
  font-family: Consolas, Monaco, monospace;
  font-size: 20rpx;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
