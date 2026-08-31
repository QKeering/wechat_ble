<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onHide, onLoad, onUnload } from '@dcloudio/uni-app';
import { useUserStore } from '@/stores/user';
import { useRingBLE } from '@/composables/useRingBLE';
import {
  getLatestBloodPressureReading,
  getLatestBloodSugarReading,
  getLatestHeartRateReading,
  getLatestHrvReading,
  getLatestSpo2Reading,
  getLatestStressReading,
  getLatestTemperatureReading,
  getSubmitDeviceMac,
  requestMetricRefresh
} from '@/composables/useRingMetricReadings';
import { isRwForegroundMetric, useRwForegroundMeasurement } from '@/composables/useRwForegroundMeasurement';
import { formatBleErrorMessage, isExpectedBleRuntimeError } from '@/utils/bleError';
import { getRemainingVitalMeasurementMs } from '@/utils/measurementDuration';
import { showRingConnectionTroubleshootingPrompt } from '@/utils/ringConnectionTroubleshooting';
import { ensureRingWornBeforeMeasurement, resolveRingWearState } from '@/utils/ringWearGate';
import { submitData } from '@/common/api/homeDetail';
import { resolveRingProtocol } from '@/sdk/ring-ble';
import type { submitDataType } from '@/types/api/homeDetail';

const {
  isDeviceConnected,
  autoConnectLastDevice,
  ensureCommunicationReady,
  sendOxyGenCommand,
  sendActiveMeasureCommand,
  sendBodyTemperatureCommand,
  queryCurrentWearState,
  refreshHealthData
} = useRingBLE();
const { runRwForegroundMeasurement, stopActiveRwMeasurement } = useRwForegroundMeasurement();
const userStore = useUserStore();

const measureStatus = ref<'idle' | 'measuring_hr' | 'measuring_hrv' | 'measuring_spo2' | 'measuring_temp' | 'completed'>('idle');
const wearCheckStatus = ref<'idle' | 'checking' | 'worn'>('idle');
const measurementGuidance = ref('');
const heartRate = ref<number | null>(null);
const heartRateVariability = ref<number | null>(null);
const stressIndex = ref<number | null>(null);
const bloodSugar = ref<number | null>(null);
const systolic = ref<number | null>(null);
const diastolic = ref<number | null>(null);
const spo2Value = ref<number | null>(null);
const temperature = ref<number | null>(null);
const measureProgress = ref(0);

let progressAnimationTimer: ReturnType<typeof setInterval> | null = null;
let progressIntervals: ReturnType<typeof setInterval>[] = [];
let measureTimeout: ReturnType<typeof setTimeout> | null = null;
let rwAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
let completionDelayTimer: ReturnType<typeof setTimeout> | null = null;
let measureStartedAt = 0;
let measureStepStartedAt = 0;
let measureStepReceivedDataStartIndex = 0;
let measurementRunToken = 0;
let guidanceVisible = false;

const DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS = 35000;
const RW_OPTIONAL_TEMPERATURE_TIMEOUT_MS = 8000;
const RW_FULL_MEASURE_STEP_MIN_ACTIVE_MS = 6000;

const measureStatusText = computed(() => {
  if (measurementGuidance.value) return '请正确佩戴戒指';
  const statusMap = {
    idle: '准备测量',
    measuring_hr: '正在测量心率',
    measuring_hrv: '正在测量心率变异性',
    measuring_spo2: '正在测量血氧',
    measuring_temp: '正在测量皮肤温度',
    completed: '测量完成'
  };
  return statusMap[measureStatus.value] || '准备测量';
});

const measureHintText = computed(() => {
  if (measurementGuidance.value) return measurementGuidance.value;
  if (measureStatus.value === 'completed') return '检测完成，正在整理报告';
  if (measureStatus.value === 'idle') return '正在连接设备，请稍候';
  return '请保持手部静止，戒指贴合手指，测量期间不要退出页面';
});

const measureStepOrder = ['measuring_hr', 'measuring_hrv', 'measuring_spo2', 'measuring_temp'] as const;

const getMeasureStepDesc = (stepStatus: (typeof measureStepOrder)[number], valueText: string | null) => {
  if (wearCheckStatus.value === 'checking') return '等待测量';
  if (measureStatus.value === stepStatus) return '测量中';
  if (valueText) return valueText;
  if (measureStatus.value === 'completed') return '等待数据';

  const currentIndex = measureStepOrder.indexOf(measureStatus.value as (typeof measureStepOrder)[number]);
  if (currentIndex < 0) return '等待测量';
  return measureStepOrder.indexOf(stepStatus) < currentIndex ? '等待数据' : '等待测量';
};

