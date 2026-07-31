<template>
  <view class="ring-entry">
    <view class="hero">
      <view>
        <text class="eyebrow">智能戒指</text>
        <text class="title">健康数据</text>
        <text class="meta">{{ currentDeviceName }} · {{ currentDeviceTail }}</text>
      </view>
      <view class="status" :class="{ active: ring.isReady.value }">
        {{ ring.isReady.value ? '已连接' : ring.isRestoringDevice.value ? '恢复中' : ring.isScanning.value ? '搜索中' : '待连接' }}
      </view>
    </view>

    <view class="primary-grid">
      <view class="metric-card featured">
        <text class="metric-label">心率</text>
        <text class="metric-value">{{ heartRateText }}</text>
        <text class="metric-unit">bpm</text>
      </view>
      <view class="metric-card featured oxygen">
        <text class="metric-label">血氧</text>
        <text class="metric-value">{{ bloodOxygenText }}</text>
        <text class="metric-unit">%</text>
      </view>
    </view>

    <view class="actions">
      <button class="button primary" :disabled="ring.isRefreshingBusinessData.value || !ring.isReady.value" @tap="handleRefresh">
        {{ ring.isRefreshingBusinessData.value ? '更新中' : '更新健康数据' }}
      </button>
      <button class="button" :disabled="ring.isScanning.value" @tap="handleScan">
        {{ ring.isScanning.value ? '搜索中' : '搜索戒指' }}
      </button>
      <button class="button" :disabled="!ring.isReady.value || ring.isSyncingHistory.value" @tap="handleHistory">
        {{ ring.isSyncingHistory.value ? '同步中' : '同步历史' }}
      </button>
      <button class="button" :disabled="!ring.isReady.value || ring.isRefreshingBusinessData.value" @tap="handleMonitoring">
        开启健康监听
      </button>
    </view>

    <view class="panel">
      <view class="panel-head">
        <text class="panel-title">健康概览</text>
        <text class="panel-meta">{{ visibleDataStatusText }}</text>
      </view>
      <view class="grid">
        <view class="mini-card">
          <text class="mini-label">电量</text>
          <text class="mini-value">{{ batteryText }}</text>
        </view>
        <view class="mini-card">
          <text class="mini-label">电量状态</text>
          <text class="mini-value">{{ batteryStatusText }}</text>
        </view>
        <view class="mini-card">
          <text class="mini-label">皮肤温度</text>
          <text class="mini-value">{{ temperatureText }}</text>
        </view>
        <view class="mini-card">
          <text class="mini-label">HRV</text>
          <text class="mini-value">{{ hrvText }}</text>
        </view>
        <view class="mini-card">
          <text class="mini-label">压力</text>
          <text class="mini-value">{{ stressText }}</text>
        </view>
        <view class="mini-card">
          <text class="mini-label">血糖</text>
          <text class="mini-value">{{ bloodSugarText }}</text>
        </view>
        <view class="mini-card">
          <text class="mini-label">血压</text>
          <text class="mini-value">{{ bloodPressureText }}</text>
        </view>
        <view class="mini-card">
          <text class="mini-label">步数</text>
          <text class="mini-value">{{ stepText }}</text>
        </view>
        <view class="mini-card">
          <text class="mini-label">睡眠</text>
          <text class="mini-value">{{ sleepText }}</text>
        </view>
        <view class="mini-card">
          <text class="mini-label">佩戴状态</text>
          <text class="mini-value">{{ wornText }}</text>
        </view>
        <view class="mini-card">
          <text class="mini-label">疲劳</text>
          <text class="mini-value">{{ fatigueText }}</text>
        </view>
        <view class="mini-card">
          <text class="mini-label">焦虑</text>
          <text class="mini-value">{{ anxietyText }}</text>
        </view>
        <view class="mini-card">
          <text class="mini-label">固件版本</text>
          <text class="mini-value">{{ metrics.firmwareVersion || metrics.hardwareVersion || '-' }}</text>
        </view>
        <view class="mini-card">
          <text class="mini-label">软件版本</text>
          <text class="mini-value">{{ metrics.softwareVersion || metrics.uiVersion || '-' }}</text>
        </view>
      </view>
    </view>

    <view class="panel ai-lab-panel">
      <view class="panel-head">
        <view>
          <text class="panel-title">AI Lab</text>
          <text class="ai-lab-subtitle">基于健康数据的智能体验</text>
        </view>
        <text class="panel-meta">L3</text>
      </view>
    </view>

    <view class="panel">
      <view class="panel-head">
        <text class="panel-title">同步状态</text>
        <text class="panel-meta">{{ refreshStatusText }}</text>
      </view>
      <text class="line">已完成：{{ refreshOkText }}</text>
      <text v-if="ring.refreshFailedText.value" class="line warn">待返回：{{ ring.refreshFailedText.value }}</text>
      <text class="line">历史同步：{{ ring.historyResultText.value }}</text>
    </view>

    <view class="panel">
      <view class="panel-head">
        <text class="panel-title">附近戒指</text>
        <text class="panel-meta">{{ ring.businessDevices.value.length }} 台</text>
      </view>
      <view v-if="ring.businessDevices.value.length === 0" class="empty">
        {{ ring.isScanning.value ? '正在搜索附近戒指' : '暂无设备' }}
      </view>
      <view v-for="device in ring.businessDevices.value" :key="getRingBusinessDeviceKey(device)" class="device-row">
        <view class="device-copy">
          <text class="device-name">{{ getRingBusinessDeviceName(device) }}</text>
          <text class="device-meta">信号 {{ device.RSSI ?? device.rssi ?? '-' }} · 尾号 {{ getRingBusinessDeviceTail(device) }}</text>
        </view>
        <button class="connect-button" :disabled="isCurrentDevice(device)" @tap="handleConnect(device)">
          {{ isCurrentDevice(device) ? '已连' : '连接' }}
        </button>
      </view>
    </view>

    <view class="secondary-actions">
      <button class="minor-button" :disabled="!ring.isScanning.value" @tap="handleStopScan">停止搜索</button>
      <button class="minor-button" @tap="handleClearData">清空数据</button>
      <button class="minor-button danger" :disabled="!ring.isReady.value" @tap="handleDisconnect">断开连接</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import { getRingDeviceStableIdentity } from '@/composables/useRingBleSdk';
