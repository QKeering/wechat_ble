<template>
  <view class="page">
    <view class="topbar">
      <button class="icon-button" @tap="goBack">返回</button>
      <text class="title">戒指蓝牙调试</text>
    </view>

    <view class="status-grid">
      <view class="status-item">
        <text class="status-label">蓝牙</text>
        <text class="status-value">{{ isBluetoothReady ? '已就绪' : '未就绪' }}</text>
      </view>
      <view class="status-item">
        <text class="status-label">连接</text>
        <text class="status-value">{{ isConnected ? '已连接' : '未连接' }}</text>
      </view>
      <view class="status-item">
        <text class="status-label">重连</text>
        <text class="status-value">{{ reconnectStatus }}</text>
      </view>
      <view class="status-item">
        <text class="status-label">上传</text>
        <text class="status-value">{{ uploadingStatus }}</text>
      </view>
    </view>

    <view class="toolbar">
      <button class="action-button primary" :disabled="isScanning" @tap="handleStartScan">
        {{ isScanning ? '扫描中' : '扫描设备' }}
      </button>
      <button class="action-button" :disabled="isScanning" @tap="handleStartRawScan">全量扫描</button>
      <button class="action-button" @tap="handleStopScan">停止</button>
      <button class="action-button" @tap="handleReconnect">重连</button>
      <button class="action-button danger" @tap="handleDisconnect">断开</button>
    </view>

    <view class="toolbar compact">
      <button class="action-button" :disabled="!deviceInfo.deviceId" @tap="handleCheckConnection">检测连接</button>
      <button class="action-button danger" :disabled="!deviceInfo.deviceId" @tap="handleUnbind">解绑</button>
      <button class="action-button" @tap="handleCleanup">清理监听</button>
    </view>

    <view class="panel">
      <view class="panel-head">
        <text class="panel-title">兼容状态</text>
        <text class="panel-meta">蓝牙 SDK</text>
      </view>
      <text class="kv">normalMac: {{ ringStore.normalMac || '-' }}</text>
      <text class="kv">iosMacId: {{ ringStore.iosMacId || '-' }}</text>
      <text class="kv">deviceTime: {{ ringStore.deviceTime || '-' }}</text>
      <text class="kv">localData: {{ ringStore.localData.length }}</text>
      <text class="kv">receivedData: {{ ringStore.receivedData.length }}</text>
      <view class="toolbar compact">
        <button class="action-button" @tap="handleCheckOtaApi">OTA API</button>
        <button class="action-button" @tap="handleCheckOtaHex">OTA HEX</button>
      </view>
    </view>

    <view class="panel">
      <view class="panel-head">
        <text class="panel-title">设备列表</text>
        <text class="panel-meta">{{ devices.length }} 台</text>
      </view>

      <view v-if="devices.length === 0" class="empty">
        <text>暂无设备</text>
      </view>

      <view v-for="device in devices" :key="device.deviceId" class="device-row">
        <view class="device-main">
          <text class="device-name">{{ device.displayName || device.name || device.localName || '未知设备' }}</text>
          <text class="device-id">deviceId={{ device.deviceId || '-' }}</text>
          <text class="device-id">MAC={{ device.uniMacId || device.mac || '-' }}</text>
          <text class="device-id">protocol={{ device.protocol || '-' }} RSSI={{ device.RSSI ?? device.rssi ?? '-' }}</text>
          <text class="device-id">adv={{ getDeviceAdvertisHex(device) || '-' }}</text>
          <text class="device-id">服务={{ getDeviceServicesText(device) || '-' }}</text>
        </view>
        <view class="device-actions">
          <button class="small-button" @tap="handleConnect(device)">连接</button>
          <button class="small-button" @tap="handleConnect(device, 'rw')">RW</button>
        </view>
      </view>
    </view>

    <view class="panel">
      <view class="panel-head">
        <text class="panel-title">当前设备</text>
        <text class="panel-meta">{{ deviceInfo.protocol || '-' }}</text>
      </view>
      <text class="kv">ID: {{ deviceInfo.deviceId || '-' }}</text>
      <text class="kv">服务: {{ deviceInfo.serviceId || '-' }}</text>
      <text class="kv">写特征: {{ deviceInfo.cmdCharId || '-' }}</text>
      <text class="kv">写属性: {{ deviceInfo.cmdCharProperties || '-' }}</text>
      <text class="kv">通知服务: {{ deviceInfo.dataServiceId || deviceInfo.serviceId || '-' }}</text>
      <text class="kv">通知特征: {{ deviceInfo.dataCharId || '-' }}</text>
      <text class="kv">通知状态: {{ deviceInfo.notifyEnabled === false ? '未启用' : deviceInfo.dataCharId ? '已启用' : '-' }}</text>
      <text v-if="deviceInfo.notifyError" class="kv">通知错误: {{ deviceInfo.notifyError }}</text>
      <text class="kv">绑定: {{ ringStore.boundDevice?.mac || '-' }}</text>
    </view>

    <view class="panel">
      <view class="panel-head">
        <text class="panel-title">基础指令</text>
        <text class="panel-meta">{{ receivedData.length }} 条数据</text>
      </view>

      <view class="command-grid">
        <button class="command-button" :disabled="!isConnected" @tap="sendBatteryCommand">电量</button>
        <button class="command-button" :disabled="!isConnected" @tap="sendActiveMeasureCommand">心率</button>
        <button class="command-button" :disabled="!isConnected" @tap="sendOxyGenCommand">血氧</button>
        <button class="command-button" :disabled="!isConnected" @tap="sendBodyTemperatureCommand">体温</button>
        <button class="command-button" :disabled="!isConnected" @tap="sendFirmwareVersion">硬件版本</button>
        <button class="command-button" :disabled="!isConnected" @tap="sendSoftwareVersion">软件版本</button>
        <button class="command-button" :disabled="!isConnected" @tap="readDeviceTime">读时间</button>
        <button class="command-button" :disabled="!isConnected" @tap="handleUpdateDeviceTime">写时间</button>
        <button class="command-button" :disabled="!isConnected" @tap="readCollectPeriodCommand">读周期</button>
      </view>

      <view class="panel-subhead">
        <text class="panel-title small">RW 读取测试</text>
        <text class="panel-meta">安全指令</text>
      </view>

      <view class="toolbar compact">
        <button class="action-button primary" :disabled="!isConnected || isRwSmokeTesting" @tap="handleRwSmokeTest">
          {{ isRwSmokeTesting ? 'RW 测试中' : 'RW 冒烟测试' }}
        </button>
        <button class="action-button primary" :disabled="!isConnected || isRwLiveTesting" @tap="handleRwLiveProbe">
          {{ isRwLiveTesting ? 'RW 探测中' : 'RW 实时探测' }}
        </button>
        <button class="action-button" @tap="rwSmokeLogs = []">清空 RW 日志</button>
      </view>

      <view class="command-grid">
        <button class="command-button" :disabled="!isConnected" @tap="handleRwReadMonitoring('hr')">RW 心率配置</button>
        <button class="command-button" :disabled="!isConnected" @tap="handleRwReadMonitoring('spo2')">RW 血氧配置</button>
        <button class="command-button" :disabled="!isConnected" @tap="handleRwReadMonitoring('hrv')">RW HRV配置</button>
        <button class="command-button" :disabled="!isConnected" @tap="handleRwReadMonitoring('stress')">RW 压力配置</button>
        <button class="command-button" :disabled="!isConnected" @tap="handleRwReadMonitoring('bloodSugar')">RW 血糖配置</button>
        <button class="command-button" :disabled="!isConnected" @tap="handleRwReadHealthData('heartRate')">RW 心率数据</button>
        <button class="command-button" :disabled="!isConnected" @tap="handleRwReadHealthData('bloodOxygen')">RW 血氧数据</button>
        <button class="command-button" :disabled="!isConnected" @tap="handleRwReadHealthData('bloodSugar')">RW 血糖数据</button>
      </view>

      <view v-if="rwSmokeLogs.length" class="log-box">
        <text v-for="item in rwSmokeLogs" :key="item">{{ item }}</text>
      </view>

      <view class="toolbar compact">
        <button class="action-button" :disabled="!isConnected" @tap="handleSyncHistory">同步历史</button>
        <button class="action-button" :disabled="!isConnected" @tap="handleReadAllHistory">全量历史</button>
        <button class="action-button" :disabled="!isConnected" @tap="handleRefreshBusinessMetrics">刷新业务数据</button>
        <button class="action-button" @tap="clearData">清空数据</button>
      </view>
    </view>

    <view class="panel">
      <view class="panel-head">
        <text class="panel-title">最新数据</text>
        <text class="panel-meta">{{ normalizedData.length }} 条标准化</text>
      </view>
      <view v-if="latestData" class="json-box">
        <text>{{ latestDataText }}</text>
      </view>
      <view v-else class="empty">
        <text>暂无数据</text>
      </view>
    </view>

    <view class="panel">
      <view class="panel-head">
        <text class="panel-title">业务数据预览</text>
        <text class="panel-meta">统一字段</text>
      </view>
      <view class="metric-grid">
        <view class="metric-item">
          <text class="metric-label">电量</text>
          <text class="metric-value">{{ businessMetrics.battery ?? '-' }}</text>
        </view>
        <view class="metric-item">
          <text class="metric-label">电量状态</text>
          <text class="metric-value">{{ businessMetrics.batteryStatus || '-' }}</text>
        </view>
        <view class="metric-item">
          <text class="metric-label">固件版本</text>
          <text class="metric-value">{{ businessMetrics.firmwareVersion || '-' }}</text>
        </view>
        <view class="metric-item">
          <text class="metric-label">UI版本</text>
          <text class="metric-value">{{ businessMetrics.uiVersion || '-' }}</text>
        </view>
        <view class="metric-item">
          <text class="metric-label">心率</text>
          <text class="metric-value">{{ businessMetrics.heartRate ?? '-' }}</text>
        </view>
        <view class="metric-item">
          <text class="metric-label">血氧</text>
          <text class="metric-value">{{ businessMetrics.bloodOxygen ?? '-' }}</text>
        </view>
        <view class="metric-item">
          <text class="metric-label">体温</text>
          <text class="metric-value">{{ (businessMetrics.temperature ?? businessMetrics.temperatureStatus) || '-' }}</text>
        </view>
        <view class="metric-item">
          <text class="metric-label">历史</text>
          <text class="metric-value">{{ businessMetrics.historyStatus || '-' }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRingBleStoreSdk, useRingBusinessData } from '@/features/ring';