const measureStepItems = computed(() => [
  {
    key: 'heart-rate',
    label: '心率',
    desc: getMeasureStepDesc('measuring_hr', heartRate.value ? `${heartRate.value} bpm` : null),
    active: wearCheckStatus.value === 'worn' && measureStatus.value === 'measuring_hr',
    done: ['measuring_hrv', 'measuring_spo2', 'measuring_temp', 'completed'].includes(measureStatus.value) || Boolean(heartRate.value)
  },
  {
    key: 'hrv',
    label: 'HRV',
    desc: getMeasureStepDesc('measuring_hrv', heartRateVariability.value ? `${heartRateVariability.value} ms` : null),
    active: wearCheckStatus.value === 'worn' && measureStatus.value === 'measuring_hrv',
    done: ['measuring_spo2', 'measuring_temp', 'completed'].includes(measureStatus.value) || Boolean(heartRateVariability.value)
  },
  {
    key: 'spo2',
    label: '血氧',
    desc: getMeasureStepDesc('measuring_spo2', spo2Value.value ? `${spo2Value.value}%` : null),
    active: wearCheckStatus.value === 'worn' && measureStatus.value === 'measuring_spo2',
    done: ['measuring_temp', 'completed'].includes(measureStatus.value) || Boolean(spo2Value.value)
  },
  {
    key: 'skin-temperature',
    label: '皮肤温度',
    desc: getMeasureStepDesc('measuring_temp', temperature.value ? `${formatTemperatureMetric(temperature.value)}°C` : null),
    active: wearCheckStatus.value === 'worn' && measureStatus.value === 'measuring_temp',
    done: measureStatus.value === 'completed' || Boolean(temperature.value)
  }
]);

const isIOS = computed(() => {
  const systemInfo = uni.getSystemInfoSync();
  return systemInfo.platform.toLowerCase().includes('ios');
});
const isRwDevice = () => resolveRingProtocol(userStore.deviceInfo as any) === 'rw';
const getSubmitMac = () => getSubmitDeviceMac(userStore, isIOS.value);

const normalizeIntegerMetric = (value: unknown) => {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
};

const normalizeTemperatureMetric = (value: unknown) => {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? Number(numeric.toFixed(1)) : null;
};

const formatTemperatureMetric = (value: unknown) => {
  const numeric = normalizeTemperatureMetric(value);
  return numeric == null ? null : numeric.toFixed(1);
};

const getLatestHeartRateData = (since = measureStartedAt) => getLatestHeartRateReading(userStore, since);
const getLatestHrvData = (since = measureStartedAt) => getLatestHrvReading(userStore, since);
const getLatestSpo2Data = (since = measureStartedAt) => getLatestSpo2Reading(userStore, since);
const getLatestStressData = (since = measureStartedAt) => getLatestStressReading(userStore, since);
const getLatestBloodSugarData = (since = measureStartedAt) => getLatestBloodSugarReading(userStore, since);
const getLatestBloodPressureData = (since = measureStartedAt) => getLatestBloodPressureReading(userStore, since);
const getLatestTemperatureData = (since = measureStartedAt) => getLatestTemperatureReading(userStore, since);
const hasRwAnyRealtimeCoreData = () => Boolean(getLatestHeartRateData()?.heartRate || getLatestSpo2Data()?.bloodOxygen);

const resolveWearCheckResult = (records: any[]) => resolveRingWearState(records);
const getCurrentStepRecords = () => (userStore.receivedData || []).slice(measureStepReceivedDataStartIndex);
const isLegacyHeartStepFinished = (records = getCurrentStepRecords()) =>
  records.some(
    (data: any) =>
      (data.type === 'active_measure_progress' && Number(data.progress) >= 100) ||
      (data.type === 'active_measure' && Number(data.heartbeatStatus) === 0x01)
  );
const isLegacyOxygenStepFinished = (records = getCurrentStepRecords()) =>
  records.some((data: any) => data.type === 'active_OxyGenMeasure' && Number(data.bloodOxygenStatus) === 0x01);

const clearRealtimeMeasurementRecords = () => {
  userStore.receivedData = (userStore.receivedData || []).filter(
    (data: any) => !['active_measure', 'active_OxyGenMeasure', 'active_Temperature'].includes(data.type)
  );
};

const clearAllProgressIntervals = () => {
  progressIntervals.forEach((interval) => clearInterval(interval));
  progressIntervals = [];
};

const clearMeasureTimeout = () => {
  if (!measureTimeout) return;
  clearTimeout(measureTimeout);
  measureTimeout = null;
};

const clearRwAdvanceTimer = () => {
  if (!rwAdvanceTimer) return;
  clearTimeout(rwAdvanceTimer);
  rwAdvanceTimer = null;
};

const clearCompletionDelayTimer = () => {
  if (!completionDelayTimer) return;
  clearTimeout(completionDelayTimer);
  completionDelayTimer = null;
};