import { getRingBusinessDeviceKey, getRingBusinessDeviceName, getRingBusinessDeviceTail } from '@/composables/useRingBusinessController';
import { ensureRingBusinessPageReady, useRingBusinessController } from '@/features/ring';
import { formatBleErrorMessage } from '@/utils/bleError';
import { showErrorToast } from '@/utils/errorToast';
import { normalizeHealthText } from '@/utils/healthText';
import { formatBatteryStatusForDisplay } from '@/utils/batteryDisplay';
import type { RingDeviceInfo } from '@/sdk/ring-ble';

const ring = useRingBusinessController();
const metrics = computed(() => ring.metrics.value);

const currentDeviceName = computed(() => (ring.isReady.value ? getRingBusinessDeviceName(ring.deviceInfo.value) : '未连接戒指'));
const currentDeviceTail = computed(() => `尾号 ${getRingBusinessDeviceTail(ring.deviceInfo.value)}`);
const heartRateText = computed(() => metrics.value.heartRate ?? normalizeHealthText(metrics.value.heartRateStatus, '-'));
const bloodOxygenText = computed(() => metrics.value.bloodOxygen ?? normalizeHealthText(metrics.value.bloodOxygenStatus, '-'));
const batteryText = computed(() => formatBatteryStatusForDisplay(metrics.value.battery, metrics.value.batteryStatus || metrics.value.chargingStatusText));
const batteryStatusText = computed(() => normalizeHealthText(metrics.value.batteryStatus, '-'));
const temperatureText = computed(() => metrics.value.temperature ?? normalizeHealthText(metrics.value.temperatureStatus, '-'));
const hrvText = computed(() => metrics.value.hrv ?? normalizeHealthText(metrics.value.hrvStatus, '-'));
const stressText = computed(() => metrics.value.stress ?? normalizeHealthText(metrics.value.stressStatus, '-'));
const bloodSugarText = computed(() => metrics.value.bloodSugar ?? normalizeHealthText(metrics.value.bloodSugarStatus, '-'));
const bloodPressureText = computed(() => formatBloodPressure(metrics.value.bloodPressure) || normalizeHealthText(metrics.value.bloodPressureStatus, '-'));
const stepText = computed(() => metrics.value.stepCount ?? '-');
const sleepText = computed(() => {
  if (metrics.value.sleepTotalMinutes == null) return normalizeHealthText(metrics.value.sleepStatus, '-');
  const hours = Math.floor(metrics.value.sleepTotalMinutes / 60);
  const minutes = metrics.value.sleepTotalMinutes % 60;
  return hours > 0 ? `${hours}小时${minutes}分` : `${minutes}分`;
});

