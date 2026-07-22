<template>
  <view class="page">
    <view class="hero">
      <view class="topbar">
        <button class="back-button" @tap="goBack">返</button>
        <view class="title-block">
          <text class="eyebrow">智能戒指</text>
          <text class="title">健康数据</text>
        </view>
        <text class="status-pill" :class="{ connected: ring.isReady.value }">{{ connectionText }}</text>
      </view>

      <view class="device-summary">
        <view>
          <text class="summary-label">当前设备</text>
          <text class="summary-name">{{ currentDeviceName }}</text>
          <text class="summary-meta">尾号 {{ currentDeviceTail }} · {{ dataStatusText }}</text>
        </view>
        <view class="battery-badge">
          <text class="battery-value">{{ batteryText }}</text>
          <text class="battery-label">{{ batteryStatusText }}</text>
        </view>
      </view>

      <view class="primary-metrics">
        <view class="primary-card">
          <text class="primary-label">心率</text>
          <text class="primary-value">{{ heartRateText }}</text>
          <text class="primary-unit">bpm</text>
        </view>
        <view class="primary-card oxygen">
          <text class="primary-label">血氧</text>
          <text class="primary-value">{{ bloodOxygenText }}</text>
          <text class="primary-unit">%</text>
        </view>
      </view>
    </view>

    <view class="quick-actions">
      <button class="action-button primary" :disabled="ring.isRefreshingBusinessData.value || !ring.isReady.value" @tap="handleRefresh">
        {{ ring.isRefreshingBusinessData.value ? '更新中' : '更新健康数据' }}
      </button>
      <button class="action-button" :disabled="ring.isScanning.value" @tap="handleScan">
        {{ ring.isScanning.value ? '搜索中' : '搜索戒指' }}
      </button>
      <button class="action-button" :disabled="!ring.isReady.value || ring.isRefreshingBusinessData.value" @tap="handleEnableMonitoring">
        开启健康监听
      </button>
      <button class="action-button" :disabled="!ring.isReady.value || ring.isSyncingHistory.value" @tap="handleSyncHistory">
        {{ ring.isSyncingHistory.value ? '同步中' : '同步历史' }}
      </button>
    </view>

    <view class="panel health-panel">
      <view class="panel-head">
        <text class="panel-title">健康概览</text>
        <text class="panel-meta">{{ metricsUpdatedText }}</text>
      </view>
      <view class="metric-grid">
        <view class="metric-card">
          <text class="metric-label">皮肤温度</text>
          <text class="metric-value">{{ temperatureText }}</text>
        </view>
        <view class="metric-card">
          <text class="metric-label">监听状态</text>
          <text class="metric-value">{{ monitoringStatusText }}</text>
        </view>
        <view class="metric-card">
          <text class="metric-label">HRV</text>
          <text class="metric-value">{{ hrvText }}</text>
        </view>
        <view class="metric-card">
          <text class="metric-label">压力</text>
          <text class="metric-value">{{ stressText }}</text>
        </view>
        <view class="metric-card">
          <text class="metric-label">血糖</text>
          <text class="metric-value">{{ bloodSugarText }}</text>
        </view>
        <view class="metric-card">
          <text class="metric-label">血压</text>
          <text class="metric-value">{{ bloodPressureText }}</text>
        </view>
        <view class="metric-card">
          <text class="metric-label">步数</text>
          <text class="metric-value">{{ stepText }}</text>
        </view>
        <view class="metric-card">
          <text class="metric-label">睡眠</text>
          <text class="metric-value">{{ sleepText }}</text>
        </view>
        <view class="metric-card">
          <text class="metric-label">佩戴状态</text>
          <text class="metric-value">{{ wornText }}</text>
        </view>
        <view class="metric-card">
          <text class="metric-label">疲劳</text>
          <text class="metric-value">{{ fatigueText }}</text>
        </view>
        <view class="metric-card">
          <text class="metric-label">焦虑</text>
          <text class="metric-value">{{ anxietyText }}</text>
        </view>
        <view class="metric-card">
          <text class="metric-label">固件版本</text>
          <text class="metric-value">{{ metrics.firmwareVersion || metrics.hardwareVersion || '-' }}</text>
        </view>
        <view class="metric-card">
          <text class="metric-label">软件版本</text>
          <text class="metric-value">{{ metrics.softwareVersion || metrics.uiVersion || '-' }}</text>
        </view>
      </view>
    </view>

    <view class="panel">
      <view class="panel-head">
        <text class="panel-title">同步状态</text>
        <text class="panel-meta">{{ refreshStatusText }}</text>
      </view>
      <text class="status-line">已完成：{{ refreshOkText }}</text>
      <text v-if="ring.refreshFailedText.value" class="status-line warn">待返回：{{ ring.refreshFailedText.value }}</text>
      <text class="status-line">历史同步：{{ ring.historyResultText.value }}</text>
    </view>

    <view class="panel">
      <view class="panel-head">
        <text class="panel-title">附近戒指</text>
        <text class="panel-meta">{{ ring.businessDevices.value.length }} 台</text>
      </view>
      <view v-if="ring.businessDevices.value.length === 0" class="empty">
        <text>{{ ring.isScanning.value ? '正在搜索附近戒指' : '暂无设备，请点击搜索戒指' }}</text>
      </view>
      <view v-for="device in ring.businessDevices.value" :key="getRingBusinessDeviceKey(device)" class="device-row">
        <view class="device-main">
          <text class="device-name">{{ getRingBusinessDeviceName(device) }}</text>
          <text class="device-meta">信号 {{ device.RSSI ?? device.rssi ?? '-' }} · 尾号 {{ getRingBusinessDeviceTail(device) }}</text>
        </view>
        <button class="small-button" :disabled="isCurrentDevice(device)" @tap="handleConnect(device)">
          {{ isCurrentDevice(device) ? '已连接' : '连接' }}
        </button>
      </view>
    </view>

    <view class="secondary-actions">
      <button class="minor-button" @tap="handleClearData">清空数据</button>
      <button class="minor-button danger" :disabled="!ring.isReady.value" @tap="handleDisconnect">断开连接</button>
      <button class="minor-button" @tap="handleStopScan">停止搜索</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import { getRingDeviceStableIdentity } from '@/composables/useRingBleSdk';