const clearMeasurementTimers = () => {
  clearMeasureTimeout();
  clearRwAdvanceTimer();
  clearCompletionDelayTimer();
  if (progressAnimationTimer) {
    clearInterval(progressAnimationTimer);
    progressAnimationTimer = null;
  }
  clearAllProgressIntervals();
};

const stopMeasurementFlow = () => {
  measurementRunToken += 1;
  clearMeasurementTimers();
  void stopActiveRwMeasurement('RW PAGE');
  wearCheckStatus.value = 'idle';
  measureStatus.value = 'idle';
};

const resetMeasurementFlowForNewRun = async () => {
  measurementRunToken += 1;
  clearMeasurementTimers();
  measureStartedAt = 0;
  measureStepStartedAt = 0;
  measureStepReceivedDataStartIndex = 0;
  measureProgress.value = 0;
  wearCheckStatus.value = 'idle';
  measureStatus.value = 'idle';
  await stopActiveRwMeasurement('RW PAGE').catch(() => undefined);
};

const showMeasurementGuidance = (kind: 'not_worn' | 'charging' | 'no_data') => {
  if (guidanceVisible) return;
  const guidance = {
    not_worn: {
      title: '请先正确佩戴戒指',
      content: '请将戒指戴在手指根部，确保传感器贴合皮肤，保持手部静止后重新测量。'
    },
    charging: {
      title: '请先取出并佩戴戒指',
      content: '请先将戒指拿出充电仓，戴在手指根部并确保传感器贴合皮肤后重新测量。'
    },
    no_data: {
      title: '暂未获取到有效数据',
      content: '请确认戒指已戴在手指根部，传感器贴合皮肤，并保持手部静止后重新测量。'
    }
  }[kind];

  stopMeasurementFlow();
  measureProgress.value = 0;
  measurementGuidance.value = guidance.content;
  guidanceVisible = true;
  uni.showModal({
    title: guidance.title,
    content: guidance.content,
    confirmText: '重新测量',
    cancelText: '稍后再试',
    success: (result) => {
      guidanceVisible = false;
      if (result.confirm) {
        void handleMeasure();
        return;
      }
      uni.navigateBack();
    },
    fail: () => {
      guidanceVisible = false;
    }
  });
};

const sendMeasurementCommand = async (task: () => Promise<unknown>, expectedSteps: string | string[]) => {
  try {
    const expectedMetric = Array.isArray(expectedSteps) ? expectedSteps[0] : expectedSteps;
    if (isRwDevice() && isRwForegroundMetric(expectedMetric)) {
      await runRwForegroundMeasurement(expectedMetric, {
        startedAt: measureStepStartedAt || measureStartedAt,
        minActiveMs: RW_FULL_MEASURE_STEP_MIN_ACTIVE_MS,
        measureStatus: () => measureStatus.value,
        source: 'RW PAGE'
      });
      return;
    }
    await requestMetricRefresh(refreshHealthData, task, { expectedSteps });
  } catch (error) {
    if (!isExpectedBleRuntimeError(error)) {
      formatBleErrorMessage(error);
    }
    if (wearCheckStatus.value === 'checking') {
      showMeasurementGuidance('no_data');
      return;
    }
    stopMeasurementFlow();
    uni.showToast({ title: '测量指令发送失败', icon: 'none' });
  }
};

const quickProgressToCompletionPending = () => {
  const currentProgress = measureProgress.value;
  const remaining = 99 - currentProgress;
  const steps = 10;
  const stepValue = Math.max(1, Math.floor(remaining / steps));

  if (progressAnimationTimer) clearInterval(progressAnimationTimer);
  progressAnimationTimer = setInterval(() => {
    if (measureProgress.value >= 99) {
      if (progressAnimationTimer) clearInterval(progressAnimationTimer);
      progressAnimationTimer = null;
      return;
    }
    measureProgress.value = Math.min(measureProgress.value + stepValue, 99);
  }, 50);
};

const advanceRwMeasureSoon = (next: () => void, delay = 300) => {
  clearMeasureTimeout();
  clearAllProgressIntervals();
  clearRwAdvanceTimer();
  const stepRemainingMs = isRwDevice() ? Math.max(0, RW_FULL_MEASURE_STEP_MIN_ACTIVE_MS - (Date.now() - measureStepStartedAt)) : 0;
  rwAdvanceTimer = setTimeout(() => {
    rwAdvanceTimer = null;
    next();
  }, Math.max(delay, stepRemainingMs));
};

