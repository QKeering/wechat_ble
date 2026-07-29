<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { getBindInfo } from '@/common/api/device';
import { getFamilyGuardians, type FamilyGuardian } from '@/common/api/family';
import { getBoundRingIdentity, hasBoundRingIdentity } from '@/utils/ringBinding';
import { formatBatteryPercentForDisplay } from '@/utils/batteryDisplay';
import { useRingBusinessData } from '@/composables/useRingBusinessData';
import { useRingStore } from '@/stores';
import { useUserStore } from '@/stores/user';

const loading = ref(false);
const boundDevice = ref<any>(null);
const guardians = ref<FamilyGuardian[]>([]);
const ring = useRingBusinessData();
const ringStore = useRingStore();
const userStore = useUserStore();

const pickFirstValue = (...values: unknown[]) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return undefined;
};

const formatSyncTime = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  if (!text || text === '0') return '';
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    const timestamp = numeric > 1e12 ? numeric : numeric > 1e9 ? numeric * 1000 : 0;
    if (timestamp > 0) {
      const date = new Date(timestamp);
      const pad = (item: number) => String(item).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
  }
  return text.replace('T', ' ').slice(0, 16);
};

const getDeviceMac = (device?: Record<string, any> | null) =>
  pickFirstValue(device?.mac, device?.deviceMac, device?.advertis?.macInfo, device?.uniMacId, device?.deviceId);

const device = computed(() => {
  const backend = boundDevice.value || {};
  const currentDevice = (ring.deviceInfo.value || {}) as Record<string, any>;
  const storeDevice = (ringStore.deviceInfo || {}) as Record<string, any>;
  const userDevice = (userStore.deviceInfo || {}) as Record<string, any>;
  const metrics = (ring.metrics.value || {}) as Record<string, any>;
  const healthData = (ring.healthData.value || {}) as Record<string, any>;
  const latestSyncAt =
    ring.lastMetricUpdateAt.value ||
    ringStore.lastMetricUpdateAt ||
    userStore.lastMetricUpdateAt ||
    healthData.lastMetricUpdateAt ||
    metrics.lastMetricUpdateAt ||
    0;

  return {
    ...storeDevice,
    ...userDevice,
    ...currentDevice,
    ...backend,
    deviceName:
      pickFirstValue(
        backend.deviceName,
        backend.name,
        currentDevice.displayName,
        currentDevice.deviceName,
        currentDevice.name,
        storeDevice.displayName,
        storeDevice.deviceName,
        storeDevice.name,
        userDevice.displayName,
        userDevice.deviceName,
        userDevice.name
      ) || '',
    name:
      pickFirstValue(
        backend.name,
        backend.deviceName,
        currentDevice.name,
        currentDevice.displayName,
        storeDevice.name,
        storeDevice.displayName,
        userDevice.name,
        userDevice.displayName
      ) || '',
    mac: pickFirstValue(getDeviceMac(backend), getDeviceMac(currentDevice), getDeviceMac(storeDevice), getDeviceMac(userDevice), ring.normalMac.value, ring.iosMacId.value),
    battery: pickFirstValue(
      backend.battery,
      backend.electricity,
      backend.power,
      metrics.battery,
      healthData.battery,
      healthData.batteryValue,
      userStore.latestMetrics?.battery,
      userStore.healthData?.battery
    ),
    lastSyncTime:
      pickFirstValue(
        backend.lastSyncTime,
        backend.lastSyncAt,
        backend.syncTime,
        backend.updateTime,
        backend.lastUploadTime,
        formatSyncTime(latestSyncAt)
      ) || ''
  };
});
const deviceIdentity = computed(() => getBoundRingIdentity(device.value) || device.value?.sn || device.value?.mac || '');
const hasDevice = computed(() => hasBoundRingIdentity(device.value) || Boolean(deviceIdentity.value));
const deviceName = computed(() => device.value?.deviceName || device.value?.name || '智能穿戴设备');
const lastSyncValue = computed(() =>
  formatSyncTime(pickFirstValue(device.value?.lastSyncTime, device.value?.lastSyncAt, device.value?.syncTime, device.value?.updateTime))
);
const lastSyncText = computed(() => {
  if (!lastSyncValue.value) return '还没有同步记录';
  return `最近同步：${lastSyncValue.value}`;
});
const batteryValue = computed(() => {
  const value = device.value?.battery ?? device.value?.electricity ?? device.value?.power;
  if (value === undefined || value === null || value === '') return null;
  const matched = String(value).match(/-?\d+(?:\.\d+)?/);
  const number = Math.round(Number(matched?.[0] ?? value));
  return Number.isNaN(number) ? null : number;
});
const batteryText = computed(() => {
  if (batteryValue.value == null) return '电量暂时未知';
  const displayValue = formatBatteryPercentForDisplay(batteryValue.value);
  if (batteryValue.value <= 20) return `电量 ${displayValue}，建议现在充电`;
  return `电量 ${displayValue}，可以继续使用`;
});
const statusText = computed(() => {
  if (!hasDevice.value) return '等待子女帮您绑定设备';
  if (batteryValue.value != null && batteryValue.value <= 20) return '设备电量偏低';
  if (!lastSyncValue.value) return '设备已绑定，等待同步';
  return '设备状态正常';
});
const statusClass = computed(() => {
  if (!hasDevice.value) return 'warn';
  if (batteryValue.value != null && batteryValue.value <= 20) return 'danger';
  if (!lastSyncValue.value) return 'warn';
  return 'good';
});
const helperText = computed(() => {
  if (!guardians.value.length) return '您还没有添加家人。可以先邀请子女，之后由子女帮您绑定和查看设备状态。';
  const names = guardians.value.map((item) => item.guardianName || item.guardianPhoneMasked || '家人').slice(0, 2).join('、');
  return `${names} 可以在授权范围内帮您查看设备是否同步、电量是否充足。`;
});