import {
  buildRwControlHealthDataCommand,
  buildRwReadBatteryCommand,
  buildRwReadFirmwareVersionCommand,
  buildRwReadHealthMonitoringCommand,
  bytesToHex,
  RwKey,
  resolveRingProtocol,
  type RingDeviceInfo,
  type RingParsedData,
  type RingProtocolKind
} from '@/sdk/ring-ble';
import RingOTAManager from '@/composables/ring-ota-manager';
import { getOtaInfo } from '@/common/api/device';

const {
  devices,
  deviceInfo,
  receivedData,
  normalizedData,
  isScanning,
  isBluetoothReady,
  isConnected,
  reconnectStatus,
  uploadingStatus,
  startScan,
  stopScan,
  connectDevice,
  disconnect,
  reconnect,
  syncHistory,
  refreshBusinessMetrics,
  unbind,
  cleanup,
  clearData,
  isDeviceConnected,
  checkByRSSI,
  sendBatteryCommand,
  sendActiveMeasureCommand,
  sendOxyGenCommand,
  sendBodyTemperatureCommand,
  sendFirmwareVersion,
  sendSoftwareVersion,
  readDeviceTime,
  updateDeviceTime,
  readCollectPeriodCommand,
  ensureCommunicationReady,
  sendBytes,
  waitForParsedData,
  ringStore
} = useRingBleStoreSdk();
const { metrics: businessMetrics } = useRingBusinessData();