const pushProgressInterval = (targetProgress: number, expectedStatus: typeof measureStatus.value) => {
  const progressInterval = setInterval(() => {
    if (measureStatus.value !== expectedStatus) {
      clearInterval(progressInterval);
      progressIntervals = progressIntervals.filter((item) => item !== progressInterval);
      return;
    }

    if (wearCheckStatus.value === 'checking') return;

    const safeTargetProgress = Math.min(targetProgress, 99);
    measureProgress.value = Math.min(measureProgress.value + 1, safeTargetProgress);
    if (measureProgress.value >= safeTargetProgress) {
      clearInterval(progressInterval);
      progressIntervals = progressIntervals.filter((item) => item !== progressInterval);
    }
  }, 1000);
  progressIntervals.push(progressInterval);
};

const beginMeasurementStep = (status: typeof measureStatus.value) => {
  measureStatus.value = status;
  measureStepStartedAt = Date.now();
  measureStepReceivedDataStartIndex = (userStore.receivedData || []).length;
};

const startHrMeasurement = () => {
  const runToken = measurementRunToken;
  // handleMeasure 的硬件前置门禁已确认本轮正确佩戴。不能在正式复用同一条
  // 测量命令时重新改回 checking，否则 legacy 的最终 value/status=3 会被
  // 当作“尚未确认佩戴”，完整回包后仍停在第一步直至超时。
  if (wearCheckStatus.value !== 'worn') wearCheckStatus.value = 'checking';
  beginMeasurementStep('measuring_hr');
  const stepStartedAt = measureStepStartedAt;
  measureProgress.value = 0;
  clearAllProgressIntervals();
  void sendMeasurementCommand(sendActiveMeasureCommand, 'heart_rate').then(() => {
    if (
      runToken === measurementRunToken &&
      isRwDevice() &&
      measureStatus.value === 'measuring_hr' &&
      resolveWearCheckResult((userStore.receivedData || []).slice(measureStepReceivedDataStartIndex)) === 'worn' &&
      getLatestHeartRateData(stepStartedAt)?.heartRate
    ) {
      wearCheckStatus.value = 'worn';
      startHrvMeasurement();
    }
  });
  pushProgressInterval(25, 'measuring_hr');
  measureTimeout = setTimeout(() => {
    if (runToken !== measurementRunToken || measureStatus.value !== 'measuring_hr') return;
    if (wearCheckStatus.value === 'checking') {
      showMeasurementGuidance('no_data');
      return;
    }
    startHrvMeasurement();
  }, DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS);
};

const startHrvMeasurement = () => {
  const runToken = measurementRunToken;
  beginMeasurementStep('measuring_hrv');
  const stepStartedAt = measureStepStartedAt;
  clearAllProgressIntervals();
  clearMeasureTimeout();
  void sendMeasurementCommand(sendActiveMeasureCommand, 'hrv').then(() => {
    if (
      runToken === measurementRunToken &&
      isRwDevice() &&
      measureStatus.value === 'measuring_hrv' &&
      getLatestHrvData(stepStartedAt)?.heartRateVariability
    ) {
      startSpo2Measurement();
    }
  });
  pushProgressInterval(50, 'measuring_hrv');
  measureTimeout = setTimeout(() => {
    if (runToken === measurementRunToken && measureStatus.value === 'measuring_hrv') startSpo2Measurement();
  }, DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS);
};

const startSpo2Measurement = () => {
  const runToken = measurementRunToken;
  beginMeasurementStep('measuring_spo2');
  const stepStartedAt = measureStepStartedAt;
  clearAllProgressIntervals();
  clearMeasureTimeout();
  void sendMeasurementCommand(sendOxyGenCommand, 'blood_oxygen').then(() => {
    if (
      runToken === measurementRunToken &&
      isRwDevice() &&
      measureStatus.value === 'measuring_spo2' &&
      getLatestSpo2Data(stepStartedAt)?.bloodOxygen
    ) {
      startTemperatureMeasurement();
    }
  });
  pushProgressInterval(75, 'measuring_spo2');
  measureTimeout = setTimeout(() => {
    if (runToken === measurementRunToken && measureStatus.value === 'measuring_spo2') {
      startTemperatureMeasurement();
    }
  }, DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS);
};

const startTemperatureMeasurement = () => {
  const runToken = measurementRunToken;
  beginMeasurementStep('measuring_temp');
  const stepStartedAt = measureStepStartedAt;
  clearAllProgressIntervals();
  clearMeasureTimeout();
  void sendMeasurementCommand(sendBodyTemperatureCommand, 'temperature').then(() => {
    if (
      runToken === measurementRunToken &&
      isRwDevice() &&
      measureStatus.value === 'measuring_temp' &&
      getLatestTemperatureData(stepStartedAt)?.temperature
    ) {
      completeMeasurement();
    }
  });
  pushProgressInterval(99, 'measuring_temp');
  measureTimeout = setTimeout(() => {
    if (runToken === measurementRunToken && measureStatus.value === 'measuring_temp') completeMeasurement();
  }, isRwDevice() && hasRwAnyRealtimeCoreData() ? RW_OPTIONAL_TEMPERATURE_TIMEOUT_MS : DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS);
};

