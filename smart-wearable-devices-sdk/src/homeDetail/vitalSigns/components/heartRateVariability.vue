<script setup lang="ts">
import '@/homeDetail/i18n/pack';
import { useI18n } from '@/i18n';
import { ref, computed, watch, nextTick } from 'vue';
import { onLoad, onPageScroll, onShow, onUnload } from '@dcloudio/uni-app';
import { applyVitalSignsLineStyle, baseOption } from '@/homeDetail/vitalSigns/echartOptions';
import MetricYAxisLabels from './MetricYAxisLabels.vue';
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
import { notifyMeasurementSubmitted } from '@/utils/healthMetricsRefresh';
import { formatMetricRecordTime, getLatestHrvReading, getSubmitDeviceMac, requestMetricRefresh } from '@/composables/useRingMetricReadings';
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
  sendActiveMeasureCommand,
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
  hrvData: {
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
const popup1 = ref<any>(null);
const chartRef = ref<any>(null);
const measurePopup = ref<any>(null);
const heartRateVariability = ref(0);
const agreementChecked = ref(false);
// 测量状态：'idle' | 'measuring' | 'completed'
const measureStatus = ref('idle');
let vitalMeasurementLockToken = '';
watch(
  () => [props.hrvData, props.sleepSegmentObj],
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
  popup1.value?.open?.();
};
const metricAxisTicks = computed(() => {
  const chartData = Array.isArray(props.hrvData?.chartData) ? props.hrvData.chartData : [];
  return getMetricTimelineTicks(
    chartData,
    props.sleepSegmentObj,
    !props.isHeartTate,
    props.isHeartTate ? props.hrvData?.axisEndTime : undefined
  );
});
const visibleMetricAxisTicks = computed(() => compactMetricTimelineTicks(metricAxisTicks.value, props.isHeartTate ? 5 : 6));
const metricChartKey = computed(() => {
  const chartData = Array.isArray(props.hrvData?.chartData) ? props.hrvData.chartData : [];
  const lastPoint = chartData[chartData.length - 1] as any;
  const tickKey = visibleMetricAxisTicks.value.map((item) => item.label).join('|');
  return `${props.isHeartTate ? 'hrv' : 'sleep-hrv'}-${chartData.length}-${lastPoint?.time || ''}-${lastPoint?.value || ''}-${tickKey}`;
});
const formatIntegerStat = (value: unknown, fallback = '00') => {
  const numeric = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? String(Math.round(numeric)) : fallback;
};
const formatIntegerRangeStat = (value: unknown, fallback = '00') => {
  const parts = String(value ?? '')
    .split('-')
    .map((item) => formatIntegerStat(item, ''));
  const validParts = parts.filter(Boolean);
  return validParts.length === 2 ? `${validParts[0]}-${validParts[1]}` : formatIntegerStat(value, fallback);
};
const hrvDisplayMode = computed(() => props.hrvData?.displayMode || 'real');
const isHrvProxy = computed(() => hrvDisplayMode.value === 'proxy');
const isHrvEmpty = computed(() => hrvDisplayMode.value === 'empty');
const hasHrvMetric = computed(() => {
  const values = [
    props.hrvData?.newValue,
    props.hrvData?.avgValue,
    props.hrvData?.maxValue,
    props.hrvData?.proxyMs,
    ...(Array.isArray(props.hrvData?.chartData) ? props.hrvData.chartData.map((item: Point) => item?.value) : [])
  ];
  return values.some((value) => {
    const numeric = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(numeric) && numeric > 0 && numeric <= 300;
  });
});
const showHrvMetric = computed(() => !isHrvEmpty.value && hasHrvMetric.value);
const hrvFallbackStatus = computed(() => {
  if (isHrvProxy.value) return props.hrvData?.statusText || '趋势参考';
  return props.hrvData?.statusText || '暂无数据';
});
const hrvFallbackTips = computed(() => {
  if (props.hrvData?.tips) return props.hrvData.tips;
  return isHrvProxy.value ? '基于心率趋势估算，仅供参考' : '数据不足，暂无法估算';
});
const hrvYAxisMax = computed(() => {
  const values = (Array.isArray(props.hrvData?.chartData) ? props.hrvData.chartData : [])
    .map((item: Point) => Number(item?.value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const maxValue = values.length ? Math.max(...values) : 0;
  return maxValue > 120 ? Math.ceil(maxValue / 20) * 20 : 120;
});
const hrvYAxisSplitNumber = computed(() => Math.max(6, Math.ceil(hrvYAxisMax.value / 20)));
const getProcessedOption = () => {
  const newOption = cloneDeep(baseOption);
  const chartData = Array.isArray(props.hrvData?.chartData) ? props.hrvData.chartData : [];
  const axisData = buildMetricSleepTimelineAxis(
    chartData,
    props.sleepSegmentObj,
    !props.isHeartTate,
    props.isHeartTate ? props.hrvData?.axisEndTime : undefined
  );
  let fullXData: string[] = [];
  let fullSeriesData: (number | null)[] = [];
  if (props.isHeartTate) {
    fullXData = axisData.xData;
    fullSeriesData = axisData.seriesData;
  } else if (chartData.length > 0) {
    // 有数据时使用实际数据
    fullXData = chartData.map((item: Point) => normalizeTimelineLabel(item.time));
    // fullSeriesData = props.hrvData?.chartData?.map((item: Point) => Number(item.value)) || [];
    fullSeriesData =
      chartData.map((item: Point) => {
        const value = Number(item.value);
        // 将0值替换为null，让ECharts跳过这些点
        return value === 0 ? null : value;
      }) || [];
  } else {
    // 没有数据时生成24小时的默认数据
    fullXData = Array.from({ length: 24 }, (_, i) => {
      const hour = i.toString().padStart(2, '0');
      return `${hour}:00`;
    });
  }
  // 替换xAxis.data和series.data为完整数据
  // 波形仍使用接口原始点位；睡眠区间只用于外置时间轴标签，避免重采样导致折线消失。
  newOption.xAxis.data = fullXData;
  newOption.series[0].data = fullSeriesData as any;
  // 超过100，则y轴最大刻度显示120，6个刻度
  if (props.hrvData?.chartData && props.hrvData.chartData.length > 0) {
    // 过滤掉null值，计算有效数据的最大值
    const validData = fullSeriesData.filter((value) => value !== null && !isNaN(value)) as number[];
    if (validData.length > 0) {
      const maxValue = Math.max(...validData);

      // 如果最大值超过100，则动态调整Y轴最大值
      if (maxValue > 100) {
        // 直接设置Y轴最大值为120，使用6个刻度
        newOption.yAxis.max = 120;
        newOption.yAxis.splitNumber = 6;
      }
    }
  }
  newOption.yAxis = {
    ...newOption.yAxis,
    min: 0,
    max: hrvYAxisMax.value,
    splitNumber: hrvYAxisSplitNumber.value
  };
  // 控制x轴只显示指定刻度（00:00/06:00/12:00/18:00/24:00）
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
  // 时间轴先确定布局，再统一套用新版折线样式，避免 grid 被旧配置覆盖。
  applyVitalSignsLineStyle(newOption, '#ff5a5f', 'hrv');
  return newOption;
};
const initChart = async () => {
  if (!chartRef.value) return;
  try {
    const pie = await chartRef.value.init(echarts);
    pie.setOption(getProcessedOption(), true);
  } catch {
    // 图表失败时保持页面可用，避免体验版输出原始运行时错误。
  }
};

let measureTimeout: any = null;
let measureCompleteTimer: any = null;
let isMeasureCompletePending = false;
let isMeasurementFinalizing = false;
let measureStartedAt = 0;
let measurementDeadlineAt = 0;
let completedMeasurementReading: any = null;
let wearGatePending = false;
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
// 一次实时测量必须覆盖完整采集窗口，首个合法值不能提前结束本轮测量。
const getMeasurementMinimumDurationMs = () => MIN_VITAL_MEASUREMENT_DURATION_MS;
const getCurrentHrvWearState = () =>
  resolveRingWearState(getRingMeasurementRecords(userStore.receivedData || [], measureStartedAt));
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
  popup1.value?.close?.();
  measureStatus.value = 'idle';
  measureStartedAt = 0;
  measurementDeadlineAt = 0;
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
  const wearState = getCurrentHrvWearState();
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
  const latestReading = getLatestHrvReading(userStore, measureStartedAt);
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
  popup1.value?.close();
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
  popup1.value?.close?.();
  if (measureStatus.value !== 'measuring') return;
  measureStatus.value = 'idle';
  measureStartedAt = 0;
  measurementDeadlineAt = 0;
  if (isRwDevice()) await stopActiveRwMeasurement('RW VITAL').catch(() => undefined);
  settleOwnVitalMeasurementLock('user-cancelled');
  uni.showToast({ title: t('已结束测量'), icon: 'none' });
};
// 开始测量
const handleMeasure = () => {
  if (isVitalMeasurementLocked.value) {
    if (measureStatus.value === 'measuring' && vitalMeasurementLockKind.value === 'hrv') {
      void showMeasureWaitingPopup();
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
  if (measureStatus.value === 'measuring') {
    await showMeasureWaitingPopup();
    return;
  }
  measurePopup.value?.close?.();
  if (!getSubmitDeviceMac(userStore, isIOS.value)) {
    uni.showToast({ title: t('请先连接设备'), icon: 'none' });
    (uni as any).$uv.route('/pagesA/mines/connectDevice');
    return;
  }
  const acquiredLockToken = acquireVitalMeasurementLock('hrv');
  if (!acquiredLockToken) {
    showVitalMeasurementBusy();
    return;
  }
  vitalMeasurementLockToken = acquiredLockToken;

  if (!(await ensureRingWornBeforeMeasurement(() => queryCurrentWearState('heart_rate')))) {
    settleOwnVitalMeasurementLock('wear-preflight-blocked');
    return;
  }
  if (!isRwDevice()) syncVitalMeasurementLockWithLegacyBusy(vitalMeasurementLockToken);

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
  await showMeasureWaitingPopup();
  startMeasureFallbackTimer();
  // 发送测量命令
  try {
    if (isRwDevice()) {
      await runRwForegroundMeasurement('hrv', {
        startedAt: measureStartedAt,
        timeoutMs: MAX_VITAL_MEASUREMENT_DURATION_MS,
        minActiveMs: MIN_VITAL_MEASUREMENT_DURATION_MS,
        measureStatus: () => measureStatus.value,
        source: 'RW VITAL'
      });
      await completeMeasureWithLatestReading();
      return;
    }
    await requestMetricRefresh(refreshHealthData, sendActiveMeasureCommand, { expectedSteps: 'hrv' });
    await completeMeasureWithLatestReading();
  } catch (error) {
    if (measureStatus.value !== 'measuring' || isMeasurementFinalizing) return;
    popup1.value?.close();
    if (isRwDevice()) {
      await stopActiveRwMeasurement('RW VITAL');
    }
    settleOwnVitalMeasurementLock('command-failed');
    measureStatus.value = 'idle';
    measureStartedAt = 0;
    measurementDeadlineAt = 0;
    uni.showToast({ title: t(formatBleErrorMessage(error, '测量指令发送失败')), icon: 'none' });
    return;
  }

  if (!measureTimeout && measureStatus.value === 'measuring') {
    startMeasureFallbackTimer();
  }
};

// 监听 userStore.receivedData 变化
watch(
  () => [userStore.receivedData, userStore.latestMetrics, userStore.healthData],
  (newData) => {
    if (measureStatus.value !== 'measuring') return;

    const wearState = getCurrentHrvWearState();
    if (wearState === 'not_worn' || wearState === 'charging') {
      void stopMeasureForWearGate(wearState);
      return;
    }

    const latestReading = getLatestHrvReading(userStore, measureStartedAt);

    if (wearState === 'worn' && latestReading) {
      void completeMeasureWithLatestReading();
      return;
    }

  },
  { deep: true }
);
// 监听测量状态变化，在测量完成时调用接口
watch(
  () => measureStatus.value,
  async (newStatus, oldStatus) => {
    if (newStatus === 'completed' && oldStatus !== 'completed') {
      const latest: any = completedMeasurementReading;
      if (!latest?.heartRateVariability) {
        measureStatus.value = 'idle';
        showRingWearGuidance('no_data');
        return;
      }

      if (latest?.heartRateVariability) {
        heartRateVariability.value = latest.heartRateVariability;
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
                hrv: latest.heartRateVariability
              }
            ]
          });
          notifyMeasurementSubmitted({
            deviceMac: submitDeviceMac,
            recordTime,
            metric: 'hrv'
          });
        } catch (error) {
          uni.showToast({ title: t('测量已完成，数据稍后同步'), icon: 'none' });
        } finally {
          uni.hideLoading();
          jumpDetail();
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
  if (measureStatus.value === 'measuring') return t('HRV测量中');
  return t('测量');
});
const jumpDetail = () => {
  (uni as any).$uv.route('/homeDetail/vitalSignsHeartDetail/heartRateVariabilityDetail', {
    heartRateVariability: heartRateVariability.value
  });
};

onLoad(() => {});
onShow(async () => {
  // 测量中切到后台再回来时不能把状态重置成 idle：后台那轮测量还在跑。
  if (measureStatus.value === 'measuring') return;
  clearMeasureCompleteTimer();
  isMeasureCompletePending = false;
  isMeasurementFinalizing = false;
  wearGatePending = false;
  measureStatus.value = 'idle';
  measureStartedAt = 0;
  measurementDeadlineAt = 0;
  popup1.value?.close?.();
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
  <view class="score-card mb-30">
    <view class="metric-header">
      <view class="metric-title">
        {{ t('心率变异性') }}<slot></slot>
      </view>
      <view v-if="isHeartTate" class="textBox" :class="{ 'is-measure-locked': isVitalMeasurementLocked }" @click="handleMeasure">
        <uv-image src="/static/images/homeDetail/heartLove.png" width="40rpx" height="40rpx" mode="aspectFit"></uv-image>
        <text>{{ measureText }}</text>
      </view>
    </view>
    <view class="metric-body" @click="jumpDetail">
      <view v-if="showHrvMetric" class="metric-current">
        <uv-image src="/static/images/homeDetail/heartLove.png" width="44rpx" height="44rpx" mode="aspectFit"></uv-image>
        <view class="metric-current-copy">
          <text class="metric-current-value">{{ formatIntegerStat(isHeartTate ? hrvData?.newValue : hrvData?.avgValue) }}</text>
          <text class="metric-current-unit">ms</text>
        </view>
      </view>
      <view v-else class="hrv-fallback-panel">
        <text class="hrv-fallback-status">{{ t(hrvFallbackStatus) }}</text>
        <text class="hrv-fallback-tips">{{ t(hrvFallbackTips) }}</text>
      </view>
      <view v-if="showHrvMetric" class="metric-chart-wrap">
        <MetricYAxisLabels :min="0" :max="hrvYAxisMax" :split-number="hrvYAxisSplitNumber" />
        <view class="metric-echart-box flex ai-center jc-center">
          <l-echart :key="metricChartKey" ref="chartRef" @finished="initChart" style="width: 100%; height: 340rpx; margin: 0"></l-echart>
        </view>
        <view v-if="visibleMetricAxisTicks.length" class="metric-time-axis">
          <text
            v-for="tick in visibleMetricAxisTicks"
            :key="tick.key"
            class="metric-time-tick"
            :style="{ left: `${tick.left}%`, transform: tick.isFirst ? 'translateX(0)' : tick.isLast ? 'translateX(-100%)' : 'translateX(-50%)' }"
          >{{ tick.label }}</text>
        </view>
      </view>

      <view v-if="showHrvMetric" class="stats">
        <view class="stat-item">
          <view class="stat-value">{{ formatIntegerStat(hrvData?.avgValue) }}</view>
          <view class="stat-label">{{ t('心率变异性') }}</view>
        </view>
        <view class="stat-item">
          <view class="stat-value">{{ formatIntegerRangeStat(hrvData?.avgValueRange) }}</view>
          <view class="stat-label">{{ t('关键指数') }}</view>
        </view>
      </view>
    </view>
    <uv-popup ref="popup1" mode="center" round="10rpx" :overlay="true" :closeOnClickOverlay="false" :safeAreaInsetBottom="false">
      <view class="p-30 flex fd-c ai-center" style="background: #030305e6">
        <!-- 添加heartbeat-animation类名 -->
        <view class="heartbeat-animation">
<uv-image src="/static/images/homeDetail/heartLove.png" width="45rpx" height="45rpx" mode="aspectFit"></uv-image>
        </view>
        <view class="ml-20 t-white">{{ t('HRV测量中...') }}</view>
        <view class="measurement-exit" @tap.stop="cancelMeasurement">{{ t('结束测量') }}</view>
      </view>
    </uv-popup>
    <uv-popup round="20" ref="measurePopup" mode="center">
      <Action
        :title="t('心率变异性测量提示')"
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
  border-radius: 44rpx;
  background-color: #fff;
  padding: 34rpx 30rpx 38rpx;
  box-sizing: border-box;
  overflow: hidden;
}

.metric-header {
  min-height: 68rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.metric-title {
  display: flex;
  align-items: center;
  color: #111827;
  font-size: 38rpx;
  font-weight: 500;
  line-height: 1.2;
}

.estimate-tag {
  margin-left: 12rpx;
  padding: 4rpx 12rpx;
  border-radius: 14rpx;
  color: #2e70fc;
  background: #edf3ff;
  font-size: 22rpx;
  font-weight: 400;
}

.hrv-fallback-panel {
  min-height: 310rpx;
  margin-top: 24rpx;
  border-radius: 28rpx;
  background: linear-gradient(145deg, #f7f9ff, #fff8f8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36rpx;
  box-sizing: border-box;
}

.hrv-fallback-status {
  color: #111827;
  font-size: 48rpx;
  font-weight: 600;
}

.hrv-fallback-tips {
  margin-top: 20rpx;
  color: #8a94a6;
  font-size: 26rpx;
  line-height: 1.6;
  text-align: center;
}

.textBox {
  min-height: 68rpx;
  background-color: #fff0f1;
  border-radius: 26rpx;
  padding: 0 22rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
  color: #ff5959;
  font-size: 28rpx;
  cursor: pointer;
}

.metric-body {
  width: 100%;
}

.metric-current {
  min-height: 94rpx;
  margin-top: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.metric-current-copy {
  margin-left: 14rpx;
  display: flex;
  align-items: baseline;
}

.metric-current-value {
  color: #050505;
  font-size: 54rpx;
  font-weight: 500;
  line-height: 1;
}

.metric-current-unit {
  margin-left: 6rpx;
  color: #9ca3af;
  font-size: 24rpx;
}

.stats {
  display: flex;
  justify-content: space-around;
  align-items: center;
  margin-top: 24rpx;
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
  height: 382rpx;
}

.metric-echart-box {
  width: 100%;
  height: 340rpx;
}

.metric-time-axis {
  position: absolute;
  left: 92rpx;
  right: 20rpx;
  bottom: 10rpx;
  height: 24rpx;
  color: #9ca3af;
  font-size: 20rpx;
  line-height: 1;
}

.metric-time-tick {
  position: absolute;
  top: 0;
  white-space: nowrap;
}
</style>