const wornText = computed(() => {
  if (metrics.value.isWorn === true) return '佩戴中';
  if (metrics.value.isWorn === false) return '未佩戴';
  return '-';
});
const fatigueText = computed(() => normalizeHealthText(metrics.value.fatigueLevel, '') || normalizeHealthText(metrics.value.fatigue, '-'));
const anxietyText = computed(() => normalizeHealthText(metrics.value.anxietyLevel, '') || normalizeHealthText(metrics.value.anxiety, '-'));

const dataStatusText = computed(() => {
  if (ring.isRestoringDevice.value) return '恢复中';
  if (ring.isRefreshingBusinessData.value) return '更新中';
  if (ring.isSyncingHistory.value) return '同步历史中';
  if (ring.lastRefreshResult.value?.status === 'success') return '已读取';
  if (ring.lastRefreshResult.value?.status === 'partial') return '部分完成';
  return ring.isReady.value ? '待更新' : '待连接';
});

const refreshStatusText = computed(() => {
  if (ring.isRestoringDevice.value) return '恢复中';
  if (ring.isRefreshingBusinessData.value) return '刷新中';
  if (ring.isSyncingHistory.value) return '同步中';
  const status = ring.lastRefreshResult.value?.status;
  if (status === 'success') return '已同步';
  if (status === 'partial') return '部分完成';
  if (status === 'failed') return '同步失败';
  return ring.isReady.value ? '待刷新' : '待连接';
});

const refreshOkText = computed(() => {
  const ok = ring.lastRefreshResult.value?.ok || [];
  return ok.length > 0 ? ok.map(getRefreshStepText).join('、') : '-';
});

