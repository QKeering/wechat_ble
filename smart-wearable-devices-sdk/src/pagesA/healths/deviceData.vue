<script setup lang="ts">
import '@/pagesA/healths/i18n/pack';
import { computed, ref, watch } from 'vue';
import { onBackPress, onHide, onLoad, onUnload } from '@dcloudio/uni-app';
import { useI18n } from '@/i18n';
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
import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';
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
  clearPendingLegacyWearMeasurement,
  waitForLegacyWearMeasurementIdle,
  refreshHealthData
} = useRingBLE();
const { runRwForegroundMeasurement, stopActiveRwMeasurement } = useRwForegroundMeasurement();
const userStore = useUserStore();

const { t } = useI18n();

const measureStatus = ref<'idle' | 'measuring_hr' | 'measuring_hrv' | 'measuring_spo2' | 'measuring_temp' | 'completed'>('idle');
const wearCheckStatus = ref<'idle' | 'checking' | 'worn'>('idle');
type MeasurementPreflightStage = 'connecting' | 'settling' | 'checking_wear' | 'measuring' | 'failed' | 'completed';
const preflightStage = ref<MeasurementPreflightStage>('connecting');
const measurementFailureTitle = ref('');
const measurementFailureMessage = ref('');
const isStartingMeasurement = ref(false);
const isRetryQueued = ref(false);
const heartRate = ref<number | null>(null);
const heartRateVariability = ref<number | null>(null);
const stressIndex = ref<number | null>(null);
const bloodSugar = ref<number | null>(null);
const systolic = ref<number | null>(null);
const diastolic = ref<number | null>(null);
const spo2Value = ref<number | null>(null);
const temperature = ref<number | null>(null);
const measureProgress = ref(0);
let spo2FallbackValue: number | null = null;

let progressAnimationTimer: ReturnType<typeof setInterval> | null = null;
let progressIntervals: ReturnType<typeof setInterval>[] = [];
let measureTimeout: ReturnType<typeof setTimeout> | null = null;
let rwAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
let measurePhaseTimer: ReturnType<typeof setTimeout> | null = null;
let flowTimeout: ReturnType<typeof setTimeout> | null = null;
let measureStartedAt = 0;
let measurementFlowStartedAt = 0;
let measureStepStartedAt = 0;
let measureStepReceivedDataStartIndex = 0;
let measurementRunToken = 0;
let isCompletingMeasurement = false;
let spo2FallbackLogged = false;
let spo2MissingLogged = false;

const DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS = 35000;
// 全面测量按“底层命令窗口”推进，而不是收到首帧就切换下一项。
// 心率与 HRV 复用同一条 30 秒命令；血氧保持 30 秒；温度至少采集 20 秒。
const HEART_HRV_MEASUREMENT_WINDOW_MS = 30_000;
const HEART_HRV_UI_PHASE_MS = 15_000;
const SPO2_MEASUREMENT_WINDOW_MS = 30_000;
const TEMPERATURE_MEASUREMENT_WINDOW_MS = 20_000;
const CONNECTION_READY_TIMEOUT_MS = 20_000;
const WEAR_CHECK_TIMEOUT_MS = 10_000;
const PREVIOUS_MEASUREMENT_SETTLE_TIMEOUT_MS = 12_000;
// 用户在测量中主动重试时，旧固件没有可靠的强制停止指令。
// 保持现有 BLE 连接，等待当前采集窗口自然释放后再复用同一连接启动下一轮。
const RETRY_MEASUREMENT_SETTLE_TIMEOUT_MS = 45_000;
const FULL_MEASUREMENT_TIMEOUT_MS = 180_000;

// 失败标题/说明以中文原文保存（setMeasurementFailure 需要按关键字分类），展示时再翻译。
const measureStatusText = computed(() => {
  if (preflightStage.value === 'failed') return t(measurementFailureTitle.value || '测量未完成');
  if (preflightStage.value === 'settling') return t('正在结束上次测量');
  if (preflightStage.value === 'checking_wear') return t('正在确认佩戴');
  if (preflightStage.value === 'connecting') return t('正在连接设备');
  const statusMap = {
    idle: '准备测量',
    measuring_hr: '正在测量心率',
    measuring_hrv: '正在测量心率变异性',
    measuring_spo2: '正在测量血氧',
    measuring_temp: '正在测量皮肤温度',
    completed: '测量完成'
  };
  return t(statusMap[measureStatus.value] || '准备测量');
});

const measureHintText = computed(() => {
  if (preflightStage.value === 'failed') return t(measurementFailureMessage.value);
  if (preflightStage.value === 'settling') return t('正在等待戒指结束上一轮测量，请稍候');
  if (preflightStage.value === 'checking_wear') return t('请正确佩戴戒指并保持手部静止');
  if (preflightStage.value === 'connecting') return t('正在连接戒指，请稍候');
  if (measureStatus.value === 'completed') return t('检测完成，正在整理报告');
  return t('请保持手部静止，戒指贴合手指，测量期间不要退出页面');
});

