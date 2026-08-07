<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onLoad, onPageScroll, onShow, onUnload } from '@dcloudio/uni-app';
import { baseOption } from '@/homeDetail/vitalSigns/echartOptions';
import { useRingBLE } from '@/composables/useRingBLE';
import { useUserStore } from '@/stores/user';
import type { heartRateDetail, Point } from '@/types/api/homeDetail';
import { submitData } from '@/common/api/homeDetail';
import Action from '@/components/action.vue';
import { formatBleErrorMessage } from '@/utils/bleError';
import { formatMetricRecordTime, getLatestTemperatureReading, getSubmitDeviceMac, requestMetricRefresh } from '@/composables/useRingMetricReadings';
import { useRwForegroundMeasurement } from '@/composables/useRwForegroundMeasurement';
import { resolveRingProtocol } from '@/sdk/ring-ble';
import {
  getRemainingVitalMeasurementMs,
  MIN_VITAL_MEASUREMENT_DURATION_MS,
  MAX_VITAL_MEASUREMENT_DURATION_MS
} from '@/utils/measurementDuration';
const userStore = useUserStore();
const { sendBodyTemperatureCommand, refreshHealthData } = useRingBLE();
const { runRwForegroundMeasurement, stopActiveRwMeasurement } = useRwForegroundMeasurement();
const echarts = require('../../../static/echarts.min.js');
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

let measureTimeout: any = null;
let measureCompleteTimer: any = null;
let isMeasureCompletePending = false;
let measureStartedAt = 0;
const isRwDevice = () => resolveRingProtocol(userStore.deviceInfo as any) === 'rw';
const clearMeasureCompleteTimer = () => {
  if (!measureCompleteTimer) return;
  clearTimeout(measureCompleteTimer);
  measureCompleteTimer = null;
};
const startMeasureFallbackTimer = () => {
  if (measureTimeout) {
    clearTimeout(measureTimeout);
  }
  measureTimeout = setTimeout(() => {
    if (measureStatus.value === 'measuring') {
      void completeMeasureWithLatestReading();
    }
    measureTimeout = null;
  }, MAX_VITAL_MEASUREMENT_DURATION_MS);
};
const completeMeasureWithLatestReading = async () => {
  if (measureStatus.value !== 'measuring' || isMeasureCompletePending) return;
  const remainingMs = getRemainingVitalMeasurementMs(measureStartedAt);
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
  if (measureTimeout) {
    clearTimeout(measureTimeout);
    measureTimeout = null;
  }
  clearMeasureCompleteTimer();
  popup.value?.close();
  if (isRwDevice()) {
    await stopActiveRwMeasurement('RW VITAL');
  }
  measureStatus.value = 'completed';
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
    uni.showToast({ title: '请先连接设备', icon: 'none' });
    (uni as any).$uv.route('/pagesA/mines/connectDevice');
    return;
  }

  // 清除可能残留的旧定时器
  if (measureTimeout) {
    clearTimeout(measureTimeout);
  }
  clearMeasureCompleteTimer();
  isMeasureCompletePending = false;

  measureStatus.value = 'measuring';
  measureStartedAt = Date.now();
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
    if (measureStatus.value !== 'measuring') return;
    popup.value?.close();
    if (isRwDevice()) {
      await stopActiveRwMeasurement('RW VITAL');
    }
    measureStatus.value = 'idle';
    measureStartedAt = 0;
    uni.showToast({ title: formatBleErrorMessage(error, '测量指令发送失败'), icon: 'none' });
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

    const latestReading = getLatestTemperatureReading(userStore, measureStartedAt);
    // 如果完成测量, 则更新温度
    const hasCompletedStatus = (userStore.receivedData || []).some((d) => d.type === 'active_Temperature' && d.temperatureStatus === 0x01);
    if (latestReading) {
      // 关闭测量定时器
      void completeMeasureWithLatestReading();
      return;
    }
    if (hasCompletedStatus) {
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
      const latest: any = getLatestTemperatureReading(userStore, measureStartedAt);
      if (!latest?.temperature) {
        measureStatus.value = 'idle';
        uni.showToast({ title: '设备未返回有效测量值', icon: 'none' });
        return;
      }

      if (latest?.temperature) {
        temperature.value = latest.temperature;
        uni.showToast({ title: '测量完成', icon: 'none' });
        // 调用提交数据的接口
        try {
          uni.showLoading({ title: '提交中...' });
          const recordTime = formatMetricRecordTime(latest.timestamp || Date.now());
          await submitData({
            deviceMac: getSubmitDeviceMac(userStore, isIOS.value),
            dataList: [
              {
                recordTime: recordTime,
                temperature: latest.temperature
              }
            ]
          });
          uni.hideLoading();
          jumpDetail();
        } catch (error) {
          uni.hideLoading();
          uni.showToast({ title: '数据提交失败', icon: 'none' });
        }
      }
    }
  },
  { immediate: false }
);
// 动态文本（计算属性）
const measureText = computed(() => {
  if (!getSubmitDeviceMac(userStore, isIOS.value)) {
    return '未连接';
  }
  // if (measureStatus.value === 'completed') {
  //   const latest: any = userStore.receivedData.filter((d) => d.type === 'active_Temperature').sort((a, b) => b.timestamp - a.timestamp)[0];
  //   if (latest?.temperature !== null && latest?.temperature !== undefined) {
  //     temperature.value = latest.temperature;
  //     uni.showToast({ title: '测量完成', icon: 'none' });
  //     jumpDetail();
  //   }
  // }
  return '测量';
});
onLoad(() => {});
onShow(async () => {
  // 防止测量完成后返回到该页时，measureText重复跳转
  clearMeasureCompleteTimer();
  isMeasureCompletePending = false;
  measureStatus.value = 'idle';
});
onUnload(() => {
  if (measureTimeout) {
    clearTimeout(measureTimeout);
  }
  clearMeasureCompleteTimer();
  isMeasureCompletePending = false;
  void stopActiveRwMeasurement('RW VITAL');
});
</script>

