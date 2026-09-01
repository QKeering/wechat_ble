<script setup lang="ts">
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
import { useRingStore } from '@/stores';
import { submitData } from '@/common/api/homeDetail';
import type { heartRateDetail, Point, sleepSegment } from '@/types/api/homeDetail';
import { cloneDeep } from 'lodash-es';
import Action from '@/components/action.vue';
import { formatBleErrorMessage } from '@/utils/bleError';
import { formatMetricRecordTime, getLatestSpo2Reading, getSubmitDeviceMac, requestMetricRefresh } from '@/composables/useRingMetricReadings';
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
import { showRingConnectionTroubleshootingPrompt } from '@/utils/ringConnectionTroubleshooting';
const userStore = useUserStore();
const ringStore = useRingStore();
const {
  sendOxyGenCommand,
  refreshHealthData,
  waitForParsedData,
  queryCurrentWearState,
  isVitalMeasurementLocked,
  vitalMeasurementLockKind,
  acquireVitalMeasurementLock,
  releaseVitalMeasurementLock,
  completeVitalMeasurement,
  syncVitalMeasurementLockWithLegacyBusy
} = useRingBLE();
const { runRwForegroundMeasurement, stopActiveRwMeasurement } = useRwForegroundMeasurement();
const echarts = require('../../../static/echarts.min.js');
const props = defineProps({
  oxyGenData: {
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
const popup = ref<any>(null);
const measurePopup = ref<any>(null);
const chartRef = ref<any>(null);
const oxyGen = ref(0);
const agreementChecked = ref(false);
// 测量状态：'idle' | 'measuring' | 'completed'
const measureStatus = ref('idle');
let vitalMeasurementLockToken = '';
// 是否为iOS的计算属性
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
  const chartData = Array.isArray(props.oxyGenData?.chartData) ? props.oxyGenData.chartData : [];
  return getMetricTimelineTicks(
    chartData,
    props.sleepSegmentObj,
    !props.isHeartTate,
    props.isHeartTate ? props.oxyGenData?.axisEndTime : undefined
  );
});
const visibleMetricAxisTicks = computed(() => compactMetricTimelineTicks(metricAxisTicks.value, props.isHeartTate ? 5 : 6));
const metricChartKey = computed(() => {
  const chartData = Array.isArray(props.oxyGenData?.chartData) ? props.oxyGenData.chartData : [];
  const lastPoint = chartData[chartData.length - 1] as any;
  const tickKey = visibleMetricAxisTicks.value.map((item) => item.label).join('|');
  return `${props.isHeartTate ? 'oxygen' : 'sleep-oxygen'}-${chartData.length}-${lastPoint?.time || ''}-${lastPoint?.value || ''}-${tickKey}`;
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
// 添加watch监听props变化
watch(
  () => [props.oxyGenData, props.sleepSegmentObj],
  async (newVal, oldVal) => {
    if (newVal !== oldVal) {
      // 当sleepDetailObj变化时，重新初始化图表
      await initChart();
    }
  },
  { deep: true }
);
const getProcessedOption = () => {
  const newOption = cloneDeep(baseOption);
  const chartData = Array.isArray(props.oxyGenData?.chartData) ? props.oxyGenData.chartData : [];
  const axisData = buildMetricSleepTimelineAxis(
    chartData,
    props.sleepSegmentObj,
    !props.isHeartTate,
    props.isHeartTate ? props.oxyGenData?.axisEndTime : undefined
  );
  let fullXData: string[] = [];
  let fullSeriesData: (number | null)[] = [];
  if (props.isHeartTate) {
    fullXData = axisData.xData;
    fullSeriesData = axisData.seriesData;
  } else if (chartData.length > 0) {
    // 有数据时使用实际数据
    fullXData = chartData.map((item: Point) => normalizeTimelineLabel(item.time));
    // fullSeriesData = props.oxyGenData?.chartData?.map((item: Point) => Number(item.value)) || [];
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
  // 1. 根据数据生成完整的x轴数据
  // const fullXData = props.oxyGenData?.chartData?.map((item: Point) => item.time?.toString() || '00:00') || [];
  // 2. 生成24小时完整的series数据（数值类型）
  // const fullSeriesData = props.oxyGenData?.chartData?.map((item: Point) => Number(item.value)) || [];
  // const fullSeriesData = [62, 60, 58, 59, 61, 63, 70, 75, 80, 78, 76, 72, 78, 82, 85, 83, 80, 77, 75, 73, 70, 68, 65, 63];
  // 3. 替换xAxis.data和series.data为完整数据
  // 波形仍使用接口原始点位；睡眠区间只用于外置时间轴标签，避免重采样导致折线消失。
  newOption.xAxis.data = fullXData;
  newOption.series[0].data = fullSeriesData as any;
  // 超过100，则y轴最大刻度显示120，6个刻度
  if (props.oxyGenData?.chartData && props.oxyGenData.chartData.length > 0) {
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
    min: 60,
    max: 100,
    splitNumber: 4
  };
  // 4. 控制x轴只显示指定刻度（00:00/06:00/12:00/18:00/24:00）
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
  applyVitalSignsLineStyle(newOption, '#ff5a5f', 'bloodOxygen');
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
let measureStartedAt = 0;
let completedMeasurementReading: any = null;
let wearGatePending = false;
let measurementRunToken = 0;
let wearConfirmedForRun = false;
const isRwDevice = () => resolveRingProtocol(userStore.deviceInfo as any) === 'rw';
const showVitalMeasurementBusy = () => {
  uni.showToast({ title: '设备正在测量，请稍候', icon: 'none' });
};
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
// 血氧命令包含完整采集窗口；第一帧只记录候选值，戒指熄灯并结束采集前
// 不关闭弹层、不跳转结果页，也不释放 BLE 独占锁。
const getMeasurementMinimumDurationMs = () => MIN_VITAL_MEASUREMENT_DURATION_MS;
const getLatestSpo2ReadingFromStores = () =>
  getLatestSpo2Reading(userStore, measureStartedAt) || getLatestSpo2Reading(ringStore, measureStartedAt);
const getCurrentBloodOxygenWearState = () => {
  const userMeasurementRecords = getRingMeasurementRecords(userStore.receivedData || [], measureStartedAt);
  const ringMeasurementRecords = getRingMeasurementRecords(ringStore.receivedData || [], measureStartedAt);
  const normalizedMeasurementRecords = getRingMeasurementRecords(ringStore.normalizedData || [], measureStartedAt);
  const state = resolveRingWearState([...userMeasurementRecords, ...ringMeasurementRecords, ...normalizedMeasurementRecords]);
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
  measurementRunToken += 1;
  wearGatePending = true;
  if (measureTimeout) {
    clearTimeout(measureTimeout);
    measureTimeout = null;
  }
  clearMeasureCompleteTimer();
  isMeasureCompletePending = false;
  popup.value?.close?.();
  measureStatus.value = 'idle';
  measureStartedAt = 0;
  wearConfirmedForRun = false;
  if (isRwDevice()) {
    await stopActiveRwMeasurement('RW VITAL').catch(() => undefined);
  }
  settleOwnVitalMeasurementLock('wear-gate-blocked');
  showRingWearGuidance(wearState);
  wearGatePending = false;
};
const startDirectBloodOxygenWearGate = (runToken: number) => {
  const pendingStatus = waitForParsedData(
    (parsed: any) => {
      if (runToken !== measurementRunToken || measureStatus.value !== 'measuring') return false;
      const sourceType = String(parsed?.sourceType || parsed?.type || parsed?.raw?.type || '');
      if (sourceType === 'active_OxyGenMeasure') {
        const wearState = resolveRingWearState([parsed]);
        return wearState === 'not_worn' || wearState === 'charging';
      }
      const name = String(parsed?.name || parsed?.metrics?.name || parsed?.raw?.name || '').toLowerCase();
      const statusCode = Number(parsed?.statusCode ?? parsed?.metrics?.statusCode ?? parsed?.raw?.statusCode);
      return (
        ['rw_health_data_ack', 'rw_health_data'].includes(sourceType) &&
        /blood[_-]?oxygen|spo2|oxygen/.test(name) &&
        statusCode === 0x31
      );
    },
    MAX_VITAL_MEASUREMENT_DURATION_MS,
    { replayRecent: false }
  );
  pendingStatus
    .then((parsed: any) => {
      if (runToken !== measurementRunToken || measureStatus.value !== 'measuring') return;
      const wearState = resolveRingWearState([parsed]);
      if (wearState === 'not_worn' || wearState === 'charging') {
        void stopMeasureForWearGate(wearState);
        return;
      }
      // RW NACK 当前固件没有更细的佩戴码，但可以确定本轮没有有效血氧。
      measurementRunToken += 1;
      if (measureTimeout) {
        clearTimeout(measureTimeout);
        measureTimeout = null;
      }
      clearMeasureCompleteTimer();
      popup.value?.close?.();
      measureStatus.value = 'idle';
      measureStartedAt = 0;
      void stopActiveRwMeasurement('RW VITAL').catch(() => undefined);
      settleOwnVitalMeasurementLock('wear-gate-no-data');
      showRingWearGuidance('no_data');
    })
    .catch(() => undefined);
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
  const wearState = getCurrentBloodOxygenWearState();
  if (wearState === 'not_worn' || wearState === 'charging') {
    await stopMeasureForWearGate(wearState);
    return;
  }
  if (wearState !== 'worn') {
    if (Date.now() - measureStartedAt >= MAX_VITAL_MEASUREMENT_DURATION_MS - 250) {
      await stopMeasureForWearGate('no_data');
    }
    return;
  }
  const latestReading = getLatestSpo2ReadingFromStores();
  if (!latestReading) {
    if (Date.now() - measureStartedAt >= MAX_VITAL_MEASUREMENT_DURATION_MS - 250) {
      await stopMeasureForWearGate('no_data');
    }
    return;
  }
  const remainingMs = getRemainingVitalMeasurementMs(measureStartedAt, getMeasurementMinimumDurationMs());
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
  completedMeasurementReading = { ...latestReading };
  popup.value?.close();
  if (isRwDevice()) {
    await stopActiveRwMeasurement('RW VITAL');
  }
  completeOwnVitalMeasurement();
  measureStatus.value = 'completed';
};
const completeMeasureWhenLatestReadingReady = async () => {
  if (!getLatestSpo2ReadingFromStores()) return;
  await completeMeasureWithLatestReading();
};
// 开始测量
const handleMeasure = () => {
  if (isVitalMeasurementLocked.value) {
    if (measureStatus.value === 'measuring' && vitalMeasurementLockKind.value === 'blood_oxygen') {
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
    await showRingConnectionTroubleshootingPrompt();
    return;
  }
  const acquiredLockToken = acquireVitalMeasurementLock('blood_oxygen');
  if (!acquiredLockToken) {
    showVitalMeasurementBusy();
    return;
  }
  vitalMeasurementLockToken = acquiredLockToken;

  if (!(await ensureRingWornBeforeMeasurement(() => queryCurrentWearState('blood_oxygen')))) {
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
  wearGatePending = false;

  measureStatus.value = 'measuring';
  measurementRunToken += 1;
  const runToken = measurementRunToken;
  measureStartedAt = Date.now();
  completedMeasurementReading = null;

  await showMeasureWaitingPopup();
  startMeasureFallbackTimer();
  startDirectBloodOxygenWearGate(runToken);
  // 发送测量命令
  try {
    if (isRwDevice()) {
      await runRwForegroundMeasurement('blood_oxygen', {
        startedAt: measureStartedAt,
        timeoutMs: MAX_VITAL_MEASUREMENT_DURATION_MS,
        minActiveMs: MIN_VITAL_MEASUREMENT_DURATION_MS,
        measureStatus: () => measureStatus.value,
        source: 'RW VITAL'
      });
      await completeMeasureWhenLatestReadingReady();
      return;
    }
    await requestMetricRefresh(refreshHealthData, sendOxyGenCommand, {
      expectedSteps: 'blood_oxygen',
      acceptPending: false
    });
    await completeMeasureWhenLatestReadingReady();
  } catch (error) {
    if (measureStatus.value !== 'measuring') return;
    // 命令 Promise 可能在 watcher 执行前因 NACK/超时拒绝。
    // 先用本轮回包判断佩戴状态，不要先清空 measureStartedAt。
    const wearState = getCurrentBloodOxygenWearState();
    if (wearState === 'not_worn' || wearState === 'charging') {
      await stopMeasureForWearGate(wearState);
      return;
    }
    popup.value?.close();
    if (isRwDevice()) {
      await stopActiveRwMeasurement('RW VITAL');
    }
    settleOwnVitalMeasurementLock('command-failed');
    measureStatus.value = 'idle';
    measurementRunToken += 1;
    measureStartedAt = 0;
    wearConfirmedForRun = false;
    const errorText = formatBleErrorMessage(error, '测量指令发送失败');
    const isConnectionFailure =
      !userStore.isConnected || /连接|蓝牙|GATT|服务未就绪|not connected|10003|10004|10006/i.test(errorText);
    if (isConnectionFailure) {
      await showRingConnectionTroubleshootingPrompt();
    } else {
      // 设备已连接但本轮没有有效血氧，给出佩戴指引，不用技术错误提示覆盖门禁。
      showRingWearGuidance('no_data');
    }
    return;
  }

  if (!measureTimeout && measureStatus.value === 'measuring') {
    startMeasureFallbackTimer();
  }
};
// 监听 userStore.receivedData 变化,
watch(
  () => [userStore.receivedData, userStore.latestMetrics, userStore.healthData, ringStore.receivedData, ringStore.normalizedData],
  (newData) => {
    if (measureStatus.value !== 'measuring') return;

    const wearState = getCurrentBloodOxygenWearState();
    if (wearState === 'not_worn' || wearState === 'charging') {
      void stopMeasureForWearGate(wearState);
      return;
    }

    const latestReading = getLatestSpo2ReadingFromStores();
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
      // 无效数据（包括 0）跳过，由 latest?.bloodOxygen > 0 判断
      if (!(latest?.bloodOxygen > 0)) {
        measureStatus.value = 'idle';
        showRingWearGuidance('no_data');
        return;
      }

      if (latest?.bloodOxygen > 0) {
        oxyGen.value = latest.bloodOxygen;
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
                spo2: latest.bloodOxygen
              }
            ]
          });
        } catch (error) {
          uni.showToast({ title: '测量已完成，数据稍后同步', icon: 'none' });
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
    return '未连接';
  }
  // legacy 数值返回后的共享锁仅用于保护固件命令通道，不能显示为仍在测量。
  if (measureStatus.value === 'measuring') return '测量中';
  // if (measureStatus.value === 'completed') {
  //   const latest: any = userStore.receivedData.filter((d) => d.type === 'active_measure').sort((a, b) => b.timestamp - a.timestamp)[0];
  //   // if (latest?.bloodOxygen) {
  //   if (latest?.bloodOxygen !== null && latest?.bloodOxygen !== undefined) {
  //     oxyGen.value = latest.bloodOxygen;
  //     uni.showToast({ title: '测量完成', icon: 'none' });
  //     jumpDetail();
  //   }
  // }
  return '测量';
});
const jumpDetail = () => {
  (uni as any).$uv.route('/homeDetail/vitalSignsHeartDetail/oxyGenDetail', {
    oxyGen: oxyGen.value
  });
};
onLoad(() => {});
onShow(async () => {
  measurementRunToken += 1;
  clearMeasureCompleteTimer();
  isMeasureCompletePending = false;
  wearGatePending = false;
  wearConfirmedForRun = false;
  measureStatus.value = 'idle';
});
onUnload(() => {
  measurementRunToken += 1;
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
      <view class="metric-title">血氧饱和度<slot></slot></view>
      <view class="textBox" :class="{ 'is-measure-locked': isVitalMeasurementLocked }" @tap="handleMeasure" v-if="isHeartTate">
        <uv-image src="/static/images/homeDetail/oxygen.png" width="40rpx" height="40rpx" mode="aspectFit"></uv-image>
        <text>{{ measureText }}</text>
      </view>
    </view>
    <view class="metric-body" @click="jumpDetail">
      <view class="metric-current">
        <uv-image src="/static/images/homeDetail/oxygen.png" width="44rpx" height="44rpx" mode="aspectFit"></uv-image>
        <view class="metric-current-copy">
          <text class="metric-current-value">{{ formatIntegerStat(isHeartTate ? oxyGenData?.newValue : oxyGenData?.avgValue) }}</text>
          <text class="metric-current-unit">%</text>
        </view>
      </view>

      <view class="metric-chart-wrap">
        <MetricYAxisLabels :min="60" :max="100" :split-number="4" />
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

      <view class="stats">
        <view class="stat-item">
          <view class="stat-value">{{ formatIntegerStat(oxyGenData.avgValue) }}</view>
          <view class="stat-label">平均血氧</view>
        </view>
        <view class="stat-item">
          <view class="stat-value">{{ formatIntegerRangeStat(oxyGenData.avgValueRange) }}</view>
          <view class="stat-label">平均范围</view>
        </view>
      </view>
    </view>
    <uv-popup ref="popup" mode="center" round="10rpx" :overlay="true" :closeOnClickOverlay="false" :safeAreaInsetBottom="false">
      <view class="p-30 flex fd-c ai-center" style="background: #030305e6">
        <!-- 添加heartbeat-animation类名 -->
        <view class="heartbeat-animation">
<uv-image src="/static/images/homeDetail/oxygen.png" width="45rpx" height="45rpx" mode="aspectFit"></uv-image>
        </view>
        <view class="ml-20 t-white">测量中...</view>
      </view>
    </uv-popup>
    <uv-popup round="20" ref="measurePopup" mode="center">
      <Action
        title="血氧测量提示"
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