import { ensureRingBusinessPageReady, getRingBusinessDeviceKey, getRingBusinessDeviceName, getRingBusinessDeviceTail, useRingBusinessController } from '@/features/ring';
import { formatBleErrorMessage } from '@/utils/bleError';
import { normalizeHealthText } from '@/utils/healthText';
import { formatBatteryStatusForDisplay } from '@/utils/batteryDisplay';
import type { RingDeviceInfo } from '@/sdk/ring-ble';

const ring = useRingBusinessController();
const metrics = computed(() => ring.metrics.value);
const healthStatusText = (value: unknown, fallback = '-') => normalizeHealthText(value, fallback);
const heartRateText = computed(() => metrics.value.heartRate ?? healthStatusText(metrics.value.heartRateStatus));
const bloodOxygenText = computed(() => metrics.value.bloodOxygen ?? healthStatusText(metrics.value.bloodOxygenStatus));
const temperatureText = computed(() => metrics.value.temperature ?? healthStatusText(metrics.value.temperatureStatus));
const hrvText = computed(() => metrics.value.hrv ?? healthStatusText(metrics.value.hrvStatus));
const stressText = computed(() => metrics.value.stress ?? healthStatusText(metrics.value.stressStatus));
const bloodSugarText = computed(() => metrics.value.bloodSugar ?? healthStatusText(metrics.value.bloodSugarStatus));
const bloodPressureText = computed(() => formatBloodPressure(metrics.value.bloodPressure) || healthStatusText(metrics.value.bloodPressureStatus));
const stepText = computed(() => metrics.value.stepCount ?? '-');
const sleepText = computed(() => {
  if (metrics.value.sleepTotalMinutes == null) return healthStatusText(metrics.value.sleepStatus);
  const hours = Math.floor(metrics.value.sleepTotalMinutes / 60);
  const minutes = metrics.value.sleepTotalMinutes % 60;
  return hours > 0 ? `${hours}小时${minutes}分` : `${minutes}分`;
});
const wornText = computed(() => {
  if (metrics.value.isWorn === true) return '佩戴中';
  if (metrics.value.isWorn === false) return '未佩戴';
  return '-';
});
const fatigueText = computed(() => healthStatusText(metrics.value.fatigueLevel || metrics.value.fatigue));
const anxietyText = computed(() => healthStatusText(metrics.value.anxietyLevel || metrics.value.anxiety));
const batteryText = computed(() => formatBatteryStatusForDisplay(metrics.value.battery, metrics.value.batteryStatus || metrics.value.chargingStatusText));
const batteryStatusText = computed(() => normalizeHealthText(metrics.value.batteryStatus, '电量'));
const monitoringStatusText = computed(() => healthStatusText(metrics.value.monitoringStatus));
const currentDeviceName = computed(() => (ring.isReady.value ? getRingBusinessDeviceName(ring.deviceInfo.value) : '未连接戒指'));
const currentDeviceTail = computed(() => getRingBusinessDeviceTail(ring.deviceInfo.value));
const connectionText = computed(() => (ring.isReady.value ? '已连接' : ring.isScanning.value ? '搜索中' : '待连接'));
const refreshStatusText = computed(() => {
  if (ring.isRestoringDevice.value) return '恢复中';
  if (ring.isRefreshingBusinessData.value) return '刷新中';
  const status = ring.lastRefreshResult.value?.status;
  if (status === 'partial' && !ring.refreshFailedText.value) return '已同步';
  if (status === 'success') return '已同步';
  if (status === 'partial') return '部分完成';
  if (status === 'failed') return '同步失败';
  return ring.isReady.value ? '待刷新' : '待连接';
});
const refreshOkText = computed(() => {
  const ok = ring.lastRefreshResult.value?.ok || [];
  if (ok.length === 0) return '-';
  return ok.map(getRefreshStepText).join('、');
});
const dataStatusText = computed(() => {
  if (ring.isRestoringDevice.value) return '恢复中';
  if (ring.isRefreshingBusinessData.value) {
    const updatedText = ring.businessDataFreshnessText.value;
    return updatedText === '未读取' ? '刷新中' : `刷新中 · ${updatedText}`;
  }
  if (ring.isSyncingHistory.value) return '同步历史中';
  if (ring.lastRefreshResult.value?.status === 'success') return '已更新';
  if (ring.lastRefreshResult.value?.status === 'partial' && !ring.refreshFailedText.value) return '已更新';
  if (ring.lastRefreshResult.value?.status === 'partial') return '部分更新';
  const updatedText = ring.businessDataFreshnessText.value;
  if (updatedText !== '未读取') return updatedText;
  return ring.isReady.value ? '待更新' : '待连接';
});
const metricsUpdatedText = computed(() => {
  if (ring.isRestoringDevice.value) return '恢复中';
  const updatedText = ring.businessDataFreshnessText.value;
  if (ring.isRefreshingBusinessData.value) return updatedText === '未读取' ? '更新中' : `更新中 · ${updatedText}`;
  if (updatedText !== '未读取') return updatedText;
  return '等待读取';
});

