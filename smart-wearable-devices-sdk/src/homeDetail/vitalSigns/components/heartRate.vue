<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
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
import {
  formatMetricRecordTime,
  getLatestHeartRateReading,
  getLatestStressReading,
  getSubmitDeviceMac,
  requestMetricRefresh
} from '@/composables/useRingMetricReadings';
import { appendRingDiagnosticLog, useRwForegroundMeasurement } from '@/composables/useRwForegroundMeasurement';
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
const {
  sendActiveMeasureCommand,
  refreshHealthData,
  ensureCommunicationReady,
  queryCurrentWearState,
  isVitalMeasurementLocked,
  vitalMeasurementLockKind,
  acquireVitalMeasurementLock,
  releaseVitalMeasurementLock,
  completeVitalMeasurement,
  syncVitalMeasurementLockWithLegacyBusy
} = useRingBLE();
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
  return getMetricTimelineTicks(
    chartData,
    props.sleepSegmentObj,
    !props.isHeartTate,
    props.isHeartTate ? props.heartRateData?.axisEndTime : undefined
  );
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
const heartYAxisMax = computed(() => {
  const values = (Array.isArray(props.heartRateData?.chartData) ? props.heartRateData.chartData : [])
    .map((item: Point) => Number(item?.value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const maxValue = values.length ? Math.max(...values) : 0;
  return maxValue > 120 ? Math.ceil(maxValue / 20) * 20 : 120;
});
const heartYAxisSplitNumber = computed(() => Math.max(6, Math.ceil(heartYAxisMax.value / 20)));
const getProcessedOption = () => {
  const newOption = cloneDeep(baseOption);
  const chartData = Array.isArray(props.heartRateData?.chartData) ? props.heartRateData.chartData : [];
  const axisData = buildMetricSleepTimelineAxis(
    chartData,
    props.sleepSegmentObj,
    !props.isHeartTate,
    props.isHeartTate ? props.heartRateData?.axisEndTime : undefined
  );
  let fullXData: string[] = [];
  let fullSeriesData: (number | null)[] = [];
  if (props.isHeartTate) {
    fullXData = axisData.xData;
    fullSeriesData = axisData.seriesData;
  } else if (chartData.length > 0) {
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
  newOption.xAxis.data = fullXData;
  newOption.series[0].data = fullSeriesData as any;
  newOption.yAxis = {
    ...newOption.yAxis,
    min: 0,
    max: heartYAxisMax.value,
    splitNumber: heartYAxisSplitNumber.value
  };
  if (chartData.length > 0) {
    // 过滤掉null值，计算有效数据的最大值
    const validData = fullSeriesData.filter((value) => value !== null && !isNaN(value)) as number[];
    if (validData.length > 0) {
      const maxValue = Math.max(...validData);
      if (maxValue > 120) {
        newOption.yAxis.max = heartYAxisMax.value;
        newOption.yAxis.splitNumber = heartYAxisSplitNumber.value;
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
  // 时间轴先确定布局，再统一套用新版折线样式，避免 grid 被旧配置覆盖。
  applyVitalSignsLineStyle(newOption, '#ff5a5f', 'heartRate');
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
const jumpDetail = () => {
  (uni as any).$uv.route('/homeDetail/vitalSignsHeartDetail/vitalSignsDetail', {
    heartRate: heartRate.value
  });
};

// 测量状态：'idle' | 'measuring' | 'completed'
const measureStatus = ref('idle');
const heartRate = ref(0);
let vitalMeasurementLockToken = '';

// 动态文本（计算属性）
const measureText = computed(() => {
  if (!getSubmitDeviceMac(userStore, isIOS.value)) {
    return '未连接';
  }
  // 共享锁在 legacy 固件返回数值后仍会保留一段时间，用于避免立即下发下一条
  // 测量命令触发“设备繁忙”。它是内部冷却状态，不代表页面仍在测量。
  if (measureStatus.value === 'measuring') return '心率测量中';
  return '测量';
});
// 监听 userStore.receivedData 变化
watch(
  () => [userStore.receivedData, userStore.latestMetrics, userStore.healthData],
  (newData) => {
    if (measureStatus.value !== 'measuring') return;

    const wearState = getCurrentHeartRateWearState();
    if (wearState === 'not_worn' || wearState === 'charging') {
      void stopMeasureForWearGate(wearState);
      return;
    }

    const latestReading = getLatestHeartRateReading(userStore, measureStartedAt);

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
      if (!latest?.heartRate) {
        measureStatus.value = 'idle';
        showRingWearGuidance('no_data');
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
let isMeasurementFinalizing = false;
let measureStartedAt = 0;
let measurementDeadlineAt = 0;
let completedMeasurementReading: any = null;
let wearGatePending = false;
let wearConfirmedForRun = false;
let legacyMeasurementValueReady = false;
const HEART_RATE_READY_TIMEOUT_MS = 12000;
const measureChange = (e: any) => {};
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
// 一次实时测量必须覆盖完整采集窗口。期间收到的数值只是候选值，
// 窗口结束后再读取最后一个合法值并统一释放页面与 BLE 独占锁。
const getMeasurementMinimumDurationMs = () => MIN_VITAL_MEASUREMENT_DURATION_MS;
const getCurrentHeartRateWearState = () => {
  const state = resolveRingWearState(getRingMeasurementRecords(userStore.receivedData || [], measureStartedAt));
  if (state === 'not_worn' || state === 'charging') return state;
  return state === 'worn' || wearConfirmedForRun ? 'worn' : state;
};
const isCurrentLegacyHeartRateValueReady = () => {
  if (isRwDevice()) return true;
  if (legacyMeasurementValueReady) return true;
  return getRingMeasurementRecords(userStore.receivedData || [], measureStartedAt).some(
    (record: any) =>
      (record.type === 'active_measure_progress' && Number(record.progress) >= 100) ||
      (record.type === 'active_measure' && Number(record.heartbeatStatus) === 0x01)
  );
};
const getHeartRateMeasureSnapshot = () => ({
  deviceMac: getSubmitDeviceMac(userStore, isIOS.value),
  protocol: resolveRingProtocol(userStore.deviceInfo as any),
  userConnected: Boolean(userStore.isConnected),
  notifyEnabled: Boolean((userStore.deviceInfo as any)?.notifyEnabled),
  measureStatus: measureStatus.value
});
const ensureHeartRateCommunicationReady = async () => {
  appendRingDiagnosticLog('VITAL HEART', 'heart-rate-ready-check-start', getHeartRateMeasureSnapshot());
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const ready = await Promise.race([
      Promise.resolve(ensureCommunicationReady()),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), HEART_RATE_READY_TIMEOUT_MS);
      })
    ]);
    appendRingDiagnosticLog('VITAL HEART', 'heart-rate-ready-check-result', {
      ...getHeartRateMeasureSnapshot(),
      ready: Boolean(ready),
      timeoutMs: HEART_RATE_READY_TIMEOUT_MS
    });
    if (!ready) throw new Error('设备连接未就绪，请靠近设备后重试');
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  legacyMeasurementValueReady = false;
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
  const wearState = getCurrentHeartRateWearState();
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
  // B7/6E 不保证返回进度 100 或 status=1；首个合法值只表示本轮已有候选结果，
  // 仍需保持弹层和独占锁到完整采集窗口结束。
  const latestReading = getLatestHeartRateReading(userStore, measureStartedAt);
  const hasReachedFallback = Date.now() >= measurementDeadlineAt - 250;
  if ((!forceDeadline && !isCurrentLegacyHeartRateValueReady()) || !latestReading) {
    if (hasReachedFallback) await stopMeasureForWearGate('no_data');
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
  legacyMeasurementValueReady = false;
  if (isRwDevice()) await stopActiveRwMeasurement('RW VITAL').catch(() => undefined);
  settleOwnVitalMeasurementLock('user-cancelled');
  uni.showToast({ title: '已结束测量', icon: 'none' });
};
// 开始测量
const handleMeasure = () => {
  if (isVitalMeasurementLocked.value) {
    if (measureStatus.value === 'measuring' && vitalMeasurementLockKind.value === 'heart_rate') {
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
    uni.showToast({ title: '请先连接设备', icon: 'none' });
    (uni as any).$uv.route('/pagesA/mines/connectDevice');
    return;
  }
  const acquiredLockToken = acquireVitalMeasurementLock('heart_rate');
  if (!acquiredLockToken) {
    showVitalMeasurementBusy();
    return;
  }
  vitalMeasurementLockToken = acquiredLockToken;

  appendRingDiagnosticLog('VITAL HEART', 'heart-rate-measure-requested', getHeartRateMeasureSnapshot());
  uni.showLoading({ title: '正在连接设备...' });
  try {
    await ensureHeartRateCommunicationReady();
  } catch (error) {
    uni.hideLoading();
    appendRingDiagnosticLog('VITAL HEART', 'heart-rate-ready-check-failed', {
      ...getHeartRateMeasureSnapshot(),
      error: formatBleErrorMessage(error, '设备连接未就绪')
    });
    settleOwnVitalMeasurementLock('ready-check-failed');
    uni.showToast({ title: formatBleErrorMessage(error, '设备未连接，请靠近设备后重试'), icon: 'none' });
    return;
  }
  uni.hideLoading();

  if (!(await ensureRingWornBeforeMeasurement(() => queryCurrentWearState('heart_rate')))) {
    appendRingDiagnosticLog('VITAL HEART', 'heart-rate-wear-preflight-blocked', getHeartRateMeasureSnapshot());
    settleOwnVitalMeasurementLock('wear-preflight-blocked');
    return;
  }
  if (!isRwDevice()) syncVitalMeasurementLockWithLegacyBusy(vitalMeasurementLockToken);
  wearConfirmedForRun = true;
  legacyMeasurementValueReady = false;

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

  appendRingDiagnosticLog('VITAL HEART', 'heart-rate-command-dispatch-start', {
    ...getHeartRateMeasureSnapshot(),
    measureStartedAt
  });

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
    const refreshResult: any = await requestMetricRefresh(refreshHealthData, sendActiveMeasureCommand, {
      expectedSteps: 'heart_rate'
    });
    legacyMeasurementValueReady = Boolean(refreshResult?.measurementCompleted || refreshResult?.record);
    appendRingDiagnosticLog('VITAL HEART', 'heart-rate-command-dispatch-result', {
      ...getHeartRateMeasureSnapshot(),
      elapsedMs: Date.now() - measureStartedAt
    });
    await completeMeasureWithLatestReading();
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
    legacyMeasurementValueReady = false;
    appendRingDiagnosticLog('VITAL HEART', 'heart-rate-command-dispatch-failed', {
      ...getHeartRateMeasureSnapshot(),
      error: formatBleErrorMessage(error, '测量指令发送失败')
    });
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
  isMeasurementFinalizing = false;
  wearGatePending = false;
  wearConfirmedForRun = false;
  legacyMeasurementValueReady = false;
  completedMeasurementReading = null;
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
  if (chartRef.value && chartRef.value) {
    chartRef.value?.dispose();
  }
});
</script>
<template>
  <view class="score-card mb-30">
    <view class="metric-header">
      <view class="metric-title">
        <text>心率</text>
        <slot></slot>
      </view>
      <view v-if="isHeartTate" class="textBox" :class="{ 'is-measure-locked': isVitalMeasurementLocked }" @click.stop="handleMeasure">
        <uv-image src="/static/images/homeDetail/love.png" width="40rpx" height="40rpx" mode="aspectFit"></uv-image>
        <text>{{ measureText }}</text>
      </view>
    </view>
    <view class="metric-body" @click="jumpDetail">
      <view class="metric-current">
        <uv-image src="/static/images/homeDetail/love.png" width="44rpx" height="44rpx" mode="aspectFit"></uv-image>
        <view class="metric-current-copy">
          <text class="metric-current-value">{{ formatIntegerStat(isHeartTate ? heartRateData?.newValue : heartRateData?.avgValue) }}</text>
          <text class="metric-current-unit">次/分钟</text>
        </view>
      </view>
      <view class="metric-chart-wrap">
        <MetricYAxisLabels :min="0" :max="heartYAxisMax" :split-number="heartYAxisSplitNumber" />
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
        <view class="ml-20 t-white">心率测量中...</view>
        <view class="measurement-exit" @tap.stop="cancelMeasurement">结束测量</view>
      </view>
    </uv-popup>
    <uv-popup round="20" ref="measurePopup" mode="center" @change="measureChange">
      <Action
        tipText="测量时绿灯将亮起30-60秒"
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