const latestData = computed(() => receivedData.value[receivedData.value.length - 1] || null);
const latestDataText = computed(() => (latestData.value ? JSON.stringify(latestData.value, null, 2) : ''));
const sampleHex = ':020000041100EA\n:0400000001020304F2\n:00000001FF';
const rwSmokeLogs = ref<string[]>([]);
const isRwSmokeTesting = ref(false);
const isRwLiveTesting = ref(false);

const goBack = () => {
  uni.navigateBack();
};

const toastError = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : `${(error as any)?.errMsg || fallback}`;
  uni.showToast({ title: message, icon: 'none' });
};

const ensureDebugCommunicationReady = async () => {
  const ready = await ensureCommunicationReady();
  if (!ready) {
    throw new Error('Ring BLE communication is not ready.');
  }
};

const formatDebugError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return `${error}`;
  }
};

const handleStartScan = async () => {
  try {
    await startScan({ includeUnknown: true, allowDuplicatesKey: true, timeoutMs: 30000, preserveDevices: true });
  } catch (error) {
    toastError(error, '扫描失败');
  }
};

const handleStartRawScan = async () => {
  try {
    await startScan({ includeUnknown: true, allowDuplicatesKey: true, timeoutMs: 30000, preserveDevices: true });
  } catch (error) {
    toastError(error, 'Scan all failed');
  }
};

