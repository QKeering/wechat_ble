<script setup lang="ts">
import '@/homeDetail/i18n/pack';
import { useI18n } from '@/i18n';
import { ref, computed, watch } from 'vue';
import { onLoad, onPageScroll, onShow, onUnload } from '@dcloudio/uni-app';
import { baseOption } from '@/homeDetail/vitalSigns/echartOptions';
import { useRingBLE } from '@/composables/useRingBLE';
import { useUserStore } from '@/stores/user';
import type { heartRateDetail, Point } from '@/types/api/homeDetail';
import { submitData } from '@/common/api/homeDetail';
import Action from '@/components/action.vue';
import { formatBleErrorMessage } from '@/utils/bleError';
import { notifyMeasurementSubmitted } from '@/utils/healthMetricsRefresh';
import { formatMetricRecordTime, getLatestTemperatureReading, getSubmitDeviceMac, requestMetricRefresh } from '@/composables/useRingMetricReadings';
import { useRwForegroundMeasurement } from '@/composables/useRwForegroundMeasurement';
import { resolveRingProtocol } from '@/sdk/ring-ble';
import {
  getRemainingVitalMeasurementMs,
  MIN_VITAL_MEASUREMENT_DURATION_MS,
  MAX_VITAL_MEASUREMENT_DURATION_MS
} from '@/utils/measurementDuration';
import {
  ensureRingWornBeforeMeasurement,
  getRingMeasurementRecords,
  resolveRingWearState,
  showRingWearGuidance,
  type RingWearState
} from '@/utils/ringWearGate';

const { t } = useI18n();
const userStore = useUserStore();
const {
  sendBodyTemperatureCommand,
  refreshHealthData,
  queryCurrentWearState,
  isVitalMeasurementLocked,
  vitalMeasurementLockKind,
  acquireVitalMeasurementLock,
  releaseVitalMeasurementLock,
  completeVitalMeasurement,
  syncVitalMeasurementLockWithLegacyBusy
} = useRingBLE();
const { runRwForegroundMeasurement, stopActiveRwMeasurement } = useRwForegroundMeasurement();
import echarts from '@/utils/echarts';
const props = defineProps({
  temperatureData: {
    type: Object as () => heartRateDetail,
    default: () => ({})
  },
  isHeartTate: {
    type: Boolean,
    default: true
  }
});
const popup = ref<any>(null);
const measurePopup = ref<any>(null);
const chartRef = ref(null);
const temperature = ref<number>(0);
const agreementChecked = ref(false);
// 测量状态：'idle' | 'measuring' | 'completed'
const measureStatus = ref('idle');
let vitalMeasurementLockToken = '';