const measureStepOrder = ['measuring_hr', 'measuring_hrv', 'measuring_spo2', 'measuring_temp'] as const;

const getMeasureStepDesc = (stepStatus: (typeof measureStepOrder)[number], valueText: string | null) => {
  if (wearCheckStatus.value === 'checking') return t('等待测量');
  if (measureStatus.value === stepStatus) return t('测量中');
  if (valueText) return valueText;
  if (measureStatus.value === 'completed') return t('等待数据');

  const currentIndex = measureStepOrder.indexOf(measureStatus.value as (typeof measureStepOrder)[number]);
  if (currentIndex < 0) return t('等待测量');
  return measureStepOrder.indexOf(stepStatus) < currentIndex ? t('等待数据') : t('等待测量');
};

const measureStepItems = computed(() => [
  {
    key: 'heart-rate',
    label: t('心率'),
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
    label: t('血氧'),
    desc: getMeasureStepDesc('measuring_spo2', spo2Value.value ? `${spo2Value.value}%` : null),
    active: wearCheckStatus.value === 'worn' && measureStatus.value === 'measuring_spo2',
    done: ['measuring_temp', 'completed'].includes(measureStatus.value) || Boolean(spo2Value.value)
  },
  {
    key: 'skin-temperature',
    label: t('皮肤温度'),
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
const getFullMeasurementDiagnosticContext = (extra: Record<string, unknown> = {}) => {
  const deviceInfo = (userStore.deviceInfo || {}) as Record<string, any>;
  return {
    entry: 'full_measurement',
    occurredAt: new Date().toISOString(),
    userId: Number(userStore.userInfo?.id) || undefined,
    deviceMac: getSubmitMac() || deviceInfo.mac || deviceInfo.uniMacId || deviceInfo.deviceId || '',
    deviceName: deviceInfo.name || '',
    protocol: resolveRingProtocol(deviceInfo),
    connected: Boolean(userStore.isConnected),
    preflightStage: preflightStage.value,
    measureStatus: measureStatus.value,
    wearCheckStatus: wearCheckStatus.value,
    progress: measureProgress.value,
    elapsedMs: measurementFlowStartedAt ? Date.now() - measurementFlowStartedAt : 0,
    stepElapsedMs: measureStepStartedAt ? Date.now() - measureStepStartedAt : 0,
    values: {
      heartRate: heartRate.value,
      hrv: heartRateVariability.value,
      spo2: spo2Value.value,
      temperature: temperature.value
    },
    ...extra
  };
};
const logFullMeasurementAnomaly = (event: string, extra: Record<string, unknown> = {}) => {
  appendRingDiagnosticLog('FULL MEASURE', event, getFullMeasurementDiagnosticContext(extra));
};
const describeDiagnosticError = (error: unknown) => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error ?? 'unknown error');
};

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
const getCurrentStepRecords = () => (userStore.receivedData || []).slice(measureStepReceivedDataStartIndex);
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

const clearMeasurePhaseTimer = () => {
  if (!measurePhaseTimer) return;
  clearTimeout(measurePhaseTimer);
  measurePhaseTimer = null;
};

const clearFlowTimeout = () => {
  if (!flowTimeout) return;
  clearTimeout(flowTimeout);
  flowTimeout = null;
};

const clearMeasurementTimers = () => {
  clearMeasureTimeout();
  clearRwAdvanceTimer();
  clearMeasurePhaseTimer();
  clearFlowTimeout();
  if (progressAnimationTimer) {
    clearInterval(progressAnimationTimer);
    progressAnimationTimer = null;
  }
  clearAllProgressIntervals();
};

const stopMeasurementFlow = () => {
  measurementRunToken += 1;
  isRetryQueued.value = false;
  isCompletingMeasurement = false;
  clearMeasurementTimers();
  void stopActiveRwMeasurement('RW PAGE');
  clearPendingLegacyWearMeasurement();
  wearCheckStatus.value = 'idle';
  measureStatus.value = 'idle';
};

const resetMeasurementFlowForNewRun = async () => {
  measurementRunToken += 1;
  isCompletingMeasurement = false;
  clearMeasurementTimers();
  measureStartedAt = 0;
  measurementFlowStartedAt = 0;
  measureStepStartedAt = 0;
  measureStepReceivedDataStartIndex = 0;
  spo2FallbackLogged = false;
  spo2MissingLogged = false;
  measureProgress.value = 0;
  wearCheckStatus.value = 'idle';
  measureStatus.value = 'idle';
  preflightStage.value = 'settling';
  measurementFailureTitle.value = '';
  measurementFailureMessage.value = '';
  clearPendingLegacyWearMeasurement();
  await withTimeout(stopActiveRwMeasurement('RW PAGE'), 4_000, '清理上一轮测量超时').catch((error) => {
    logFullMeasurementAnomaly('full-measurement-previous-release-error', {
      error: describeDiagnosticError(error)
    });
  });
};

const withTimeout = <T>(task: Promise<T>, timeoutMs: number, message: string) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([task, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
};

const setMeasurementFailure = (title: string, message: string) => {
  const event = title.includes('超时')
    ? 'full-measurement-timeout-error'
    : title.includes('佩戴')
      ? 'full-measurement-wear-blocked'
      : title.includes('连接')
        ? 'full-measurement-connection-error'
        : title.includes('繁忙') || title.includes('上一轮')
          ? 'full-measurement-device-busy-error'
          : 'full-measurement-error';
  logFullMeasurementAnomaly(event, { title, message });
  measurementRunToken += 1;
  isRetryQueued.value = false;
  isCompletingMeasurement = false;
  clearMeasurementTimers();
  void stopActiveRwMeasurement('RW PAGE');
  clearPendingLegacyWearMeasurement();
  wearCheckStatus.value = 'idle';
  measureStatus.value = 'idle';
  measureProgress.value = 0;
  measurementFailureTitle.value = title;
  measurementFailureMessage.value = message;
  preflightStage.value = 'failed';
};

const armFullMeasurementTimeout = (runToken: number) => {
  clearFlowTimeout();
  flowTimeout = setTimeout(() => {
    if (runToken !== measurementRunToken || preflightStage.value === 'completed') return;
    setMeasurementFailure('测量超时', '本次测量未能在规定时间内完成，请保持戒指贴合手指后重新测量。');
  }, FULL_MEASUREMENT_TIMEOUT_MS);
};

const showMeasurementGuidance = (kind: 'not_worn' | 'charging' | 'no_data') => {
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
  setMeasurementFailure(guidance.title, guidance.content);
};

const sendMeasurementCommand = async (
  task: () => Promise<unknown>,
  expectedSteps: string | string[],
  minActiveMs: number
) => {
  try {
    const expectedMetric = Array.isArray(expectedSteps) ? expectedSteps[0] : expectedSteps;
    if (isRwDevice() && isRwForegroundMetric(expectedMetric)) {
      await runRwForegroundMeasurement(expectedMetric, {
        startedAt: measureStepStartedAt || measureStartedAt,
        minActiveMs,
        measureStatus: () => measureStatus.value,
        source: 'RW PAGE'
      });
      return true;
    }
    await requestMetricRefresh(refreshHealthData, task, { expectedSteps });
    return true;
  } catch (error) {
    logFullMeasurementAnomaly('full-measurement-command-error', {
      expectedSteps: Array.isArray(expectedSteps) ? expectedSteps.join(',') : expectedSteps,
      error: describeDiagnosticError(error)
    });
    if (!isExpectedBleRuntimeError(error)) {
      formatBleErrorMessage(error);
    }
    if (wearCheckStatus.value === 'checking') {
      showMeasurementGuidance('no_data');
      return false;
    }
    setMeasurementFailure('测量指令发送失败', '戒指未能开始本轮测量，请保持设备连接后重新测量。');
    return false;
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

const advanceMeasureAtWindowEnd = (next: () => void, minActiveMs: number, delay = 300) => {
  clearMeasureTimeout();
  // Promise 回调与 store watcher 可能同时发现有效值；只保留第一次推进计划，
  // 避免重复重置定时器导致阶段等待时间被不断延长。
  if (rwAdvanceTimer) return;
  const stepRemainingMs = Math.max(0, minActiveMs - (Date.now() - measureStepStartedAt));
  rwAdvanceTimer = setTimeout(() => {
    rwAdvanceTimer = null;
    clearAllProgressIntervals();
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

const freezeHeartHrvWindowResults = (startedAt = measureStepStartedAt) => {
  const latestHeartRate = normalizeIntegerMetric(getLatestHeartRateData(startedAt)?.heartRate);
  const latestHrv = normalizeIntegerMetric(getLatestHrvData(startedAt)?.heartRateVariability);
  const latestStress = normalizeIntegerMetric(
    getLatestStressData(startedAt)?.stressIndex ?? getLatestStressData(startedAt)?.stress
  );
  if (latestHeartRate != null) heartRate.value = latestHeartRate;
  if (latestHrv != null) heartRateVariability.value = latestHrv;
  if (latestStress != null) stressIndex.value = latestStress;
};

const freezeSpo2WindowResult = (startedAt = measureStepStartedAt) => {
  const latestSpo2 = normalizeIntegerMetric(getLatestSpo2Data(startedAt)?.bloodOxygen);
  if (latestSpo2 != null) {
    spo2Value.value = latestSpo2;
    return;
  }
  // 本轮采集窗口没有返回合法血氧时，才使用进入页面前保存的用户最近有效值。
  // 不使用固定 97/98，避免给不同用户伪造相同的“测量结果”。
  if (spo2Value.value == null && spo2FallbackValue != null) {
    spo2Value.value = spo2FallbackValue;
    if (!spo2FallbackLogged) {
      spo2FallbackLogged = true;
      logFullMeasurementAnomaly('full-measurement-spo2-fallback', {
        reason: 'current-window-no-valid-spo2',
        fallbackValue: spo2FallbackValue
      });
    }
    return;
  }
  if (!spo2MissingLogged) {
    spo2MissingLogged = true;
    logFullMeasurementAnomaly('full-measurement-spo2-missing-error', {
      reason: 'current-window-and-history-have-no-valid-spo2'
    });
  }
};

const freezeTemperatureWindowResult = (startedAt = measureStepStartedAt) => {
  const latestTemperature = normalizeTemperatureMetric(getLatestTemperatureData(startedAt)?.temperature);
  if (latestTemperature != null) temperature.value = latestTemperature;
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
  clearMeasurePhaseTimer();
  if (!isRwDevice()) {
    measurePhaseTimer = setTimeout(() => {
      measurePhaseTimer = null;
      if (runToken !== measurementRunToken || measureStatus.value !== 'measuring_hr') return;
      startHrvMeasurement();
    }, HEART_HRV_UI_PHASE_MS);
  }
  void sendMeasurementCommand(
    sendActiveMeasureCommand,
    isRwDevice() ? 'heart_rate' : ['heart_rate', 'hrv'],
    HEART_HRV_MEASUREMENT_WINDOW_MS
  ).then((started) => {
    if (
      started &&
      runToken === measurementRunToken &&
      (isRwDevice() ? measureStatus.value === 'measuring_hr' : ['measuring_hr', 'measuring_hrv'].includes(measureStatus.value))
    ) {
      wearCheckStatus.value = 'worn';
      advanceMeasureAtWindowEnd(() => {
        if (isRwDevice()) {
          if (measureStatus.value !== 'measuring_hr') return;
          freezeHeartHrvWindowResults(stepStartedAt);
          startHrvMeasurement();
          return;
        }
        if (!['measuring_hr', 'measuring_hrv'].includes(measureStatus.value)) return;
        freezeHeartHrvWindowResults(stepStartedAt);
        startSpo2Measurement();
      }, HEART_HRV_MEASUREMENT_WINDOW_MS);
    }
  });
  pushProgressInterval(25, 'measuring_hr');
  measureTimeout = setTimeout(() => {
    if (runToken !== measurementRunToken || !['measuring_hr', 'measuring_hrv'].includes(measureStatus.value)) return;
    if (wearCheckStatus.value === 'checking') {
      showMeasurementGuidance('no_data');
      return;
    }
    freezeHeartHrvWindowResults(stepStartedAt);
    if (isRwDevice() && measureStatus.value === 'measuring_hr') startHrvMeasurement();
    else startSpo2Measurement();
  }, DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS);
};

const startHrvMeasurement = () => {
  if (measureStatus.value !== 'measuring_hr') return;
  measureProgress.value = Math.max(measureProgress.value, 25);
  clearAllProgressIntervals();
  if (!isRwDevice()) {
    // 旧协议 HRV 与心率来自同一条正式测量命令。这里只切换 UI 阶段，
    // 不重置采集起点，也绝不再次下发命令。
    measureStatus.value = 'measuring_hrv';
    pushProgressInterval(50, 'measuring_hrv');
    return;
  }

  const runToken = measurementRunToken;
  beginMeasurementStep('measuring_hrv');
  const stepStartedAt = measureStepStartedAt;
  clearMeasureTimeout();
  void sendMeasurementCommand(
    sendActiveMeasureCommand,
    'hrv',
    HEART_HRV_MEASUREMENT_WINDOW_MS
  ).then((started) => {
    if (!started || runToken !== measurementRunToken || measureStatus.value !== 'measuring_hrv') return;
    advanceMeasureAtWindowEnd(() => {
      if (measureStatus.value !== 'measuring_hrv') return;
      freezeHeartHrvWindowResults(stepStartedAt);
      startSpo2Measurement();
    }, HEART_HRV_MEASUREMENT_WINDOW_MS, 500);
  });
  pushProgressInterval(50, 'measuring_hrv');
  measureTimeout = setTimeout(() => {
    if (runToken !== measurementRunToken || measureStatus.value !== 'measuring_hrv') return;
    freezeHeartHrvWindowResults(stepStartedAt);
    startSpo2Measurement();
  }, DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS);
};

const startSpo2Measurement = () => {
  const runToken = measurementRunToken;
  clearMeasurePhaseTimer();
  beginMeasurementStep('measuring_spo2');
  const stepStartedAt = measureStepStartedAt;
  clearAllProgressIntervals();
  clearMeasureTimeout();
  void sendMeasurementCommand(
    sendOxyGenCommand,
    'blood_oxygen',
    SPO2_MEASUREMENT_WINDOW_MS
  ).then((started) => {
    if (
      started &&
      runToken === measurementRunToken &&
      measureStatus.value === 'measuring_spo2'
    ) {
      advanceMeasureAtWindowEnd(() => {
        if (measureStatus.value !== 'measuring_spo2') return;
        freezeSpo2WindowResult(stepStartedAt);
        startTemperatureMeasurement();
      }, SPO2_MEASUREMENT_WINDOW_MS, 500);
    }
  });
  pushProgressInterval(75, 'measuring_spo2');
  measureTimeout = setTimeout(() => {
    if (runToken === measurementRunToken && measureStatus.value === 'measuring_spo2') {
      freezeSpo2WindowResult(stepStartedAt);
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
  void sendMeasurementCommand(
    sendBodyTemperatureCommand,
    'temperature',
    TEMPERATURE_MEASUREMENT_WINDOW_MS
  ).then((started) => {
    if (
      started &&
      runToken === measurementRunToken &&
      measureStatus.value === 'measuring_temp' &&
      (isRwDevice() || getCurrentStepRecords().some(
        (data: any) => data.type === 'active_Temperature' && data.temperatureStatus === 0x01
      ))
    ) {
      quickProgressToCompletionPending();
      advanceMeasureAtWindowEnd(() => {
        if (measureStatus.value !== 'measuring_temp') return;
        freezeTemperatureWindowResult(stepStartedAt);
        void completeMeasurement();
      }, TEMPERATURE_MEASUREMENT_WINDOW_MS, 500);
    }
  });
  pushProgressInterval(99, 'measuring_temp');
  measureTimeout = setTimeout(() => {
    if (runToken === measurementRunToken && measureStatus.value === 'measuring_temp') {
      freezeTemperatureWindowResult(stepStartedAt);
      void completeMeasurement();
    }
  }, DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS);
};

const completeMeasurement = async () => {
  if (measureStatus.value === 'completed' || isCompletingMeasurement) return;
  isCompletingMeasurement = true;
  const runToken = measurementRunToken;
  clearMeasureTimeout();
  clearRwAdvanceTimer();
  clearMeasurePhaseTimer();
  if (progressAnimationTimer) {
    clearInterval(progressAnimationTimer);
    progressAnimationTimer = null;
  }
  clearAllProgressIntervals();
  clearFlowTimeout();
  // 先释放当前协议的测量占用，再把页面置为完成；结果页不能早于 BLE 资源释放。
  await withTimeout(stopActiveRwMeasurement('RW PAGE'), 4_000, '结束测量超时').catch((error) => {
    logFullMeasurementAnomaly('full-measurement-release-timeout-error', {
      error: describeDiagnosticError(error)
    });
  });
  if (runToken !== measurementRunToken) {
    isCompletingMeasurement = false;
    return;
  }
  clearPendingLegacyWearMeasurement();
  measureProgress.value = 100;
  measureStatus.value = 'completed';
  preflightStage.value = 'completed';
  isCompletingMeasurement = false;
};

watch(
  () => [userStore.receivedData, userStore.latestMetrics, userStore.healthData],
  () => {
    if (!['measuring_temp', 'measuring_hr', 'measuring_hrv', 'measuring_spo2'].includes(measureStatus.value)) return;
    const receivedData = userStore.receivedData || [];
    const currentStepRecords = receivedData.slice(measureStepReceivedDataStartIndex);
    // 整轮全面测量只在 handleMeasure 的前置流程中确认一次佩戴状态。
    // 进入正式测量后，心率、HRV、血氧、温度可能交错补发不同 frameId 的状态帧；
    // 这些帧只用于提取当前指标，不能再次触发佩戴门禁并推翻已确认的 worn。

    if (isRwDevice() && measureStatus.value === 'measuring_spo2' && getLatestSpo2Data(measureStepStartedAt)?.bloodOxygen) {
      measureProgress.value = Math.max(measureProgress.value, 75);
      const stepStartedAt = measureStepStartedAt;
      advanceMeasureAtWindowEnd(() => {
        if (measureStatus.value !== 'measuring_spo2') return;
        freezeSpo2WindowResult(stepStartedAt);
        startTemperatureMeasurement();
      }, SPO2_MEASUREMENT_WINDOW_MS, 500);
      return;
    }

    if (isRwDevice() && measureStatus.value === 'measuring_temp' && getLatestTemperatureData(measureStepStartedAt)?.temperature) {
      quickProgressToCompletionPending();
      const stepStartedAt = measureStepStartedAt;
      advanceMeasureAtWindowEnd(() => {
        if (measureStatus.value !== 'measuring_temp') return;
        freezeTemperatureWindowResult(stepStartedAt);
        void completeMeasurement();
      }, TEMPERATURE_MEASUREMENT_WINDOW_MS, 500);
      return;
    }

    if (isRwDevice()) return;

    if (
      measureStatus.value === 'measuring_spo2' &&
      getLatestSpo2Data(measureStepStartedAt)?.bloodOxygen
    ) {
      measureProgress.value = Math.max(measureProgress.value, 75);
      const stepStartedAt = measureStepStartedAt;
      advanceMeasureAtWindowEnd(() => {
        if (measureStatus.value !== 'measuring_spo2') return;
        freezeSpo2WindowResult(stepStartedAt);
        startTemperatureMeasurement();
      }, SPO2_MEASUREMENT_WINDOW_MS, 500);
      return;
    }

    const hasCompletedTemperature = currentStepRecords.some(
      (data: any) => data.type === 'active_Temperature' && data.temperatureStatus === 0x01
    );
    if (
      measureStatus.value === 'measuring_temp' &&
      hasCompletedTemperature
    ) {
      quickProgressToCompletionPending();
      const stepStartedAt = measureStepStartedAt;
      advanceMeasureAtWindowEnd(() => {
        if (measureStatus.value !== 'measuring_temp') return;
        freezeTemperatureWindowResult(stepStartedAt);
        void completeMeasurement();
      }, TEMPERATURE_MEASUREMENT_WINDOW_MS, 500);
    }
  },
  { deep: true }
);

const hydrateReportMetrics = () => {
  const latestStressData: any = getLatestStressData();
  const latestBloodSugarData: any = getLatestBloodSugarData();
  const latestBloodPressureData: any = getLatestBloodPressureData();

  // 四项核心结果已经在各自采集窗口结束时冻结，报告阶段不能再从 store
  // 读取窗口外的迟到帧覆盖本轮最终结果。
  if (stressIndex.value == null && latestStressData?.stressIndex) stressIndex.value = latestStressData.stressIndex;
  if (latestBloodSugarData?.bloodSugar) bloodSugar.value = latestBloodSugarData.bloodSugar;
  if (latestBloodPressureData?.systolic) systolic.value = latestBloodPressureData.systolic;
  if (latestBloodPressureData?.diastolic) diastolic.value = latestBloodPressureData.diastolic;
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

    const latestStressData: any = getLatestStressData();
    const latestBloodSugarData: any = getLatestBloodSugarData();
    const latestBloodPressureData: any = getLatestBloodPressureData();
    const measurementRecord: submitDataType['dataList'][number] = {
      recordTime: formatRecordTime(new Date())
    };
    // 核心指标只使用各采集窗口结束时冻结的最终值。
    const latestHeartRate = heartRate.value;
    const latestHrv = heartRateVariability.value;
    const latestSpo2 = spo2Value.value;
    const latestTemperature = temperature.value;
    if (latestHeartRate != null) measurementRecord.heartRate = latestHeartRate;
    if (latestHrv != null) measurementRecord.hrv = latestHrv;
    if (stressIndex.value != null) measurementRecord.stress = stressIndex.value;
    else if (latestStressData?.stressIndex) measurementRecord.stress = latestStressData.stressIndex;
    if (latestBloodSugarData?.bloodSugar) measurementRecord.bloodSugar = latestBloodSugarData.bloodSugar;
    if (latestBloodPressureData?.systolic) measurementRecord.systolic = latestBloodPressureData.systolic;
    if (latestBloodPressureData?.diastolic) measurementRecord.diastolic = latestBloodPressureData.diastolic;
    if (latestSpo2 != null) measurementRecord.spo2 = latestSpo2;
    if (latestTemperature != null) measurementRecord.temperature = latestTemperature;

    const missingCoreMetrics = [
      measurementRecord.heartRate == null ? 'heart_rate' : '',
      measurementRecord.hrv == null ? 'hrv' : '',
      measurementRecord.spo2 == null ? 'spo2' : '',
      measurementRecord.temperature == null ? 'temperature' : ''
    ].filter(Boolean);
    if (missingCoreMetrics.length > 0) {
      logFullMeasurementAnomaly('full-measurement-partial-result-error', {
        missingMetrics: missingCoreMetrics,
        usedSpo2Fallback: spo2FallbackLogged
      });
    }

    if (
      measurementRecord.heartRate == null &&
      measurementRecord.spo2 == null &&
      measurementRecord.temperature == null &&
      measurementRecord.hrv == null
    ) {
      showMeasurementGuidance('no_data');
      return;
    }

    if (stressIndex.value == null && latestStressData?.stressIndex) stressIndex.value = latestStressData.stressIndex;
    if (latestBloodSugarData?.bloodSugar) bloodSugar.value = latestBloodSugarData.bloodSugar;
    if (latestBloodPressureData?.systolic) systolic.value = latestBloodPressureData.systolic;
    if (latestBloodPressureData?.diastolic) diastolic.value = latestBloodPressureData.diastolic;

    uni.showLoading({ title: t('提交数据中...'), mask: false });
    try {
      await submitData({
        deviceMac: getSubmitMac(),
        dataList: [measurementRecord]
      });
    } catch (error) {
      logFullMeasurementAnomaly('full-measurement-submit-error', {
        error: describeDiagnosticError(error),
        submittedMetrics: Object.keys(measurementRecord).filter((key) => key !== 'recordTime')
      });
      if (!isExpectedBleRuntimeError(error)) {
        formatBleErrorMessage(error);
      }
      uni.showToast({ title: t('测量已完成，数据稍后同步'), icon: 'none', duration: 1500 });
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

const handleMeasure = async (forceRestart = false) => {
  if (isStartingMeasurement.value) return;
  isStartingMeasurement.value = true;
  isRetryQueued.value = false;
  const { deviceId, serviceId } = userStore.deviceInfo;
  let runToken = measurementRunToken;
  try {
    // 重新测量只清理测量会话和计时器，严禁主动断开 BLE、关闭 Notify 或重新扫描。
    // 下方连接检查在当前连接健康时会直接复用已有 GATT 连接。
    await resetMeasurementFlowForNewRun();
    measurementFlowStartedAt = Date.now();
    runToken = measurementRunToken;
    armFullMeasurementTimeout(runToken);
    resetMeasurementValues();
    clearRealtimeMeasurementRecords();

    preflightStage.value = 'settling';
    const settleTimeoutMs = forceRestart
      ? RETRY_MEASUREMENT_SETTLE_TIMEOUT_MS
      : PREVIOUS_MEASUREMENT_SETTLE_TIMEOUT_MS;
    const previousMeasurementSettled = await withTimeout(
      waitForLegacyWearMeasurementIdle(settleTimeoutMs),
      settleTimeoutMs + 1_000,
      '等待上一轮测量结束超时'
    );
    if (runToken !== measurementRunToken) return;
    if (!previousMeasurementSettled) {
      setMeasurementFailure(
        '设备正在结束上一轮测量',
        '戒指仍在结束上一轮采集，请稍候片刻后重新测量。'
      );
      return;
    }

    preflightStage.value = 'connecting';
    if (deviceId) {
      const alreadyConnected = await withTimeout(
        isDeviceConnected(deviceId, serviceId || ''),
        CONNECTION_READY_TIMEOUT_MS,
        '连接状态检查超时'
      );
      if (!alreadyConnected) {
        const restored = await withTimeout(
          autoConnectLastDevice(),
          CONNECTION_READY_TIMEOUT_MS,
          '连接戒指超时'
        );
        if (!restored) {
          setMeasurementFailure('戒指连接失败', '未能连接戒指，请确认戒指有电且靠近手机后重新测量。');
          return;
        }
      }
    } else {
      const restored = await withTimeout(
        autoConnectLastDevice(),
        CONNECTION_READY_TIMEOUT_MS,
        '连接戒指超时'
      );
      if (!restored) {
        setMeasurementFailure('戒指连接失败', '未能连接戒指，请确认戒指有电且靠近手机后重新测量。');
        return;
      }
    }

    await withTimeout(ensureCommunicationReady(), CONNECTION_READY_TIMEOUT_MS, '设备通信初始化超时');
    if (runToken !== measurementRunToken) return;

    preflightStage.value = 'checking_wear';
    wearCheckStatus.value = 'checking';
    const wearResult = await withTimeout(
      queryCurrentWearState('heart_rate', WEAR_CHECK_TIMEOUT_MS),
      WEAR_CHECK_TIMEOUT_MS + 1_000,
      '佩戴状态确认超时'
    );
    if (runToken !== measurementRunToken) return;
    if (!wearResult.supported || wearResult.state !== 'worn') {
      const wearRecord = (wearResult.record || {}) as Record<string, any>;
      const wearStatus = Number(
        wearRecord.heartbeatStatus ??
          wearRecord.bloodOxygenStatus ??
          wearRecord.temperatureStatus ??
          wearRecord.metrics?.status ??
          wearRecord.raw?.heartbeatStatus ??
          wearRecord.raw?.bloodOxygenStatus
      );
      if (wearStatus === 0x04) {
        setMeasurementFailure('设备繁忙', '戒指仍在结束上一轮测量，请稍候片刻后重新测量。');
      } else {
        showMeasurementGuidance(wearResult.state === 'charging' ? 'charging' : wearResult.state === 'not_worn' ? 'not_worn' : 'no_data');
      }
      return;
    }

    wearCheckStatus.value = 'worn';
    preflightStage.value = 'measuring';
    // 建立本轮测量基线必须晚于连接和通信初始化，避免初始化阶段返回的缓存/历史指标被当成本次测量结果。
    clearRealtimeMeasurementRecords();
    resetMeasurementValues();
    measureProgress.value = 0;
    measureStartedAt = Date.now();
    startHrMeasurement();
  } catch (error) {
    // 用户在前置流程中再次点了重新测量时，旧流程的异常属于已取消会话，
    // 不能覆盖排队中的新一轮状态或把按钮重新变成失败态。
    if (runToken !== measurementRunToken) return;
    const message = t(formatBleErrorMessage(error));
    if (!isExpectedBleRuntimeError(error)) formatBleErrorMessage(error);
    if (preflightStage.value === 'checking_wear') {
      setMeasurementFailure('佩戴状态确认失败', t('{message}，请保持戒指贴合手指后重新测量。', { message }));
    } else if (preflightStage.value !== 'failed') {
      setMeasurementFailure('戒指连接失败', t('{message}，请确认戒指靠近手机后重新测量。', { message }));
    }
  } finally {
    isStartingMeasurement.value = false;
    if (isRetryQueued.value) {
      isRetryQueued.value = false;
      void handleMeasure(true);
    }
  }
};

const handleRetryMeasurement = () => {
  if (isRetryQueued.value) return;
  if (isStartingMeasurement.value) {
    // 前置连接、旧采集窗口释放和佩戴门禁都是异步步骤，不能并发启动第二套命令。
    // 先使当前运行令牌失效；待当前 await 返回到 finally 后，再复用现有连接启动排队的新一轮。
    isRetryQueued.value = true;
    measurementRunToken += 1;
    isCompletingMeasurement = false;
    clearMeasurementTimers();
    clearPendingLegacyWearMeasurement();
    void stopActiveRwMeasurement('RW PAGE');
    wearCheckStatus.value = 'idle';
    measureStatus.value = 'idle';
    measureProgress.value = 0;
    measurementFailureTitle.value = '';
    measurementFailureMessage.value = '';
    preflightStage.value = 'settling';
    return;
  }
  void handleMeasure(true);
};

const handleBack = () => {
  stopMeasurementFlow();
  uni.navigateBack();
};

onLoad(async () => {
  spo2FallbackValue = normalizeIntegerMetric(getLatestSpo2Data(0)?.bloodOxygen);
  clearRealtimeMeasurementRecords();
  await handleMeasure();
});

onUnload(() => {
  stopMeasurementFlow();
  measureStartedAt = 0;
  measurementFlowStartedAt = 0;
  measureStepStartedAt = 0;
  spo2FallbackValue = null;
});

onBackPress(() => {
  stopMeasurementFlow();
  return false;
});

onHide(async () => {
  // Keep measurement alive while WeChat briefly hides the page during native BLE callbacks.
});
</script>
<template>
  <view class="measure-page">
    <uv-navbar
      placeholder
      leftIcon="arrow-left"
      :title="t('全面测量')"
      bgColor="#f1f3f6"
      @leftClick="handleBack"
    ></uv-navbar>

    <view class="measure-hero">
      <view class="measure-hero-copy">
        <text class="measure-eyebrow">{{ t('智能戒指健康检测') }}</text>
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
        <text>{{ t('测量进度') }}</text>
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

    <view v-if="preflightStage === 'failed'" class="measure-actions">
      <button class="measure-action measure-action--primary" hover-class="measure-action--pressed" @click="handleRetryMeasurement">
        {{ t('重新测量') }}
      </button>
      <button class="measure-action measure-action--secondary" hover-class="measure-action--pressed" @click="handleBack">
        {{ t('返回') }}
      </button>
    </view>

    <view v-else-if="preflightStage !== 'completed'" class="measure-retry">
      <button
        class="measure-action measure-action--secondary"
        hover-class="measure-action--pressed"
        :disabled="isRetryQueued"
        @click="handleRetryMeasurement"
      >
        {{ isRetryQueued ? t('正在重新测量') : t('重新测量') }}
      </button>
      <text class="measure-retry__hint">
        {{ preflightStage === 'settling' ? t('保持戒指连接，等待上一轮采集释放后自动重试') : t('保持戒指连接，仅重置本轮测量') }}
      </text>
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

.measure-actions {
  display: flex;
  gap: 20rpx;
  margin-top: 28rpx;
}

.measure-action {
  flex: 1;
  height: 88rpx;
  margin: 0;
  border-radius: 22rpx;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 88rpx;
}

.measure-action::after {
  border: 0;
}

.measure-action--primary {
  background: #2e70fc;
  color: #ffffff;
}

.measure-action--secondary {
  border: 2rpx solid #b9cbff;
  background: #ffffff;
  color: #2e70fc;
}

.measure-action--pressed {
  opacity: 0.78;
}

.measure-retry {
  margin-top: 28rpx;
  text-align: center;
}

.measure-retry .measure-action {
  width: 100%;
}

.measure-retry__hint {
  display: block;
  margin-top: 12rpx;
  color: #8b95a5;
  font-size: 24rpx;
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