const handleStopScan = async () => {
  await stopScan();
};

const getDeviceAdvertisHex = (device: RingDeviceInfo) => {
  const value = device.advertisData;
  if (!value) return '';
  if (typeof value === 'string') return value.toUpperCase();
  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  return '';
};

const getDeviceServicesText = (device: RingDeviceInfo) => {
  const services = [
    ...(Array.isArray(device.advertisServiceUUIDs) ? device.advertisServiceUUIDs : []),
    ...(Array.isArray(device.advertisServiceUUIDsList) ? device.advertisServiceUUIDsList : [])
  ];
  return services.join(',');
};

const isColonSeparatedBleMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());

const getDebugStableIdentity = (device: RingDeviceInfo, protocol: RingProtocolKind) => {
  if (device.mac) return device.mac;
  if (device.advertis?.macInfo) return device.advertis.macInfo;
  if (protocol === 'rw') {
    if (isColonSeparatedBleMac(device.uniMacId)) return device.uniMacId;
    if (isColonSeparatedBleMac(device.deviceId)) return device.deviceId;
    return '';
  }
  return device.uniMacId || '';
};

const handleConnect = async (device: RingDeviceInfo, forceProtocol?: RingProtocolKind) => {
  const protocol = forceProtocol || device.protocol || resolveRingProtocol(device);
  const stableIdentity = getDebugStableIdentity(device, protocol);
  const deviceId = protocol === 'rw' ? device.deviceId : device.deviceId || device.uniMacId;
  const deviceName = device.displayName || device.name || device.localName || 'Unknown BLE';

  if (!deviceId) {
    uni.showToast({ title: protocol === 'rw' ? '请重新搜索设备' : 'OK', icon: 'none' });
    return;
  }

  uni.showLoading({ title: '连接中', mask: true });
  try {
    deviceInfo.value = {};
    clearData();
    appendRwSmokeLog(`连接开始 name=${deviceName} protocol=${protocol || '-'} deviceId=${deviceId} stable=${stableIdentity || '-'}`);
    const connected = await connectDevice({
      deviceId,
      deviceName,
      uniMacId: protocol === 'rw' ? stableIdentity : stableIdentity || device.uniMacId,
      fromScan: protocol === 'rw',
      bindAfterConnected: true,
      protocol,
      sourceDevice: {
        ...device,
        protocol,
        uniMacId: protocol === 'rw' ? stableIdentity : stableIdentity || device.uniMacId,
        mac: device.mac || device.advertis?.macInfo
      }
    });
    appendRwSmokeLog(`连接成功 service=${connected.serviceId || '-'} write=${connected.cmdCharId || '-'} notify=${connected.dataCharId || '-'}`);
    uni.showToast({ title: '连接成功', icon: 'success' });
  } catch (error) {
    deviceInfo.value = {};
    appendRwSmokeLog(`连接失败 ${formatDebugError(error)}`);
    toastError(error, '连接失败');
  } finally {
    uni.hideLoading();
  }
};

const handleDisconnect = async () => {
  await disconnect();
  uni.showToast({ title: 'OK', icon: 'none' });
};

const handleUnbind = async () => {
  await unbind();
  uni.showToast({ title: 'OK', icon: 'none' });
};

const handleCleanup = async () => {
  await cleanup();
  uni.showToast({ title: 'OK', icon: 'none' });
};