let measureTimeout: any = null;
let measureCompleteTimer: any = null;
let isMeasureCompletePending = false;
let isMeasurementFinalizing = false;
let measureStartedAt = 0;
let measurementDeadlineAt = 0;
let completedMeasurementReading: any = null;
let wearGatePending = false;
let wearConfirmedForRun = false;
const isRwDevice = () => resolveRingProtocol(userStore.deviceInfo as any) === 'rw';
const showVitalMeasurementBusy = () => uni.showToast({ title: t('设备正在测量，请稍候'), icon: 'none' });
const settleOwnVitalMeasurementLock = (reason: string) => {
  if (!vitalMeasurementLockToken) return;
  if (!isRwDevice() && syncVitalMeasurementLockWithLegacyBusy(vitalMeasurementLockToken) > 0) return;
  releaseVitalMeasurementLock(vitalMeasurementLockToken, reason);
  vitalMeasurementLockToken = '';
};
const completeOwnVitalMeasurement = () => {
  if (!vitalMeasurementLockToken) return;
  completeVitalMeasurement(vitalMeasurementLockToken);
  vitalMeasurementLockToken = '';
};
// 与其他生命体征保持一致：完整采集窗口结束后再使用最后一个合法值完成测量。
const getMeasurementMinimumDurationMs = () => MIN_VITAL_MEASUREMENT_DURATION_MS;
const getCurrentTemperatureWearState = () => {
  const state = resolveRingWearState(getRingMeasurementRecords(userStore.receivedData || [], measureStartedAt));
  if (state === 'not_worn' || state === 'charging') return state;
  return state === 'worn' || wearConfirmedForRun ? 'worn' : state;
};
const clearMeasureCompleteTimer = () => {
  if (!measureCompleteTimer) return;
  clearTimeout(measureCompleteTimer);
  measureCompleteTimer = null;
};
const stopMeasureForWearGate = async (wearState: Exclude<RingWearState, 'unknown' | 'worn'> | 'no_data') => {
  if (measureStatus.value !== 'measuring' || wearGatePending) return;
  wearGatePending = true;
  if (measureTimeout) {
    clearTimeout(measureTimeout);
    measureTimeout = null;
  }
  clearMeasureCompleteTimer();
  isMeasureCompletePending = false;
  isMeasurementFinalizing = false;
  popup.value?.close?.();
  measureStatus.value = 'idle';
  measureStartedAt = 0;
  measurementDeadlineAt = 0;
  wearConfirmedForRun = false;
  if (isRwDevice()) {
    await stopActiveRwMeasurement('RW VITAL').catch(() => undefined);
  }
  settleOwnVitalMeasurementLock('wear-gate-blocked');
  showRingWearGuidance(wearState);
  wearGatePending = false;
};
const startMeasureFallbackTimer = () => {
  if (measureTimeout) {
    clearTimeout(measureTimeout);
  }
  const remainingMs = Math.max(0, measurementDeadlineAt - Date.now());
  if (remainingMs <= 0) {
    void completeMeasureWithLatestReading(true);
    return;
  }
  measureTimeout = setTimeout(() => {
    measureTimeout = null;
    if (measureStatus.value === 'measuring') {
      void completeMeasureWithLatestReading(true);
    }
  }, remainingMs);
};
const completeMeasureWithLatestReading = async (forceDeadline = false) => {
  if (measureStatus.value !== 'measuring' || isMeasurementFinalizing || (!forceDeadline && isMeasureCompletePending)) return;
  const wearState = getCurrentTemperatureWearState();
  if (wearState === 'not_worn' || wearState === 'charging') {
    await stopMeasureForWearGate(wearState);
    return;
  }
  if (wearState !== 'worn' && !forceDeadline) {
    if (Date.now() >= measurementDeadlineAt - 250) {
      await stopMeasureForWearGate('no_data');
    }
    return;
  }
  const latestReading = getLatestTemperatureReading(userStore, measureStartedAt);
  if (!latestReading) {
    if (forceDeadline || Date.now() >= measurementDeadlineAt - 250) {
      await stopMeasureForWearGate('no_data');
    }
    return;
  }
  const remainingMs = forceDeadline ? 0 : getRemainingVitalMeasurementMs(measureStartedAt, getMeasurementMinimumDurationMs());
  if (remainingMs > 0) {
    isMeasureCompletePending = true;
    clearMeasureCompleteTimer();
    measureCompleteTimer = setTimeout(() => {
      measureCompleteTimer = null;
      isMeasureCompletePending = false;
      void completeMeasureWithLatestReading();
    }, remainingMs);
    return;
  }
  isMeasurementFinalizing = true;
  if (measureTimeout) {
    clearTimeout(measureTimeout);
    measureTimeout = null;
  }
  clearMeasureCompleteTimer();
  measurementDeadlineAt = 0;
  completedMeasurementReading = { ...latestReading };
  popup.value?.close();
  if (isRwDevice()) {
    await stopActiveRwMeasurement('RW VITAL').catch(() => undefined);
  }
  completeOwnVitalMeasurement();
  measureStatus.value = 'completed';
};
const cancelMeasurement = async () => {
  if (measureTimeout) {
    clearTimeout(measureTimeout);
    measureTimeout = null;
  }
  clearMeasureCompleteTimer();
  isMeasureCompletePending = false;
  isMeasurementFinalizing = false;
  popup.value?.close?.();
  if (measureStatus.value !== 'measuring') return;
  measureStatus.value = 'idle';
  measureStartedAt = 0;
  measurementDeadlineAt = 0;
  wearConfirmedForRun = false;
  if (isRwDevice()) await stopActiveRwMeasurement('RW VITAL').catch(() => undefined);
  settleOwnVitalMeasurementLock('user-cancelled');
  uni.showToast({ title: t('已结束测量'), icon: 'none' });
};
// 是否为iOS的计算属性
const isIOS = computed(() => {
  const systemInfo = uni.getSystemInfoSync();
  return systemInfo.platform.toLowerCase().includes('ios');
});
const formatTemperatureStat = (value: unknown, fallback = '00') => {
  const numeric = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return `${numeric.toFixed(1)}°C`;
};
// 开始测量
const handleMeasure = () => {
  if (isVitalMeasurementLocked.value) {
    if (measureStatus.value === 'measuring' && vitalMeasurementLockKind.value === 'temperature') {
      popup.value?.open?.();
    } else {
      showVitalMeasurementBusy();
    }
    return;
  }
  // 如果勾选了不再提示，直接开始测量
  if (agreementChecked.value) {
    startMeasure();
  } else {
    // 否则显示提示弹窗
    measurePopup.value.open();
  }
};
const startMeasure = async () => {
  measurePopup.value.close();
  if (!getSubmitDeviceMac(userStore, isIOS.value)) {
    uni.showToast({ title: t('请先连接设备'), icon: 'none' });
    (uni as any).$uv.route('/pagesA/mines/connectDevice');
    return;
  }
  const acquiredLockToken = acquireVitalMeasurementLock('temperature');
  if (!acquiredLockToken) {
    showVitalMeasurementBusy();
    return;
  }
  vitalMeasurementLockToken = acquiredLockToken;

  if (!(await ensureRingWornBeforeMeasurement(() => queryCurrentWearState('temperature')))) {
    settleOwnVitalMeasurementLock('wear-preflight-blocked');
    return;
  }
  if (!isRwDevice()) syncVitalMeasurementLockWithLegacyBusy(vitalMeasurementLockToken);
  wearConfirmedForRun = true;

  // 清除可能残留的旧定时器
  if (measureTimeout) {
    clearTimeout(measureTimeout);
  }
  clearMeasureCompleteTimer();
  isMeasureCompletePending = false;
  isMeasurementFinalizing = false;
  wearGatePending = false;

  measureStatus.value = 'measuring';
  measureStartedAt = Date.now();
  measurementDeadlineAt = measureStartedAt + MAX_VITAL_MEASUREMENT_DURATION_MS;
  completedMeasurementReading = null;
  // uni.showLoading({
  //   title: '测量中...',
  //   mask: true
  // });
  popup.value.open();
  startMeasureFallbackTimer();
  // 发送测量命令
  try {
    if (isRwDevice()) {
      await runRwForegroundMeasurement('temperature', {
        startedAt: measureStartedAt,
        timeoutMs: MAX_VITAL_MEASUREMENT_DURATION_MS,
        minActiveMs: MIN_VITAL_MEASUREMENT_DURATION_MS,
        measureStatus: () => measureStatus.value,
        source: 'RW VITAL'
      });
      await completeMeasureWithLatestReading();
      return;
    }
    await requestMetricRefresh(refreshHealthData, sendBodyTemperatureCommand, {
      expectedSteps: 'temperature',
      timeoutMs: MAX_VITAL_MEASUREMENT_DURATION_MS
    });
  } catch (error) {
    if (measureStatus.value !== 'measuring' || isMeasurementFinalizing) return;
    popup.value?.close();
    if (isRwDevice()) {
      await stopActiveRwMeasurement('RW VITAL');
    }
    settleOwnVitalMeasurementLock('command-failed');
    measureStatus.value = 'idle';
    measureStartedAt = 0;
    measurementDeadlineAt = 0;
    wearConfirmedForRun = false;
    uni.showToast({ title: t(formatBleErrorMessage(error, '测量指令发送失败')), icon: 'none' });
    return;
  }

  if (!measureTimeout && measureStatus.value === 'measuring') {
    startMeasureFallbackTimer();
  }
};
// 监听 userStore.receivedData 变化, 提前测量完温度,更新温度
watch(
  () => [userStore.receivedData, userStore.latestMetrics, userStore.healthData],
  (newData) => {
    if (measureStatus.value !== 'measuring') return;

    const currentMeasurementRecords = getRingMeasurementRecords(userStore.receivedData || [], measureStartedAt);
    const wearState = resolveRingWearState(currentMeasurementRecords);
    if (wearState === 'not_worn' || wearState === 'charging') {
      void stopMeasureForWearGate(wearState);
      return;
    }

    const latestReading = getLatestTemperatureReading(userStore, measureStartedAt);
    // 如果完成测量, 则更新温度
    const hasCompletedStatus = currentMeasurementRecords.some(
      (d: any) => d.type === 'active_Temperature' && d.temperatureStatus === 0x01
    );
    if (wearState === 'worn' && latestReading) {
      // 关闭测量定时器
      void completeMeasureWithLatestReading();
      return;
    }
    if (wearState === 'worn' && hasCompletedStatus) {
      // 关闭测量定时器
      // uni.hideLoading();
      void completeMeasureWithLatestReading();
    }
  },
  { deep: true }
);
const jumpDetail = () => {
  // uni.$uv.route('/homeDetail/vitalSignsHeartDetail/temperatureDetail');
  (uni as any).$uv.route('/homeDetail/vitalSignsHeartDetail/temperatureDetail', {
    temperature: temperature.value
  });
};
watch(
  () => measureStatus.value,
  async (newStatus, oldStatus) => {
    if (newStatus === 'completed' && oldStatus !== 'completed') {
      const latest: any = completedMeasurementReading;
      if (!latest?.temperature) {
        measureStatus.value = 'idle';
        showRingWearGuidance('no_data');
        return;
      }

      if (latest?.temperature) {
        temperature.value = latest.temperature;
        uni.showToast({ title: t('测量完成'), icon: 'none' });
        // 调用提交数据的接口
        try {
          uni.showLoading({ title: t('提交中...') });
          const recordTime = formatMetricRecordTime(latest.timestamp || Date.now());
          const submitDeviceMac = getSubmitDeviceMac(userStore, isIOS.value);
          await submitData({
            deviceMac: submitDeviceMac,
            dataList: [
              {
                recordTime: recordTime,
                temperature: latest.temperature
              }
            ]
          });
          notifyMeasurementSubmitted({
            deviceMac: submitDeviceMac,
            recordTime,
            metric: 'temperature'
          });
          uni.hideLoading();
          jumpDetail();
        } catch (error) {
          uni.hideLoading();
          uni.showToast({ title: t('数据提交失败'), icon: 'none' });
        }
      }
    }
  },
  { immediate: false }
);
// 动态文本（计算属性）
const measureText = computed(() => {
  if (!getSubmitDeviceMac(userStore, isIOS.value)) {
    return t('未连接');
  }
  // legacy 数值返回后的共享锁仅用于保护固件命令通道，不能显示为仍在测量。
  if (measureStatus.value === 'measuring') return t('皮肤温度测量中');
  // if (measureStatus.value === 'completed') {
  //   const latest: any = userStore.receivedData.filter((d) => d.type === 'active_Temperature').sort((a, b) => b.timestamp - a.timestamp)[0];
  //   if (latest?.temperature !== null && latest?.temperature !== undefined) {
  //     temperature.value = latest.temperature;
  //     uni.showToast({ title: t('测量完成'), icon: 'none' });
  //     jumpDetail();
  //   }
  // }
  return t('测量');
});
onLoad(() => {});
onShow(async () => {
  // 测量中切到后台再回来时不能把状态重置成 idle：后台那轮测量还在跑。
  if (measureStatus.value === 'measuring') return;
  // 防止测量完成后返回到该页时，measureText重复跳转
  clearMeasureCompleteTimer();
  isMeasureCompletePending = false;
  isMeasurementFinalizing = false;
  wearGatePending = false;
  wearConfirmedForRun = false;
  measureStatus.value = 'idle';
  measureStartedAt = 0;
  measurementDeadlineAt = 0;
  popup.value?.close?.();
});
onUnload(() => {
  if (measureTimeout) {
    clearTimeout(measureTimeout);
  }
  clearMeasureCompleteTimer();
  isMeasureCompletePending = false;
  void stopActiveRwMeasurement('RW VITAL');
  if (isRwDevice()) settleOwnVitalMeasurementLock('page-unload');
});
</script>