const formatBloodPressure = (value: unknown) => {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'string') return `${value}`;
  if (typeof value !== 'object') return '';
  const record = value as Record<string, any>;
  const systolic = record.systolic ?? record.high ?? record.sbp;
  const diastolic = record.diastolic ?? record.low ?? record.dbp;
  if (systolic == null || diastolic == null) return '';
  return `${systolic}/${diastolic}`;
};

const isCurrentDevice = (device: RingDeviceInfo) => {
  return ring.isCurrentBusinessDevice(device);
};

const getRefreshStepText = (step: string) => {
  const stepText: Record<string, string> = {
    battery: '电量',
    firmware: '固件版本',
    software: '软件版本',
    heart_rate: '心率',
    blood_oxygen: '血氧',
    temperature: '皮肤温度',
    temperature_pending: '皮肤温度状态',
    last_data: '最新数据',
    collect_period: '监听状态',
    collect_period_pending: '监听状态',
    history_snapshot: '历史快照',
    history_pending: '历史状态',
    history_status: '历史状态',
    device_time: '设备时间'
  };

  return stepText[step] || step;
};

const goBack = () => {
  if (getCurrentPages().length > 1) {
    uni.navigateBack();
    return;
  }
  uni.redirectTo({ url: '/pages/home/index' });
};