const completeMeasurement = () => {
  if (measureStatus.value === 'completed') return;
  const remainingMs = getRemainingVitalMeasurementMs(measureStartedAt);
  if (remainingMs > 0) {
    if (completionDelayTimer) return;
    completionDelayTimer = setTimeout(() => {
      completionDelayTimer = null;
      completeMeasurement();
    }, remainingMs);
    return;
  }
  clearMeasureTimeout();
  clearRwAdvanceTimer();
  clearCompletionDelayTimer();
  if (progressAnimationTimer) {
    clearInterval(progressAnimationTimer);
    progressAnimationTimer = null;
  }
  clearAllProgressIntervals();
  void stopActiveRwMeasurement('RW PAGE');
  measureProgress.value = 100;
  measureStatus.value = 'completed';
};

watch(
  () => [userStore.receivedData, userStore.latestMetrics, userStore.healthData],
  () => {
    if (!['measuring_temp', 'measuring_hr', 'measuring_hrv', 'measuring_spo2'].includes(measureStatus.value)) return;
    const receivedData = userStore.receivedData || [];
    const currentStepRecords = receivedData.slice(measureStepReceivedDataStartIndex);
    const wearResult = resolveWearCheckResult(currentStepRecords);
    if (wearResult === 'not_worn') {
      showMeasurementGuidance('not_worn');
      return;
    }
    if (wearResult === 'charging') {
      showMeasurementGuidance('charging');
      return;
    }
    if (wearCheckStatus.value === 'checking' && wearResult === 'worn') {
      wearCheckStatus.value = 'worn';
    }

    if (
      isRwDevice() &&
      wearCheckStatus.value === 'worn' &&
      measureStatus.value === 'measuring_hr' &&
      getLatestHeartRateData(measureStepStartedAt)?.heartRate
    ) {
      measureProgress.value = Math.max(measureProgress.value, 25);
      advanceRwMeasureSoon(() => {
        if (measureStatus.value === 'measuring_hr') startHrvMeasurement();
      });
      return;
    }

    if (isRwDevice() && measureStatus.value === 'measuring_hrv' && getLatestHrvData(measureStepStartedAt)?.heartRateVariability) {
      measureProgress.value = Math.max(measureProgress.value, 50);
      advanceRwMeasureSoon(() => {
        if (measureStatus.value === 'measuring_hrv') startSpo2Measurement();
      }, 500);
      return;
    }

    if (isRwDevice() && measureStatus.value === 'measuring_spo2' && getLatestSpo2Data(measureStepStartedAt)?.bloodOxygen) {
      measureProgress.value = Math.max(measureProgress.value, 75);
      advanceRwMeasureSoon(() => {
        if (measureStatus.value === 'measuring_spo2') startTemperatureMeasurement();
      }, 500);
      return;
    }

    if (isRwDevice() && measureStatus.value === 'measuring_temp' && getLatestTemperatureData(measureStepStartedAt)?.temperature) {
      quickProgressToCompletionPending();
      advanceRwMeasureSoon(() => {
        if (measureStatus.value === 'measuring_temp') completeMeasurement();
      }, 500);
      return;
    }

    if (isRwDevice()) return;

    if (
      measureStatus.value === 'measuring_hr' &&
      wearCheckStatus.value === 'worn' &&
      isLegacyHeartStepFinished(currentStepRecords) &&
      getLatestHeartRateData(measureStepStartedAt)?.heartRate
    ) {
      measureProgress.value = Math.max(measureProgress.value, 25);
      advanceRwMeasureSoon(() => {
        if (measureStatus.value === 'measuring_hr') startHrvMeasurement();
      });
      return;
    }

    if (
      measureStatus.value === 'measuring_hrv' &&
      isLegacyHeartStepFinished(currentStepRecords) &&
      getLatestHrvData(measureStepStartedAt)?.heartRateVariability
    ) {
      measureProgress.value = Math.max(measureProgress.value, 50);
      advanceRwMeasureSoon(() => {
        if (measureStatus.value === 'measuring_hrv') startSpo2Measurement();
      }, 500);
      return;
    }

    if (
      measureStatus.value === 'measuring_spo2' &&
      isLegacyOxygenStepFinished(currentStepRecords) &&
      getLatestSpo2Data(measureStepStartedAt)?.bloodOxygen
    ) {
      measureProgress.value = Math.max(measureProgress.value, 75);
      advanceRwMeasureSoon(() => {
        if (measureStatus.value === 'measuring_spo2') startTemperatureMeasurement();
      }, 500);
      return;
    }

    const hasCompletedTemperature = currentStepRecords.some(
      (data: any) => data.type === 'active_Temperature' && data.temperatureStatus === 0x01
    );
    if (
      measureStatus.value === 'measuring_temp' &&
      (getLatestTemperatureData(measureStepStartedAt)?.temperature || hasCompletedTemperature)
    ) {
      quickProgressToCompletionPending();
      advanceRwMeasureSoon(() => {
        if (measureStatus.value === 'measuring_temp') completeMeasurement();
      }, 500);
    }
  },
  { deep: true }
);