const handleCheckConnection = async () => {
  const deviceId = deviceInfo.value.deviceId;
  const serviceId = deviceInfo.value.serviceId;

  if (!deviceId) {
    uni.showToast({ title: 'OK', icon: 'none' });
    return;
  }

  const connected = serviceId ? await isDeviceConnected(deviceId, serviceId) : await checkByRSSI(deviceId);
  uni.showToast({ title: connected ? '连接正常' : '连接不可用', icon: 'none' });
};

const handleReconnect = async () => {
  try {
    const success = await reconnect();
    uni.showToast({ title: success ? 'Reconnect OK' : 'Reconnect failed', icon: 'none' });
  } catch (error) {
    toastError(error, '重连失败');
  }
};

const handleSyncHistory = async () => {
  try {
    const result = await syncHistory({ deleteAfterUpload: false });
    uni.showToast({
      title: result.status === 'rw_history_pending' ? 'RW历史待同步' : `历史${result.records.length}条`,
      icon: 'none'
    });
  } catch (error) {
    toastError(error, '同步失败');
  }
};

const handleReadAllHistory = async () => {
  try {
    const result = await syncHistory({ readAll: true, deleteAfterUpload: false });
    uni.showToast({
      title: result.status === 'rw_history_pending' ? 'RW历史待同步' : `全量历史${result.records.length}条`,
      icon: 'none'
    });
  } catch (error) {
    toastError(error, '读取失败');
  }
};

const handleRefreshBusinessMetrics = async () => {
  try {
    const result = await refreshBusinessMetrics();
    uni.showToast({
      title: result.status === 'success' ? '业务数据已刷新' : `部分刷新 ${result.ok.length}`,
      icon: 'none'
    });
    if (result.failed.length > 0) {
      appendRwSmokeLog(`业务刷新部分失败 ${result.failed.map((item) => `${item.step}:${item.message}`).join(' | ')}`);
    }
  } catch (error) {
    toastError(error, '刷新失败');
  }
};

const handleUpdateDeviceTime = async () => {
  try {
    await updateDeviceTime();
    uni.showToast({ title: 'OK', icon: 'none' });
  } catch (error) {
    toastError(error, '写入失败');
  }
};

const rwMonitoringKeys = {
  hr: RwKey.HrMonitoring,
  spo2: RwKey.Spo2Monitoring,
  hrv: RwKey.HrvMonitoring,
  stress: RwKey.StressMonitoring,
  bloodSugar: RwKey.BloodSugarMonitoring
};

const rwHealthDataKeys = {
  heartRate: RwKey.HeartRate,
  bloodOxygen: RwKey.BloodOxygen,
  bloodSugar: RwKey.BloodSugar
};

const handleRwReadMonitoring = async (name: keyof typeof rwMonitoringKeys) => {
  try {
    await ensureDebugCommunicationReady();
    await sendBytes(buildRwReadHealthMonitoringCommand(rwMonitoringKeys[name]));
    uni.showToast({ title: 'OK', icon: 'none' });
  } catch (error) {
    toastError(error, 'RW command failed');
  }
};

const handleRwReadHealthData = async (name: keyof typeof rwHealthDataKeys) => {
  try {
    await ensureDebugCommunicationReady();
    await sendBytes(buildRwControlHealthDataCommand(rwHealthDataKeys[name], true));
    uni.showToast({ title: 'OK', icon: 'none' });
  } catch (error) {
    toastError(error, 'RW command failed');
  }
};

const appendRwSmokeLog = (message: string) => {
  const time = new Date().toLocaleTimeString();
  rwSmokeLogs.value = [`${time} ${message}`, ...rwSmokeLogs.value].slice(0, 60);
};

const summarizeParsedData = (parsed: RingParsedData) => {
  const rawHex = Array.isArray(parsed.raw)
    ? parsed.raw.map((byte) => byte.toString(16).padStart(2, '0')).join('')
    : '';
  const fields = [
    parsed.value != null ? `value=${parsed.value}` : '',
    parsed.firmwareVersion ? `fw=${parsed.firmwareVersion}` : '',
    parsed.uiVersion ? `ui=${parsed.uiVersion}` : '',
    parsed.name ? `name=${parsed.name}` : '',
    parsed.interval != null ? `interval=${parsed.interval}` : '',
    parsed.enabled != null ? `enabled=${parsed.enabled}` : '',
    Array.isArray(parsed.files) ? `files=${parsed.files.length}` : ''
  ].filter(Boolean);

  return `${fields.join(' ')}${rawHex ? ` raw=${rawHex}` : ''}`.trim();
};