const fetchData = async () => {
  loading.value = true;
  try {
    const [deviceRes, guardiansRes] = await Promise.allSettled([getBindInfo(), getFamilyGuardians()]);
    boundDevice.value = deviceRes.status === 'fulfilled' ? deviceRes.value : null;
    guardians.value = guardiansRes.status === 'fulfilled' ? guardiansRes.value : [];
  } finally {
    loading.value = false;
  }
};

const syncDevice = () => {
  if (!hasDevice.value) {
    uni.showModal({
      title: '还没有绑定设备',
      content: '请让子女先在家人守护里帮您绑定设备。绑定后，您只需要佩戴设备并打开小程序同步。',
      confirmText: '联系家人',
      cancelText: '知道了',
      success: (res) => {
        if (res.confirm) {
          uni.navigateTo({ url: '/pages/family/inviteList' });
        }
      }
    });
    return;
  }
  uni.navigateTo({ url: '/pagesA/healths/deviceData' });
};

const openShareManage = () => {
  uni.navigateTo({ url: '/pages/family/shareManage' });
};

onShow(fetchData);

onPullDownRefresh(async () => {
  try {
    await fetchData();
  } finally {
    uni.stopPullDownRefresh();
  }
});
</script>

<template>
  <view class="page">
    <uv-navbar placeholder title="我的设备" bgColor="#f1f3f6"></uv-navbar>

    <view class="status-card" :class="statusClass">
      <view class="eyebrow">设备状态</view>
      <view class="status-title">{{ loading ? '正在查看设备' : statusText }}</view>
      <view class="status-desc">{{ hasDevice ? '请保持佩戴，打开小程序后可同步最新数据。' : '设备可以由子女先绑定好，您不用自己操作复杂流程。' }}</view>
    </view>

    <view class="device-card">
      <view class="device-name">{{ hasDevice ? deviceName : '暂未绑定设备' }}</view>
      <view class="device-id">{{ hasDevice ? deviceIdentity : '请让子女在家人守护中完成绑定' }}</view>
      <view class="info-row">
        <view class="info-label">最近同步</view>
        <view class="info-value">{{ lastSyncText }}</view>
      </view>
      <view class="info-row">
        <view class="info-label">设备电量</view>
        <view class="info-value" :class="{ danger: batteryValue != null && batteryValue <= 20 }">{{ batteryText }}</view>
      </view>
    </view>

    <view class="guide-card">
      <view class="guide-title">怎么使用</view>
      <view class="guide-line">1. 每天佩戴设备。</view>
      <view class="guide-line">2. 打开小程序，点“同步设备数据”。</view>
      <view class="guide-line">3. 子女就能看到最新的健康和设备状态。</view>
      <view class="guide-note">健康提醒只作日常照护参考，不作为医疗诊断。</view>
    </view>

    <view class="family-card" @click="openShareManage">
      <view class="family-title">家人协助</view>
      <view class="family-desc">{{ helperText }}</view>
      <view class="family-action">查看谁在看我的数据</view>
    </view>

    <view class="bottom-action">
      <uv-button
        :text="hasDevice ? '同步设备数据' : '联系家人绑定设备'"
        :color="hasDevice ? '#2E70FC' : '#16A34A'"
        :customStyle="{ height: '116rpx' }"
        :customTextStyle="{ fontSize: '40rpx', fontWeight: 800 }"
        @click="syncDevice"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f1f3f6;
  padding: 0 30rpx 60rpx;
  box-sizing: border-box;
}
.status-card,
.device-card,
.guide-card,
.family-card {
  margin-top: 28rpx;
  padding: 36rpx;
  border-radius: 24rpx;
  background: #ffffff;
}
.status-card.good {
  background: #eefaf3;
}
.status-card.warn {
  background: #fff8e8;
}
.status-card.danger {
  background: #fff0f0;
}
.eyebrow {
  font-size: 30rpx;
  color: #6b7280;
}
.status-title {
  margin-top: 12rpx;
  font-size: 52rpx;
  font-weight: 900;
  color: #111827;
  line-height: 1.2;
}
.status-desc,
.device-id,
.guide-note,
.family-desc {
  margin-top: 16rpx;
  font-size: 30rpx;
  color: #4b5563;
  line-height: 1.6;
}
.device-name,
.guide-title,
.family-title {
  font-size: 38rpx;
  font-weight: 800;
  color: #111827;
}
.info-row {
  display: flex;
  justify-content: space-between;
  gap: 24rpx;
  padding-top: 26rpx;
  margin-top: 26rpx;
  border-top: 2rpx solid #eef2f7;
}
.info-label {
  flex-shrink: 0;
  font-size: 32rpx;
  color: #6b7280;
}
.info-value {
  min-width: 0;
  font-size: 32rpx;
  font-weight: 700;
  color: #111827;
  text-align: right;
  line-height: 1.5;
}
.info-value.danger {
  color: #dc2626;
}
.guide-line {
  margin-top: 18rpx;
  font-size: 34rpx;
  color: #111827;
  line-height: 1.5;
}
.guide-note {
  padding: 18rpx 22rpx;
  border-radius: 18rpx;
  background: #f9fafb;
}
.family-card {
  border: 2rpx solid #dbeafe;
}
.family-action {
  margin-top: 18rpx;
  font-size: 32rpx;
  font-weight: 800;
  color: #2e70fc;
}
.bottom-action {
  margin-top: 34rpx;
}
</style>