const hydrateReportMetrics = () => {
  const latestHrData: any = getLatestHeartRateData();
  const latestHrvData: any = getLatestHrvData();
  const latestStressData: any = getLatestStressData();
  const latestBloodSugarData: any = getLatestBloodSugarData();
  const latestBloodPressureData: any = getLatestBloodPressureData();
  const latestSpo2Data: any = getLatestSpo2Data();
  const latestTempData: any = getLatestTemperatureData();

  const latestHeartRate = normalizeIntegerMetric(latestHrData?.heartRate);
  const latestHrv = normalizeIntegerMetric(latestHrvData?.heartRateVariability);
  const latestSpo2 = normalizeIntegerMetric(latestSpo2Data?.bloodOxygen);
  const latestTemperature = normalizeTemperatureMetric(latestTempData?.temperature);
  if (latestHeartRate != null) heartRate.value = latestHeartRate;
  if (latestHrv != null) heartRateVariability.value = latestHrv;
  if (latestStressData?.stressIndex) stressIndex.value = latestStressData.stressIndex;
  if (latestBloodSugarData?.bloodSugar) bloodSugar.value = latestBloodSugarData.bloodSugar;
  if (latestBloodPressureData?.systolic) systolic.value = latestBloodPressureData.systolic;
  if (latestBloodPressureData?.diastolic) diastolic.value = latestBloodPressureData.diastolic;
  if (latestSpo2 != null) spo2Value.value = latestSpo2;
  if (latestTemperature != null) temperature.value = latestTemperature;
};

const resetMeasurementValues = () => {
  heartRate.value = null;
  heartRateVariability.value = null;
  stressIndex.value = null;
  bloodSugar.value = null;
  systolic.value = null;
  diastolic.value = null;
  spo2Value.value = null;
  temperature.value = null;
};

const appendMetricParam = (params: string[], key: string, value: unknown) => {
  if (value == null || value === '') return;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  params.push(`${key}=${encodeURIComponent(`${numeric}`)}`);
};

const jumpDetail = async () => {
  hydrateReportMetrics();
  const params: string[] = [];
  const appendMetricAliases = (keys: string[], value: unknown) => {
    keys.forEach((key) => appendMetricParam(params, key, value));
  };

  appendMetricAliases(['heartRate', 'heart_rate', 'hr'], heartRate.value);
  appendMetricAliases(['spo2', 'SpO2', 'SPO2', 'bloodOxygen', 'blood_oxygen', 'oxygen'], spo2Value.value);
  appendMetricAliases(['temperature', 'bodyTemperature', 'body_temperature', 'bodyTemp'], temperature.value);
  appendMetricAliases(['heartRateVariability', 'heart_rate_variability', 'hrv', 'HRV'], heartRateVariability.value);
  appendMetricAliases(['stressIndex', 'stress_index', 'stress'], stressIndex.value);
  appendMetricAliases(['bloodSugar', 'blood_sugar', 'glucose'], bloodSugar.value);
  appendMetricAliases(['systolic', 'high', 'highPressure', 'bloodPressureHigh', 'sbp'], systolic.value);
  appendMetricAliases(['diastolic', 'low', 'lowPressure', 'bloodPressureLow', 'dbp'], diastolic.value);

  const hasBloodPressurePair =
    typeof systolic.value === 'number' && systolic.value > 0 && typeof diastolic.value === 'number' && diastolic.value > 0;
  if (hasBloodPressurePair) {
    const bloodPressure = `${systolic.value}/${diastolic.value}`;
    for (const key of ['bloodPressure', 'blood_pressure', 'bp']) {
      params.push(`${key}=${encodeURIComponent(bloodPressure)}`);
    }
  }

  uni.redirectTo({
    url: `/pagesA/healths/healthReport${params.length > 0 ? `?${params.join('&')}` : ''}`,
    fail: () => {
      uni.navigateBack();
    }
  });
};