const runRwSmokeStep = async (
  label: string,
  command: Uint8Array,
  match: (parsed: RingParsedData) => boolean
) => {
  await ensureDebugCommunicationReady();
  appendRwSmokeLog(`${label}：发送 ${bytesToHex(command)}`);
  const pending = waitForParsedData((parsed) => match(parsed), 15000);
  await sendBytes(command);
  const parsed = await pending;
  appendRwSmokeLog(`${label}：成功 ${parsed.type} ${summarizeParsedData(parsed)}`);
  return parsed;
};

const runRwLiveProbeStep = async (label: string, key: RwKey, name: string) => {
  await ensureDebugCommunicationReady();
  const command = buildRwControlHealthDataCommand(key, true);
  appendRwSmokeLog(`${label}实时：发送 ${bytesToHex(command)}`);
  const pending = waitForParsedData(
    (parsed) => parsed.type === 'rw_health_data' && parsed.name === name && parsed.value != null,
    45000
  );
  await sendBytes(command);
  const parsed = await pending;
  appendRwSmokeLog(`${label}实时：成功 ${summarizeParsedData(parsed)}`);
  return parsed;
};

const handleRwLiveProbe = async () => {
  if (isRwLiveTesting.value) return;
  isRwLiveTesting.value = true;
  rwSmokeLogs.value = [];

  try {
    appendRwSmokeLog('RW 实时探测：请保持戒指佩戴，等待 30-45 秒');
    await runRwLiveProbeStep('心率', RwKey.HeartRate, 'heart_rate');
    await runRwLiveProbeStep('血氧', RwKey.BloodOxygen, 'blood_oxygen');
    appendRwSmokeLog('RW 实时探测：完成');
    uni.showToast({ title: '实时数据 OK', icon: 'none' });
  } catch (error) {
    const message = error instanceof Error ? error.message : `${(error as any)?.errMsg || error}`;
    appendRwSmokeLog(`RW 实时探测失败：${message}`);
    appendRwSmokeLog('如果最新数据只有 rw_health_data_control_ack 或 rw_health_data_ack，说明设备未上报实时健康数值。');
    toastError(error, 'RW 实时探测失败');
  } finally {
    isRwLiveTesting.value = false;
  }
};

const handleRwSmokeTest = async () => {
  if (isRwSmokeTesting.value) return;
  isRwSmokeTesting.value = true;
  rwSmokeLogs.value = [];

  try {
    await runRwSmokeStep('电量', buildRwReadBatteryCommand(), (parsed) => parsed.type === 'battery');
    await runRwSmokeStep('固件版本', buildRwReadFirmwareVersionCommand(), (parsed) => parsed.type === 'firmware_version');
    await runRwSmokeStep(
      '心率配置',
      buildRwReadHealthMonitoringCommand(RwKey.HrMonitoring),
      (parsed) => parsed.type === 'rw_health_monitoring' && parsed.name === 'heart_rate'
    );
    await runRwSmokeStep(
      '血氧配置',
      buildRwReadHealthMonitoringCommand(RwKey.Spo2Monitoring),
      (parsed) => parsed.type === 'rw_health_monitoring' && parsed.name === 'spo2'
    );
    await runRwSmokeStep(
      '血糖配置',
      buildRwReadHealthMonitoringCommand(RwKey.BloodSugarMonitoring),
      (parsed) => parsed.type === 'rw_health_monitoring' && parsed.name === 'blood_sugar'
    );
    appendRwSmokeLog('RW 冒烟测试：完成');
    uni.showToast({ title: 'OK', icon: 'none' });
  } catch (error) {
    const message = error instanceof Error ? error.message : `${(error as any)?.errMsg || error}`;
    appendRwSmokeLog(`FAIL ${message}`);
    toastError(error, 'RW 冒烟测试失败');
  } finally {
    isRwSmokeTesting.value = false;
  }
};

