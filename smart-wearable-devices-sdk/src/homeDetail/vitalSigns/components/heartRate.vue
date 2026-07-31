<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { baseOption } from '@/homeDetail/vitalSigns/echartOptions';
import {
  applyMetricSleepRangeAxisStyle,
  buildMetricSleepTimelineAxis,
  compactMetricTimelineTicks,
  getMetricTimelineTicks,
  normalizeTimelineLabel
} from '@/homeDetail/vitalSigns/metricSleepTimelineAxis';
import { useRingBLE } from '@/composables/useRingBLE';
import { useUserStore } from '@/stores/user';
import { submitData } from '@/common/api/homeDetail';
import type { heartRateDetail, Point, sleepSegment } from '@/types/api/homeDetail';
import { cloneDeep } from 'lodash-es';
import Action from '@/components/action.vue';
import { formatBleErrorMessage } from '@/utils/bleError';
import {
  formatMetricRecordTime,
  getLatestHeartRateReading,
  getLatestStressReading,
  getSubmitDeviceMac,
  requestMetricRefresh
} from '@/composables/useRingMetricReadings';
import { useRwForegroundMeasurement } from '@/composables/useRwForegroundMeasurement';
import {
  getRemainingVitalMeasurementMs,
  MIN_VITAL_MEASUREMENT_DURATION_MS,
  MAX_VITAL_MEASUREMENT_DURATION_MS
} from '@/utils/measurementDuration';
const { sendActiveMeasureCommand, refreshHealthData } = useRingBLE();
const { runRwForegroundMeasurement, stopActiveRwMeasurement } = useRwForegroundMeasurement();
const userStore = useUserStore();
const echarts = require('../../../static/echarts.min.js');
const chartRef = ref<any>(null);
const popup = ref<any>(null);
const measurePopup = ref<any>(null);