watch(
  () => measureStatus.value,
  async (newStatus, oldStatus) => {
    if (newStatus !== 'completed' || oldStatus === 'completed') return;

    const latestHrData: any = getLatestHeartRateData();
    const latestHrvData: any = getLatestHrvData();
    const latestStressData: any = getLatestStressData();
    const latestBloodSugarData: any = getLatestBloodSugarData();
    const latestBloodPressureData: any = getLatestBloodPressureData();
    const latestSpo2Data: any = getLatestSpo2Data();
    const latestTempData: any = getLatestTemperatureData();
    const measurementRecord: submitDataType['dataList'][number] = {
      recordTime: formatRecordTime(new Date())
    };
    const latestHeartRate = normalizeIntegerMetric(latestHrData?.heartRate);
    const latestHrv = normalizeIntegerMetric(latestHrvData?.heartRateVariability);
    const latestSpo2 = normalizeIntegerMetric(latestSpo2Data?.bloodOxygen);
    const latestTemperature = normalizeTemperatureMetric(latestTempData?.temperature);
    if (latestHeartRate != null) measurementRecord.heartRate = latestHeartRate;
    if (latestHrv != null) measurementRecord.hrv = latestHrv;
    if (latestStressData?.stressIndex) measurementRecord.stress = latestStressData.stressIndex;
    if (latestBloodSugarData?.bloodSugar) measurementRecord.bloodSugar = latestBloodSugarData.bloodSugar;
    if (latestBloodPressureData?.systolic) measurementRecord.systolic = latestBloodPressureData.systolic;
    if (latestBloodPressureData?.diastolic) measurementRecord.diastolic = latestBloodPressureData.diastolic;
    if (latestSpo2 != null) measurementRecord.spo2 = latestSpo2;
    if (latestTemperature != null) measurementRecord.temperature = latestTemperature;

    if (
      measurementRecord.heartRate == null &&
      measurementRecord.spo2 == null &&
      measurementRecord.temperature == null &&
      measurementRecord.hrv == null
    ) {
      showMeasurementGuidance('no_data');
      return;
    }

    if (latestHeartRate != null) heartRate.value = latestHeartRate;
    if (latestHrv != null) heartRateVariability.value = latestHrv;
    if (latestStressData?.stressIndex) stressIndex.value = latestStressData.stressIndex;
    if (latestBloodSugarData?.bloodSugar) bloodSugar.value = latestBloodSugarData.bloodSugar;
    if (latestBloodPressureData?.systolic) systolic.value = latestBloodPressureData.systolic;
    if (latestBloodPressureData?.diastolic) diastolic.value = latestBloodPressureData.diastolic;
    if (latestSpo2 != null) spo2Value.value = latestSpo2;
    if (latestTemperature != null) temperature.value = latestTemperature;

    uni.showLoading({ title: '提交数据中...', mask: false });
    try {
      await submitData({
        deviceMac: getSubmitMac(),
        dataList: [measurementRecord]
      });
    } catch (error) {
      if (!isExpectedBleRuntimeError(error)) {
        formatBleErrorMessage(error);
      }
      uni.showToast({ title: '测量已完成，数据稍后同步', icon: 'none', duration: 1500 });
    } finally {
      uni.hideLoading();
    }

    jumpDetail();
  },
  { immediate: false }
);

const formatRecordTime = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

const handleMeasure = async () => {
  const { deviceId, serviceId } = userStore.deviceInfo;
  try {
    await resetMeasurementFlowForNewRun();
    measurementGuidance.value = '';
    resetMeasurementValues();
    clearRealtimeMeasurementRecords();

    if (deviceId) {
      const alreadyConnected = await isDeviceConnected(deviceId, serviceId || '');
      if (!alreadyConnected) {
        const restored = await autoConnectLastDevice();
        if (!restored) {
          await showRingConnectionTroubleshootingPrompt();
          return;
        }
      }
    } else {
      const restored = await autoConnectLastDevice();
      if (!restored) {
        await showRingConnectionTroubleshootingPrompt();
        return;
      }
    }

    await ensureCommunicationReady();
    if (!(await ensureRingWornBeforeMeasurement(() => queryCurrentWearState('heart_rate')))) return;
    wearCheckStatus.value = 'worn';
    // 建立本轮测量基线必须晚于连接和通信初始化，避免初始化阶段返回的缓存/历史指标被当成本次测量结果。
    clearRealtimeMeasurementRecords();
    resetMeasurementValues();
    measureProgress.value = 0;
    measureStartedAt = Date.now();
    startHrMeasurement();
  } catch (error) {
    if (!isExpectedBleRuntimeError(error)) {
      formatBleErrorMessage(error);
    }
    // 自动重连成功后仍可能在 GATT/通知初始化阶段失败。
    // 这些失败也属于“连接不上”，统一给用户可操作的排查入口。
    await showRingConnectionTroubleshootingPrompt();
  }
};

onLoad(async () => {
  clearRealtimeMeasurementRecords();
  await handleMeasure();
});