const showError = (error: unknown, fallback: string) => {
  uni.showToast({ title: formatBleErrorMessage(error, fallback), icon: 'none' });
};

const hideSystemLoading = () => {
  uni.hideLoading();
};

const handleScan = async () => {
  try {
    await ring.scanForBusinessDevices();
  } catch (error) {
    showError(error, '扫描失败');
  }
};

const handleStopScan = async () => {
  try {
    await ring.stopScan();
  } catch (error) {
    showError(error, '停止扫描失败');
  }
};

const handleConnect = async (device: RingDeviceInfo) => {
  uni.showLoading({ title: '连接中', mask: true });
  try {
    await ring.connectBusinessDevice(device, { refreshAfterConnect: false });
    uni.showToast({ title: '连接成功', icon: 'success' });
    void refreshAfterConnect();
  } catch (error) {
    showError(error, '连接失败');
  } finally {
    hideSystemLoading();
  }
};

const refreshAfterConnect = async () => {
  try {
    await ring.refreshBusinessData();
  } catch (error) {
    showError(error, '健康数据刷新失败');
  }
};

const handleRefresh = async () => {
  try {
    const result = await ring.refreshBusinessData();
    uni.showToast({
      title: result.status === 'success' ? '刷新成功' : `部分刷新 ${result.ok.length}`,
      icon: 'none'
    });
  } catch (error) {
    showError(error, '刷新失败');
  }
};

const handleEnableMonitoring = async () => {
  uni.showLoading({ title: '配置中', mask: true });
  try {
    await ring.enableHealthMonitoring(1800);
    uni.showToast({ title: '监听已下发', icon: 'none' });
  } catch (error) {
    showError(error, '监听配置失败');
  } finally {
    hideSystemLoading();
  }
};

const handleSyncHistory = async () => {
  try {
    const result = await ring.syncBusinessHistory(false);
    uni.showToast({ title: result.status === 'rw_history_pending' ? '历史数据待同步' : `历史${result.records.length}条`, icon: 'none' });
  } catch (error) {
    showError(error, '同步历史失败');
  }
};

const handleClearData = () => {
  ring.clearBusinessData();
  uni.showToast({ title: '已清空', icon: 'none' });
};

const handleDisconnect = async () => {
  try {
    await ring.disconnect();
    uni.showToast({ title: '已断开', icon: 'none' });
  } catch (error) {
    showError(error, '断开失败');
  }
};

const ensureBusinessPageReady = async () => {
  try {
    await ensureRingBusinessPageReady(ring);
  } catch (error) {
    showError(error, '戒指数据准备失败');
  }
};

onMounted(() => {
  void ensureBusinessPageReady();
});

onShow(() => {
  void ensureBusinessPageReady();
});

onHide(() => {
  ring.pauseBusinessAutoRefresh();
});
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  padding: 64rpx 28rpx 48rpx;
  box-sizing: border-box;
  background: #f5f7fb;
}

.hero {
  padding: 28rpx;
  border-radius: 8rpx;
  background: #172033;
  color: #ffffff;
}

.topbar,
.device-summary,
.panel-head,
.device-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
}

.back-button {
  width: 64rpx;
  height: 64rpx;
  margin: 0;
  padding: 0;
  border: 1rpx solid rgba(255, 255, 255, 0.28);
  border-radius: 8rpx;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font-size: 30rpx;
  line-height: 64rpx;
}

.title-block {
  min-width: 0;
  flex: 1;
}

.eyebrow,
.summary-label,
.primary-label,
.battery-label,
.metric-label,
.panel-meta,
.device-meta,
.status-line {
  color: #667085;
  font-size: 22rpx;
}

.hero .eyebrow,
.hero .summary-label,
.hero .primary-label,
.hero .battery-label {
  color: rgba(255, 255, 255, 0.68);
}

