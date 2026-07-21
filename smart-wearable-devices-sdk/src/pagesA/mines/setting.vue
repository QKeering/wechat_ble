<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getBindInfo } from '@/common/api/device';
import { useRingBusinessController } from '@/composables/useRingBusinessController';
import { useRingBusinessData } from '@/composables/useRingBusinessData';
import { formatBleErrorMessage } from '@/utils/bleError';
import { hasBoundRingIdentity } from '@/utils/ringBinding';

const controller = useRingBusinessController();
const ring = useRingBusinessData();
const boundInfo = ref<Record<string, any> | null>(null);
const busyText = ref('');
const lastActionText = ref('');

const isBusy = computed(() => Boolean(busyText.value) || controller.isRestoringDevice.value || controller.isRefreshingBusinessData.value);
const connectionText = computed(() => (ring.isConnected.value ? '已连接' : hasBoundRingIdentity(boundInfo.value) ? '待恢复' : '未绑定'));
const monitorText = computed(() => {
  const seconds = ring.metrics.value.collectPeriodSeconds;
  if (seconds) return `每 ${Math.round(seconds / 60)} 分钟`;
  return ring.metrics.value.monitoringStatus || '未配置';
});
const statusText = computed(() => busyText.value || lastActionText.value || ring.businessDataFreshnessText.value);

const loadBoundInfo = async () => {
  try {
    const info = await getBindInfo();
    boundInfo.value = info || null;
  } catch {
    boundInfo.value = null;
  }
};

const ensureDeviceReady = async () => {
  if (controller.isReady.value) return true;
  return controller.restoreLastBusinessDevice({ refreshAfterRestore: false });
};

const enableMonitoring = async () => {
  if (isBusy.value) return;
  busyText.value = '配置健康监听中';
  lastActionText.value = '';
  try {
    const ready = await ensureDeviceReady();
    if (!ready) throw new Error('设备未连接，请重新连接后再试');
    await controller.enableHealthMonitoring(1800);
    lastActionText.value = '健康监听已配置';
    uni.showToast({ title: '已配置', icon: 'success' });
  } catch (error) {
    lastActionText.value = formatBleErrorMessage(error, '健康监听配置失败');
    uni.showToast({ title: lastActionText.value, icon: 'none' });
  } finally {
    busyText.value = '';
    await loadBoundInfo();
  }
};

const goHistorySync = async () => {
  if (!controller.isReady.value && hasBoundRingIdentity(boundInfo.value)) {
    busyText.value = '恢复设备连接中';
    try {
      await controller.restoreLastBusinessDevice({ refreshAfterRestore: false });
    } catch {
      // The history page owns the final retry and user-facing failure state.
    } finally {
      busyText.value = '';
    }
  }
  uni.navigateTo({ url: '/pagesA/healths/deviceData' });
};

onShow(async () => {
  await loadBoundInfo();
});
</script>

<template>
  <view class="page">
    <view class="title">功能设置</view>

    <view class="card">
      <view class="row">
        <view>
          <text class="label">连接状态</text>
          <text class="hint">{{ statusText }}</text>
        </view>
        <text class="value">{{ connectionText }}</text>
      </view>
      <view class="row">
        <view>
          <text class="label">健康监听</text>
          <text class="hint">{{ monitorText }}</text>
        </view>
        <button class="action" :disabled="isBusy" @tap="enableMonitoring">{{ isBusy ? busyText : '配置' }}</button>
      </view>
      <view class="row">
        <view>
          <text class="label">历史同步</text>
          <text class="hint">同步戒指本地健康数据</text>
        </view>
        <button class="action ghost" :disabled="isBusy" @tap="goHistorySync">同步</button>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding: 32rpx;
  background: #f1f3f6;
  box-sizing: border-box;
}

.title {
  margin-bottom: 24rpx;
  color: #111827;
  font-size: 44rpx;
  font-weight: 700;
}

.card {
  padding: 8rpx 32rpx;
  border-radius: 24rpx;
  background: #fff;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24rpx;
  min-height: 112rpx;
  border-bottom: 1rpx solid #f0f2f5;
}

.row:last-child {
  border-bottom: 0;
}

.label,
.hint {
  display: block;
}

.label {
  color: #111827;
  font-size: 32rpx;
  font-weight: 600;
}

.hint {
  margin-top: 8rpx;
  color: #8b93a1;
  font-size: 26rpx;
}

.value {
  flex-shrink: 0;
  color: #2b6ff6;
  font-size: 28rpx;
}

.action {
  flex-shrink: 0;
  width: 152rpx;
  height: 64rpx;
  line-height: 64rpx;
  border-radius: 32rpx;
  background: #2b6ff6;
  color: #fff;
  font-size: 28rpx;
}

.action.ghost {
  background: #eef3ff;
  color: #2b6ff6;
}

.action[disabled] {
  opacity: 0.55;
}
</style>