onUnload(() => {
  stopMeasurementFlow();
  measureStartedAt = 0;
  measureStepStartedAt = 0;
});

onHide(async () => {
  // Keep measurement alive while WeChat briefly hides the page during native BLE callbacks.
});
</script>
<template>
  <view class="measure-page">
    <uv-navbar placeholder leftIcon="" title="全面测量" bgColor="#f1f3f6"></uv-navbar>

    <view class="measure-hero">
      <view class="measure-hero-copy">
        <text class="measure-eyebrow">智能戒指健康检测</text>
        <text class="measure-title">{{ measureStatusText }}</text>
        <text class="measure-desc">{{ measureHintText }}</text>
      </view>
      <view class="measure-orbit">
        <view class="measure-ring"></view>
        <view class="measure-core">
          <text class="measure-percent">{{ measureProgress }}</text>
          <text class="measure-percent-unit">%</text>
        </view>
      </view>
    </view>

    <view class="progress-card">
      <view class="progress-header">
        <text>测量进度</text>
        <text>{{ measureProgress }}%</text>
      </view>
      <view class="progress-track">
        <view class="progress-fill" :style="{ width: `${measureProgress}%` }"></view>
      </view>
      <view class="step-list">
        <view
          v-for="item in measureStepItems"
          :key="item.key"
          class="step-item"
          :class="{ 'step-item--active': item.active, 'step-item--done': item.done }"
        >
          <view class="step-dot"></view>
          <view class="step-copy">
            <text class="step-label">{{ item.label }}</text>
            <text class="step-desc">{{ item.desc }}</text>
          </view>
        </view>
      </view>
    </view>

  </view>
</template>

<style lang="scss">
.measure-page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 30rpx;
  background: #f1f3f6;
}

.measure-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 360rpx;
  margin-top: 20rpx;
  padding: 42rpx 34rpx;
  border-radius: 42rpx;
  background: linear-gradient(135deg, #2e70fc 0%, #6b8eff 58%, #9ab5ff 100%);
  color: #ffffff;
  box-shadow: 0 24rpx 48rpx rgba(46, 112, 252, 0.18);
}

.measure-hero-copy {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-right: 28rpx;
}

.measure-eyebrow {
  font-size: 24rpx;
  opacity: 0.82;
}

.measure-title {
  margin-top: 18rpx;
  font-size: 46rpx;
  font-weight: 700;
  line-height: 1.18;
}

.measure-desc {
  margin-top: 18rpx;
  font-size: 26rpx;
  line-height: 1.5;
  opacity: 0.9;
}

.measure-orbit {
  position: relative;
  width: 220rpx;
  height: 220rpx;
  flex: 0 0 220rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  animation: float 3s ease-in-out infinite;
}

.measure-ring {
  position: absolute;
  inset: 16rpx;
  border: 10rpx solid rgba(255, 255, 255, 0.32);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 1.5s linear infinite;
}

.measure-core {
  position: absolute;
  inset: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  color: #2e70fc;
  border-radius: 50%;
  box-shadow: 0 16rpx 28rpx rgba(12, 45, 120, 0.16);
}

.measure-percent {
  font-size: 48rpx;
  font-weight: 800;
  line-height: 1;
}

.measure-percent-unit {
  margin-left: 4rpx;
  font-size: 24rpx;
  line-height: 1;
}

.progress-card {
  margin-top: 28rpx;
  padding: 34rpx;
  border-radius: 34rpx;
  background: #ffffff;
  box-shadow: 0 14rpx 32rpx rgba(31, 41, 55, 0.05);
}

.progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #111827;
  font-size: 30rpx;
  font-weight: 700;
}

.progress-track {
  height: 18rpx;
  margin-top: 26rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: #e8efff;
}

.progress-fill {
  height: 100%;
  border-radius: 999rpx;
  background: linear-gradient(90deg, #2e70fc, #7aa0ff);
  transition: width 0.25s ease;
}

.step-list {
  margin-top: 30rpx;
}

.step-item {
  display: flex;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 1rpx solid #f1f3f6;
}

.step-item:last-child {
  border-bottom: 0;
}

.step-dot {
  width: 22rpx;
  height: 22rpx;
  margin-right: 22rpx;
  border-radius: 50%;
  background: #d1d5db;
}

.step-item--active .step-dot {
  background: #2e70fc;
  box-shadow: 0 0 0 10rpx rgba(46, 112, 252, 0.12);
}

.step-item--done .step-dot {
  background: #27c184;
}

.step-copy {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
}

.step-label {
  color: #111827;
  font-size: 30rpx;
  font-weight: 600;
}

.step-desc {
  color: #8b95a5;
  font-size: 26rpx;
}

@keyframes float {
  0% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-20rpx);
  }
  100% {
    transform: translateY(0px);
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
