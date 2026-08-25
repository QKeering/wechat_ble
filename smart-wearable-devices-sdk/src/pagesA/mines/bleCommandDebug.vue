<script setup lang="ts">
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
  | 'collectPeriod'
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
const collectPeriodOptions = [60, 90, 120];
const testingCollectPeriodMinutes = ref(0);
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

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
  ['设备名称', currentDevice.value.name || currentDevice.value.deviceName || '-'],
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
    pushLog(`${config.label} - 閰嶇疆閿欒`, 'error', 'matcher is required when skipWait is false');
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
            <view class="period-test-title">采集周期写入回读</view>
            <view class="period-test-desc">分别写入 60 / 90 / 120 分钟，再读取设备中的实际值</view>
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