const handleCheckOtaApi = async () => {
  try {
    const response = await getOtaInfo({ currentVersion: '1.0.0', deviceModel: 'ring' }, { custom: { returnAll: true } });
    const ok = 'code' in response && 'data' in response && 'msg' in response;
    uni.showToast({ title: ok ? 'OTA API OK' : 'OTA API shape changed', icon: 'none' });
  } catch (error) {
    toastError(error, 'OTA API failed');
  }
};

const handleCheckOtaHex = () => {
  try {
    const manager = new RingOTAManager();
    const partitions = manager.parseHexFile(sampleHex);
    uni.showToast({ title: `OTA HEX ${partitions.length}`, icon: 'none' });
  } catch (error) {
    toastError(error, 'OTA HEX failed');
  }
};
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  padding: 72rpx 28rpx 48rpx;
  box-sizing: border-box;
  background: #f6f8fb;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 20rpx;
  height: 72rpx;
}

.icon-button {
  width: 64rpx;
  height: 64rpx;
  margin: 0;
  padding: 0;
  border-radius: 8rpx;
  background: #ffffff;
  color: #172033;
  font-size: 44rpx;
  line-height: 58rpx;
}

.title {
  color: #172033;
  font-size: 38rpx;
  font-weight: 700;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16rpx;
  margin-top: 28rpx;
}

.status-item,
.panel {
  border: 1rpx solid #e5eaf2;
  border-radius: 8rpx;
  background: #ffffff;
}

.status-item {
  padding: 20rpx;
}

.status-label {
  display: block;
  color: #667085;
  font-size: 24rpx;
}

.status-value {
  display: block;
  margin-top: 8rpx;
  color: #172033;
  font-size: 28rpx;
  font-weight: 600;
}

.toolbar {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 24rpx;
}

.toolbar.compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.action-button,
.small-button,
.command-button {
  margin: 0;
  border-radius: 8rpx;
  font-size: 24rpx;
}

.action-button {
  height: 72rpx;
  background: #ffffff;
  color: #172033;
  line-height: 72rpx;
}

.action-button.primary {
  background: #2f6df6;
  color: #ffffff;
}

.action-button.danger {
  color: #d92d20;
}

.panel {
  margin-top: 24rpx;
  padding: 24rpx;
}

.panel-head,
.device-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
}

.panel-title {
  color: #172033;
  font-size: 30rpx;
  font-weight: 700;
}

.panel-title.small {
  font-size: 26rpx;
}

.panel-subhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  margin-top: 24rpx;
}

.panel-meta {
  color: #667085;
  font-size: 24rpx;
}

.empty {
  padding: 32rpx 0 8rpx;
  color: #98a2b3;
  font-size: 26rpx;
}

.device-row {
  min-height: 96rpx;
  border-top: 1rpx solid #edf1f7;
}

.device-row:first-of-type {
  margin-top: 16rpx;
}

.device-main {
  min-width: 0;
  flex: 1;
}

.device-actions {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.device-name,
.device-id,
.kv {
  display: block;
}

.device-name {
  color: #172033;
  font-size: 28rpx;
  font-weight: 600;
}

.device-id,
.kv {
  margin-top: 8rpx;
  color: #667085;
  font-size: 22rpx;
  word-break: break-all;
}

.small-button {
  width: 112rpx;
  height: 60rpx;
  background: #eef4ff;
  color: #2f6df6;
  line-height: 60rpx;
}

.command-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 20rpx;
}

.command-button {
  height: 68rpx;
  background: #f8fafc;
  color: #172033;
  line-height: 68rpx;
}

.json-box {
  margin-top: 20rpx;
  padding: 20rpx;
  border-radius: 8rpx;
  background: #101828;
  color: #ffffff;
  font-size: 22rpx;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.log-box {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 20rpx;
  padding: 20rpx;
  border-radius: 8rpx;
  background: #f8fafc;
  color: #344054;
  font-size: 22rpx;
  line-height: 1.5;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 20rpx;
}

.metric-item {
  min-height: 88rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  background: #f8fafc;
  box-sizing: border-box;
}

.metric-label,
.metric-value {
  display: block;
}

.metric-label {
  color: #667085;
  font-size: 22rpx;
}

.metric-value {
  margin-top: 8rpx;
  color: #172033;
  font-size: 26rpx;
  font-weight: 600;
  word-break: break-all;
}
</style>