const agreementChecked = ref(false);
const props = defineProps({
  heartRateData: {
    type: Object as () => heartRateDetail,
    default: () => ({})
  },
  isHeartTate: {
    type: Boolean,
    default: true
  },
  sleepSegmentObj: {
    type: Object as () => sleepSegment,
    default: () => ({})
  }
});
// 添加watch监听props变化
watch(
  () => [props.heartRateData, props.sleepSegmentObj],
  async (newVal, oldVal) => {
    if (newVal !== oldVal) {
      // 当sleepDetailObj变化时，重新初始化图表
      await initChart();
    }
  },
  { deep: true }
);
const isIOS = computed(() => {
  const systemInfo = uni.getSystemInfoSync();
  return systemInfo.platform.toLowerCase().includes('ios');
});
const waitMeasurePopupClosed = () => new Promise<void>((resolve) => setTimeout(resolve, 80));
const showMeasureWaitingPopup = async () => {
  measurePopup.value?.close?.();
  await nextTick();
  await waitMeasurePopupClosed();
  popup.value?.open?.();
};
const metricAxisTicks = computed(() => {
  const chartData = Array.isArray(props.heartRateData?.chartData) ? props.heartRateData.chartData : [];
  return getMetricTimelineTicks(chartData, props.sleepSegmentObj, !props.isHeartTate);
});
const visibleMetricAxisTicks = computed(() => compactMetricTimelineTicks(metricAxisTicks.value, props.isHeartTate ? 5 : 6));
const metricChartKey = computed(() => {
  const chartData = Array.isArray(props.heartRateData?.chartData) ? props.heartRateData.chartData : [];
  const lastPoint = chartData[chartData.length - 1] as any;
  const tickKey = visibleMetricAxisTicks.value.map((item) => item.label).join('|');
  return `${props.isHeartTate ? 'heart' : 'sleep-heart'}-${chartData.length}-${lastPoint?.time || ''}-${lastPoint?.value || ''}-${tickKey}`;
});
const formatIntegerStat = (value: unknown, fallback = '00') => {
  const numeric = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? String(Math.round(numeric)) : fallback;
};
const getProcessedOption = () => {
  const newOption = cloneDeep(baseOption);
  const chartData = Array.isArray(props.heartRateData?.chartData) ? props.heartRateData.chartData : [];
  let fullXData: string[] = [];
  let fullSeriesData: (number | null)[] = [];
  if (chartData.length > 0) {
    // 有数据时使用实际数据
    fullXData = chartData.map((item: Point) => normalizeTimelineLabel(item.time));
    fullSeriesData = chartData.map((item: Point) => {
      const value = Number(item.value);
      // 将0值替换为null，让ECharts跳过这些点
      return value === 0 ? null : value;
    });
  } else {
    // 没有数据时仅保留默认时间刻度，不绘制样例折线。
    fullXData = Array.from({ length: 24 }, (_, i) => {
      const hour = i.toString().padStart(2, '0');
      return `${hour}:00`;
    });
  }
  const axisData = buildMetricSleepTimelineAxis(chartData, props.sleepSegmentObj, false);
  newOption.xAxis.data = fullXData;
  newOption.series[0].data = fullSeriesData as any;
  if (chartData.length > 0) {
    // 过滤掉null值，计算有效数据的最大值
    const validData = fullSeriesData.filter((value) => value !== null && !isNaN(value)) as number[];
    if (validData.length > 0) {
      const maxValue = Math.max(...validData);
      // 如果最大值超过100，则动态调整Y轴最大值
      if (maxValue > 100) {
        const yAxisConfigs = [
          { max: 120, splitNumber: 6 },
          { max: 140, splitNumber: 7 },
          { max: 160, splitNumber: 8 },
          { max: 180, splitNumber: 9 },
          { max: 200, splitNumber: 10 },
          { max: 220, splitNumber: 11 },
          { max: 240, splitNumber: 12 }
        ];
        const config = yAxisConfigs.find((cfg) => maxValue <= cfg.max);
        if (config) {
          newOption.yAxis.max = config.max;
          newOption.yAxis.splitNumber = config.splitNumber;
        } else {
          // 如果超过240，使用自动调整
          newOption.yAxis.max = Math.ceil(maxValue / 20) * 20; // 向上取整到最近的20的倍数
          newOption.yAxis.splitNumber = Math.ceil(newOption.yAxis.max / 20); // 每20一个刻度
        }
      }
    }
  }
  // 设置x轴
  newOption.xAxis.axisLabel = {
    ...newOption.xAxis.axisLabel,
    interval: 0,
    formatter: (value: string, index: number) => {
      const dataLength = newOption.xAxis.data.length;
      // 如果数据长度为24，则只显示指定刻度
      if (dataLength === 24) {
        return [0, 6, 12, 18, 23].includes(index) ? value : '';
      } else {
        // 数据长度不为24时，显示两端和部分中间刻度
        const firstIndex = 0;
        const lastIndex = dataLength - 1;

        // 总是显示第一个和最后一个刻度
        if (index === firstIndex || index === lastIndex) {
          return value;
        }
        // 根据数据长度决定中间显示几个刻度
        if (dataLength <= 5) {
          // 数据很少时，显示所有刻度
          return value;
        } else if (dataLength <= 10) {
          // 中等长度数据，显示中间1个刻度
          const midIndex = Math.floor(dataLength / 2);
          return index === midIndex ? value : '';
        } else {
          // 较长数据，显示中间2个刻度（四等分点）
          const midIndex = Math.floor(dataLength / 2);
          const quarter1 = Math.floor(dataLength / 4);
          const quarter3 = Math.floor((dataLength * 3) / 4);
          return index === quarter1 || index === quarter3 || index === midIndex ? value : '';
        }
      }
    }
  } as any;
  applyMetricSleepRangeAxisStyle(newOption, axisData);
  return newOption;
};
const initChart = async () => {
  if (!chartRef.value) return;
  try {
    const pie = await chartRef.value.init(echarts);
    pie.setOption(getProcessedOption());
  } catch {
    // 图表失败时保持页面可用，避免体验版输出原始运行时错误。
  }
};
const jumpDetail = () => {
  (uni as any).$uv.route('/homeDetail/vitalSignsHeartDetail/vitalSignsDetail', {
    heartRate: heartRate.value
  });
};