.title {
  display: block;
  margin-top: 4rpx;
  color: #ffffff;
  font-size: 42rpx;
  font-weight: 700;
}

.status-pill {
  margin-right: 118rpx;
  padding: 10rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.78);
  font-size: 22rpx;
}

.status-pill.connected {
  background: #d1fadf;
  color: #027a48;
}

.device-summary {
  margin-top: 34rpx;
}

.summary-name {
  display: block;
  margin-top: 8rpx;
  color: #ffffff;
  font-size: 36rpx;
  font-weight: 700;
}

.summary-meta {
  display: block;
  margin-top: 8rpx;
  color: rgba(255, 255, 255, 0.66);
  font-size: 24rpx;
}

.battery-badge {
  width: 136rpx;
  min-height: 116rpx;
  margin-right: 118rpx;
  padding: 18rpx 12rpx;
  box-sizing: border-box;
  border-radius: 8rpx;
  background: rgba(255, 255, 255, 0.12);
  text-align: center;
}

.battery-value {
  display: block;
  color: #ffffff;
  font-size: 34rpx;
  font-weight: 700;
}

.battery-label {
  display: block;
  margin-top: 8rpx;
}

.primary-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16rpx;
  margin-top: 28rpx;
}

.primary-card {
  min-height: 164rpx;
  padding: 22rpx;
  box-sizing: border-box;
  border-radius: 8rpx;
  background: #ffffff;
}

.primary-card.oxygen {
  background: #eef4ff;
}

.primary-card .primary-label {
  color: #667085;
}

.primary-value {
  display: inline-block;
  margin-top: 16rpx;
  color: #172033;
  font-size: 58rpx;
  font-weight: 800;
  line-height: 1;
}

.primary-unit {
  margin-left: 8rpx;
  color: #667085;
  font-size: 22rpx;
}

.quick-actions,
.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
}

.quick-actions {
  margin-top: 22rpx;
}

.action-button,
.small-button,
.minor-button {
  margin: 0;
  border-radius: 8rpx;
  font-size: 24rpx;
}

.action-button {
  min-height: 76rpx;
  background: #ffffff;
  color: #172033;
  line-height: 76rpx;
}

.action-button.primary {
  background: #2f6df6;
  color: #ffffff;
}

.panel {
  margin-top: 22rpx;
  padding: 24rpx;
  border: 1rpx solid #e5eaf2;
  border-radius: 8rpx;
  background: #ffffff;
}

.panel-title {
  color: #172033;
  font-size: 30rpx;
  font-weight: 700;
}

.health-panel .panel-head {
  margin-bottom: 18rpx;
}

.metric-card {
  min-height: 128rpx;
  padding: 20rpx;
  box-sizing: border-box;
  border: 1rpx solid #edf1f7;
  border-radius: 8rpx;
  background: #fbfcff;
}

.metric-value {
  display: block;
  margin-top: 10rpx;
  color: #172033;
  font-size: 28rpx;
  font-weight: 700;
  word-break: break-all;
}

.status-line {
  display: block;
  margin-top: 12rpx;
  line-height: 1.5;
}

.status-line.warn {
  color: #b42318;
}

.empty {
  padding: 32rpx 0 8rpx;
  color: #98a2b3;
  font-size: 26rpx;
}

.device-row {
  min-height: 104rpx;
  border-top: 1rpx solid #edf1f7;
}

.device-row:first-of-type {
  margin-top: 16rpx;
}

.device-main {
  min-width: 0;
  flex: 1;
}

.device-name,
.device-meta {
  display: block;
  margin-top: 8rpx;
  word-break: break-all;
}

.device-name {
  color: #172033;
  font-size: 28rpx;
  font-weight: 700;
}

.small-button {
  width: 112rpx;
  height: 64rpx;
  background: #eef4ff;
  color: #2f6df6;
  line-height: 64rpx;
}

.secondary-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12rpx;
  margin-top: 22rpx;
}

.minor-button {
  min-height: 68rpx;
  background: #ffffff;
  color: #475467;
  font-size: 22rpx;
  line-height: 68rpx;
}

.minor-button.danger {
  color: #d92d20;
}
</style>