<template>
  <view class="bg-white r-50 mb-30 p-30">
    <view class="flex jc-between ai-center">
      <view class="fs-36">皮肤温度(℃)<slot></slot></view>
      <view v-if="isHeartTate" class="textBox r-30 p-20 flex jc-between" @tap="handleMeasure">
        <uv-image src="/static/images/homeDetail/Temperature.png" width="40rpx" height="40rpx"></uv-image>
        <text style="color: #69ca8d">{{ measureText }}</text>
      </view>
    </view>
    <view @click="jumpDetail">
      <view class="flex jc-between mt-50 p-50">
        <view class="fd-c jc-around ai-center">
          <view class="ta-c fs-48">{{ formatTemperatureStat(temperatureData?.avgValue) }}</view>
          <view class="ta-c t-979797 fs-24">平均</view>
        </view>
        <view>
          <!-- 测量数据  -->
          <!-- <view class="ta-c fs-48">{{ temperature || '00' }}</view> -->
          <!-- 接口数据 -->
          <view class="ta-c fs-48">{{ formatTemperatureStat(temperatureData.baseValue) }}</view>
          <view class="ta-c t-979797 fs-24">基准温度</view>
        </view>
        <view>
          <!-- <view class="ta-c fs-48">{{ temperatureDiff }}</view> -->
          <view class="ta-c fs-48">{{ formatTemperatureStat(temperatureData?.diffValue, '0.0°C') }}</view>
          <view class="ta-c t-979797 fs-24">温度差</view>
        </view>
      </view>
    </view>
    <uv-popup ref="popup" mode="center" round="10rpx" :overlay="true" :closeOnClickOverlay="false" :safeAreaInsetBottom="false">
      <view class="p-30 flex fd-c ai-center" style="background: #030305e6">
        <!-- 添加heartbeat-animation类名 -->
        <view class="heartbeat-animation">
          <uv-image src="/static/images/homeDetail/Temperature.png" width="45rpx" height="45rpx"></uv-image>
        </view>
        <view class="ml-20 t-white">测量中...</view>
      </view>
    </uv-popup>
    <uv-popup round="20" ref="measurePopup" mode="center">
      <Action
        title="皮肤温度测量提示"
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