// 测量状态：'idle' | 'measuring' | 'completed'
const measureStatus = ref('idle');
const heartRate = ref(0);

// 动态文本（计算属性）
const measureText = computed(() => {
  if (!getSubmitDeviceMac(userStore, isIOS.value)) {
    return '未连接';
  }
  return '测量';
});
// 监听 userStore.receivedData 变化
watch(
  () => [userStore.receivedData, userStore.latestMetrics, userStore.healthData],
  (newData) => {
    if (measureStatus.value !== 'measuring') return;

    const latestReading = getLatestHeartRateReading(userStore, measureStartedAt);

    if (latestReading) {
      void completeMeasureWithLatestReading();
      return;
    }

    // 检查是否有已完成的测量（即使数据无效），由 measureStatus watch 中的 latest?.heartRate 判断跳过
    const hasCompletedMeasure = Array.isArray(userStore.receivedData) &&
      (userStore.receivedData as any[]).some((d) => d.type === 'active_measure' && d.heartbeatStatus !== 0x03);
    if (hasCompletedMeasure) {
      void completeMeasureWithLatestReading();
    }
  },
  { deep: true }
);
// 监听测量状态变化，在测量完成时调用接口
watch(
  () => measureStatus.value,
  async (newStatus, oldStatus) => {
    if (newStatus === 'completed' && oldStatus !== 'completed') {
      const latest: any = getLatestHeartRateReading(userStore, measureStartedAt);
      if (!latest?.heartRate) {
        measureStatus.value = 'idle';
        uni.showToast({ title: '设备未返回有效测量值', icon: 'none' });
        return;
      }

      const latestStress: any = getLatestStressReading(userStore, measureStartedAt);
      if (latest?.heartRate) {
        heartRate.value = latest.heartRate;
        uni.showToast({ title: '测量完成', icon: 'none' });
        // 调用提交数据的接口
        try {
          uni.showLoading({ title: '提交中...' });
          const recordTime = formatMetricRecordTime(latest.timestamp || Date.now());
          const stress = latestStress?.stressIndex ?? latestStress?.stress;
          const measurementRecord: { recordTime: string; heartRate: number; stress?: number } = {
            recordTime: recordTime,
            heartRate: latest.heartRate
          };
          if (stress !== undefined && stress !== null) {
            measurementRecord.stress = stress;
          }
          await submitData({
            deviceMac: getSubmitDeviceMac(userStore, isIOS.value),
            dataList: [measurementRecord]
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
let measureTimeout: any = null;
let measureCompleteTimer: any = null;
let isMeasureCompletePending = false;
let measureStartedAt = 0;
const measureChange = (e: any) => {};
const isRwDevice = () => userStore.deviceInfo?.protocol === 'rw';
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
  if (measureStatus.value === 'measuring') {
    await showMeasureWaitingPopup();
    return;
  }
  measurePopup.value?.close?.();
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

  await showMeasureWaitingPopup();
  startMeasureFallbackTimer();
  // 发送测量命令
  try {
    if (isRwDevice()) {
      await runRwForegroundMeasurement('heart_rate', {
        startedAt: measureStartedAt,
        timeoutMs: MAX_VITAL_MEASUREMENT_DURATION_MS,
        minActiveMs: MIN_VITAL_MEASUREMENT_DURATION_MS,
        measureStatus: () => measureStatus.value,
        source: 'RW VITAL'
      });
      await completeMeasureWithLatestReading();
      return;
    }
    await requestMetricRefresh(refreshHealthData, sendActiveMeasureCommand, { expectedSteps: 'heart_rate' });
    await completeMeasureWithLatestReading();
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
onLoad(async () => {});
onShow(async () => {
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
  if (chartRef.value && chartRef.value) {
    chartRef.value?.dispose();
  }
});
</script>
<template>
  <view class="score-card mb-30 r-50 bg-white p-30">
    <!-- 标题栏 -->
    <view class="flex jc-between ai-center">
      <view>
        <text class="fs-36">心率</text>
        <text v-if="!isHeartTate" class="fs-28">(次/分钟)</text>
        <slot></slot>
      </view>
      <view v-if="isHeartTate" class="textBox" @click.stop="handleMeasure">
<uv-image src="/static/images/homeDetail/love.png" width="45rpx" height="45rpx" mode="aspectFit"></uv-image>
        <text style="color: #ff5959">{{ measureText }}</text>
      </view>
    </view>
    <view @click="jumpDetail">
      <view style="width: 100%" v-if="isHeartTate">
        <view class="flex ai-center jc-center">
<uv-image src="/static/images/homeDetail/love.png" width="45rpx" height="45rpx" mode="aspectFit"></uv-image>
          <view class="ml-15">
            <text class="fs-48">{{ formatIntegerStat(heartRateData?.newValue) }}</text>
            <text class="t-979797 fs-24">次/分钟</text>
          </view>
        </view>
      </view>
      <view class="stats" v-if="!isHeartTate">
        <view class="stat-item">
          <view class="stat-value">{{ formatIntegerStat(heartRateData?.avgValue) }}</view>
          <view class="stat-label">平均心率</view>
        </view>
        <view class="stat-item">
          <view class="stat-value">{{ formatIntegerStat(heartRateData?.maxValue) }}</view>
          <view class="stat-label">最大心率</view>
        </view>
      </view>
      <view class="metric-chart-wrap">
        <view class="metric-echart-box flex ai-center jc-center">
          <l-echart :key="metricChartKey" ref="chartRef" @finished="initChart" style="width: 100%; height: 320rpx; margin: 0"></l-echart>
        </view>
        <view v-if="visibleMetricAxisTicks.length" class="metric-time-axis">
          <text
            v-for="tick in visibleMetricAxisTicks"
            :key="tick.key"
            class="metric-time-tick"
          >{{ tick.label }}</text>
        </view>
      </view>

      <!-- 统计信息 -->
      <view class="stats" v-if="isHeartTate">
        <view class="stat-item">
          <view class="stat-value">{{ formatIntegerStat(heartRateData?.avgValue) }}</view>
          <view class="stat-label">平均心率</view>
        </view>
        <view class="stat-item">
          <view class="stat-value">{{ formatIntegerStat(heartRateData?.maxValue) }}</view>
          <view class="stat-label">最大心率</view>
        </view>
      </view>
    </view>
    <uv-popup ref="popup" mode="center" round="10rpx" :overlay="true" :closeOnClickOverlay="false" :safeAreaInsetBottom="false">
      <view class="p-30 flex fd-c ai-center" style="background: #030305e6">
        <!-- 添加heartbeat-animation类名 -->
        <view class="heartbeat-animation">
<uv-image src="/static/images/homeDetail/love.png" width="45rpx" height="45rpx" mode="aspectFit"></uv-image>
        </view>
        <view class="ml-20 t-white">测量中...</view>
      </view>
    </uv-popup>
    <uv-popup round="20" ref="measurePopup" mode="center" @change="measureChange">
      <Action :agreementChecked="agreementChecked" @update:agreementChecked="agreementChecked = $event" @confirm="startMeasure" @close="measurePopup?.close()" />
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
  background-color: #ffeeee;
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

.metric-chart-wrap {
  width: 100%;
  position: relative;
  height: 360rpx;
}

.metric-echart-box {
  width: 100%;
  height: 320rpx;
}

.metric-time-axis {
  position: absolute;
  left: 28rpx;
  right: 28rpx;
  bottom: 8rpx;
  display: flex;
  justify-content: space-between;
  color: #9ca3af;
  font-size: 20rpx;
  line-height: 1;
}

.metric-time-tick {
  white-space: nowrap;
}
</style>