<template>
  <view class="bg-white r-50 mb-30 p-30">
    <view class="flex jc-between ai-center">
      <view class="fs-36">{{ t('皮肤温度(℃)') }}<slot></slot></view>
      <view v-if="isHeartTate" class="textBox r-30 p-20 flex jc-between" :class="{ 'is-measure-locked': isVitalMeasurementLocked }" @tap="handleMeasure">
        <uv-image src="/static/images/homeDetail/Temperature.png" width="40rpx" height="40rpx"></uv-image>
        <text style="color: #69ca8d">{{ measureText }}</text>
      </view>
    </view>
    <view @click="jumpDetail">
      <view class="flex jc-between mt-50 p-50">
        <view class="fd-c jc-around ai-center">
          <view class="ta-c fs-48">{{ formatTemperatureStat(temperatureData?.avgValue) }}</view>
          <view class="ta-c t-979797 fs-24">{{ t('平均') }}</view>
        </view>
        <view>
          <!-- 测量数据  -->
          <!-- <view class="ta-c fs-48">{{ temperature || '00' }}</view> -->
          <!-- 接口数据 -->
          <view class="ta-c fs-48">{{ formatTemperatureStat(temperatureData.baseValue) }}</view>
          <view class="ta-c t-979797 fs-24">{{ t('基准温度') }}</view>
        </view>
        <view>
          <!-- <view class="ta-c fs-48">{{ temperatureDiff }}</view> -->
          <view class="ta-c fs-48">{{ formatTemperatureStat(temperatureData?.diffValue, '0.0°C') }}</view>
          <view class="ta-c t-979797 fs-24">{{ t('温度差') }}</view>
        </view>
      </view>
    </view>
    <uv-popup ref="popup" mode="center" round="10rpx" :overlay="true" :closeOnClickOverlay="false" :safeAreaInsetBottom="false">
      <view class="p-30 flex fd-c ai-center" style="background: #030305e6">
        <!-- 添加heartbeat-animation类名 -->
        <view class="heartbeat-animation">
          <uv-image src="/static/images/homeDetail/Temperature.png" width="45rpx" height="45rpx"></uv-image>
        </view>
        <view class="ml-20 t-white">{{ t('皮肤温度测量中...') }}</view>
        <view class="measurement-exit" @tap.stop="cancelMeasurement">{{ t('结束测量') }}</view>
      </view>
    </uv-popup>
    <uv-popup round="20" ref="measurePopup" mode="center">
      <Action
        :title="t('皮肤温度测量提示')"
        :agreementChecked="agreementChecked"
        @update:agreementChecked="agreementChecked = $event"
        @confirm="startMeasure"
        @close="measurePopup?.close()"
      />
    </uv-popup>
  </view>
</template>

<style lang="scss" scoped>
.heartbeat-animation {
  animation: heartbeat 1.5s ease-in-out infinite;
}
.is-measure-locked {
  opacity: 0.55;
}
.measurement-exit {
  margin-top: 24rpx;
  padding: 10rpx 28rpx;
  border: 1rpx solid rgba(255, 255, 255, 0.65);
  border-radius: 28rpx;
  color: #fff;
  font-size: 24rpx;
}

@keyframes heartbeat {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10rpx); /* 上下移动10rpx */
  }
}
.score-card {
  margin-top: 30rpx;
  border-radius: 50rpx;
  background-color: #fff;
  padding: 30rpx;
  box-sizing: border-box;
}

.textBox {
  background-color: #f0faf4;
  border-radius: 30rpx;
  padding: 20rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
}

.stats {
  display: flex;
  justify-content: space-around;
  align-items: center;
  margin-top: 36rpx;
  padding-top: 24rpx;
}

.stat-item {
  text-align: center;
}

.stat-value {
  font-size: 36rpx;
  font-weight: 600;
  color: #333;
  line-height: 1.2;
}

.stat-label {
  font-size: 24rpx;
  color: #999;
  margin-top: 8rpx;
}
</style>