const visibleDataStatusText = computed(() => {
  const updatedText = ring.businessDataFreshnessText.value;
  if (ring.isRefreshingBusinessData.value && updatedText !== '未读取') return `${dataStatusText.value} · ${updatedText}`;
  if (!ring.isRefreshingBusinessData.value && updatedText !== '未读取') return updatedText;
  return dataStatusText.value;
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
  const text: Record<string, string> = {
    battery: '电量',
    firmware: '固件版本',
    software: '软件版本',
    heart_rate: '心率',
    blood_oxygen: '血氧',
    temperature: '皮肤温度',
    temperature_pending: '皮肤温度状态',
    last_data: '最新数据',
    collect_period: '监听状态',
    history_snapshot: '历史快照',
    history_status: '历史状态',
    device_time: '设备时间'
  };
  return text[step] || step;
};

const showError = (error: unknown, fallback: string) => {
  showErrorToast(formatBleErrorMessage(error, fallback));
};

const hideSystemLoading = () => {
  uni.hideLoading();
};

const handleScan = async () => {
  try {
    await ring.scanForBusinessDevices();
  } catch (error) {
    showError(error, '搜索失败');
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
    await ring.refreshBusinessData();
  } catch (error) {
    showError(error, '更新失败');
  }
};

const handleHistory = async () => {
  try {
    await ring.syncBusinessHistory(false);
  } catch (error) {
    showError(error, '同步失败');
  }
};

const handleMonitoring = async () => {
  try {
    await ring.enableHealthMonitoring(1800);
    uni.showToast({ title: '监听已下发', icon: 'none' });
  } catch (error) {
    showError(error, '监听失败');
  }
};

const handleStopScan = async () => {
  try {
    await ring.stopScan();
  } catch (error) {
    showError(error, '停止搜索失败');
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

const ensureBusinessEntryReady = async () => {
  try {
    await ensureRingBusinessPageReady(ring);
  } catch (error) {
    showError(error, '戒指数据准备失败');
  }
};

onMounted(() => {
  void ensureBusinessEntryReady();
});

onShow(() => {
  void ensureBusinessEntryReady();
});

onHide(() => {
  ring.pauseBusinessAutoRefresh();
});
</script>

<style lang="scss" scoped>
.ring-entry {
  min-height: 100vh;
  padding: 56rpx 28rpx 48rpx;
  box-sizing: border-box;
  background: #f5f7fb;
}

.hero {
  display: flex;
  justify-content: space-between;
  gap: 20rpx;
  padding: 28rpx;
  border-radius: 8rpx;
  background: #172033;
  color: #ffffff;
}

.eyebrow,
.meta,
.metric-label,
.metric-unit,
.mini-label,
.panel-meta,
.device-meta,
.line {
  color: #667085;
  font-size: 22rpx;
}

.hero .eyebrow,
.hero .meta {
  display: block;
  color: rgba(255, 255, 255, 0.68);
}

.title {
  display: block;
  margin: 8rpx 0;
  color: #ffffff;
  font-size: 42rpx;
  font-weight: 700;
}

.status {
  align-self: flex-start;
  padding: 10rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.82);
  font-size: 22rpx;
}

.status.active {
  background: #d1fadf;
  color: #027a48;
}

.primary-grid,
.actions,
.secondary-actions,
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
}

.primary-grid,
.actions,
.secondary-actions,
.panel {
  margin-top: 22rpx;
}

.metric-card,
.mini-card,
.panel {
  border: 1rpx solid #e5eaf2;
  border-radius: 8rpx;
  background: #ffffff;
}

.metric-card {
  min-height: 156rpx;
  padding: 22rpx;
  box-sizing: border-box;
}

.metric-card.oxygen {
  background: #eef4ff;
}

.metric-value {
  display: inline-block;
  margin-top: 16rpx;
  color: #172033;
  font-size: 58rpx;
  font-weight: 800;
  line-height: 1;
}

.metric-unit {
  margin-left: 8rpx;
}

.button,
.connect-button,
.minor-button {
  margin: 0;
  border-radius: 8rpx;
  font-size: 24rpx;
}

.button {
  min-height: 76rpx;
  background: #ffffff;
  color: #172033;
  line-height: 76rpx;
}

.button.primary {
  background: #2f6df6;
  color: #ffffff;
}

.minor-button {
  min-height: 72rpx;
  background: #ffffff;
  color: #344054;
  line-height: 72rpx;
}

.minor-button.danger {
  color: #b42318;
}

.panel {
  padding: 24rpx;
}

.ai-lab-subtitle {
  display: block;
  margin-top: 8rpx;
  color: #98a2b3;
  font-size: 22rpx;
}

.panel-head,
.device-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.panel-title {
  color: #172033;
  font-size: 30rpx;
  font-weight: 700;
}

.grid {
  margin-top: 18rpx;
}

.mini-card {
  min-height: 120rpx;
  padding: 18rpx;
  box-sizing: border-box;
  background: #fbfcff;
}

.mini-value {
  display: block;
  margin-top: 10rpx;
  color: #172033;
  font-size: 28rpx;
  font-weight: 700;
  word-break: break-all;
}

.line {
  display: block;
  margin-top: 12rpx;
  line-height: 1.5;
}

.line.warn {
  color: #b42318;
}

.empty {
  padding: 28rpx 0 8rpx;
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

.device-copy {
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

.connect-button {
  width: 112rpx;
  height: 64rpx;
  background: #eef4ff;
  color: #2f6df6;
  line-height: 64rpx;
}
</style>
