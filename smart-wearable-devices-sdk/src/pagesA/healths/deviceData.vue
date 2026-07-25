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
import { submitData } from '@/common/api/homeDetail';
import type { submitDataType } from '@/types/api/homeDetail';

const {
  isDeviceConnected,
  autoConnectLastDevice,
  ensureCommunicationReady,
  sendOxyGenCommand,
  sendActiveMeasureCommand,
  sendBodyTemperatureCommand,
  refreshHealthData
} = useRingBLE();
const { runRwForegroundMeasurement, stopActiveRwMeasurement } = useRwForegroundMeasurement();
const userStore = useUserStore();

const measureStatus = ref<'idle' | 'measuring_hr' | 'measuring_hrv' | 'measuring_spo2' | 'measuring_temp' | 'completed'>('idle');
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

const DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS = 35000;
const RW_OPTIONAL_TEMPERATURE_TIMEOUT_MS = 8000;

const measureStatusText = computed(() => {
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
  if (measureStatus.value === 'completed') return '检测完成，正在整理报告';
  if (measureStatus.value === 'idle') return '正在连接设备，请稍候';
  return '请保持手部静止，戒指贴合手指，测量期间不要退出页面';
});

const measureStepItems = computed(() => [
  {
    key: 'heart-rate',
    label: '心率',
    desc: heartRate.value ? `${heartRate.value} bpm` : '等待数据',
    active: measureStatus.value === 'measuring_hr',
    done: ['measuring_hrv', 'measuring_spo2', 'measuring_temp', 'completed'].includes(measureStatus.value) || Boolean(heartRate.value)
  },
  {
    key: 'hrv',
    label: '心率变异性',
    desc: heartRateVariability.value ? `${heartRateVariability.value} ms` : '等待数据',
    active: measureStatus.value === 'measuring_hrv',
    done: ['measuring_spo2', 'measuring_temp', 'completed'].includes(measureStatus.value) || Boolean(heartRateVariability.value)
  },
  {
    key: 'spo2',
    label: '血氧',
    desc: spo2Value.value ? `${spo2Value.value}%` : '等待数据',
    active: measureStatus.value === 'measuring_spo2',
    done: ['measuring_temp', 'completed'].includes(measureStatus.value) || Boolean(spo2Value.value)
  },
  {
    key: 'skin-temperature',
    label: '皮肤温度',
    desc: temperature.value ? `${temperature.value}°C` : '等待数据',
    active: measureStatus.value === 'measuring_temp',
    done: measureStatus.value === 'completed' || Boolean(temperature.value)
  }
]);

const isIOS = computed(() => {
  const systemInfo = uni.getSystemInfoSync();
  return systemInfo.platform.toLowerCase().includes('ios');
});
const isRwDevice = () => userStore.deviceInfo?.protocol === 'rw';
const getSubmitMac = () => getSubmitDeviceMac(userStore, isIOS.value);

const getLatestHeartRateData = () => getLatestHeartRateReading(userStore, measureStartedAt);
const getLatestHrvData = () => getLatestHrvReading(userStore, measureStartedAt);
const getLatestSpo2Data = () => getLatestSpo2Reading(userStore, measureStartedAt);
const getLatestStressData = () => getLatestStressReading(userStore, measureStartedAt);
const getLatestBloodSugarData = () => getLatestBloodSugarReading(userStore, measureStartedAt);
const getLatestBloodPressureData = () => getLatestBloodPressureReading(userStore, measureStartedAt);
const getLatestTemperatureData = () => getLatestTemperatureReading(userStore, measureStartedAt);
const hasRwRealtimeCoreData = () => Boolean(getLatestHeartRateData()?.heartRate && getLatestSpo2Data()?.bloodOxygen);
const hasRwAnyRealtimeCoreData = () => Boolean(getLatestHeartRateData()?.heartRate || getLatestSpo2Data()?.bloodOxygen);

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

const stopMeasurementFlow = () => {
  clearMeasureTimeout();
  clearRwAdvanceTimer();
  clearCompletionDelayTimer();
  if (progressAnimationTimer) {
    clearInterval(progressAnimationTimer);
    progressAnimationTimer = null;
  }
  clearAllProgressIntervals();
  void stopActiveRwMeasurement('RW PAGE');
  measureStatus.value = 'idle';
};

const sendMeasurementCommand = async (task: () => Promise<unknown>, expectedSteps: string | string[]) => {
  try {
    const expectedMetric = Array.isArray(expectedSteps) ? expectedSteps[0] : expectedSteps;
    if (isRwDevice() && isRwForegroundMetric(expectedMetric)) {
      await runRwForegroundMeasurement(expectedMetric, {
        startedAt: measureStartedAt,
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
    stopMeasurementFlow();
    uni.showToast({ title: '测量指令发送失败', icon: 'none' });
  }
};

const quickProgressTo100 = () => {
  const currentProgress = measureProgress.value;
  const remaining = 100 - currentProgress;
  const steps = 10;
  const stepValue = Math.max(1, Math.floor(remaining / steps));

  if (progressAnimationTimer) clearInterval(progressAnimationTimer);
  progressAnimationTimer = setInterval(() => {
    if (measureProgress.value >= 100) {
      if (progressAnimationTimer) clearInterval(progressAnimationTimer);
      progressAnimationTimer = null;
      return;
    }
    measureProgress.value = Math.min(measureProgress.value + stepValue, 100);
  }, 50);
};

const advanceRwMeasureSoon = (next: () => void, delay = 300) => {
  clearMeasureTimeout();
  clearAllProgressIntervals();
  clearRwAdvanceTimer();
  rwAdvanceTimer = setTimeout(() => {
    rwAdvanceTimer = null;
    next();
  }, delay);
};

const pushProgressInterval = (targetProgress: number, expectedStatus: typeof measureStatus.value) => {
  const progressInterval = setInterval(() => {
    if (measureStatus.value !== expectedStatus) {
      clearInterval(progressInterval);
      progressIntervals = progressIntervals.filter((item) => item !== progressInterval);
      return;
    }

    measureProgress.value += 1;
    if (measureProgress.value >= targetProgress) {
      clearInterval(progressInterval);
      progressIntervals = progressIntervals.filter((item) => item !== progressInterval);
    }
  }, 1000);
  progressIntervals.push(progressInterval);
};

const startHrMeasurement = () => {
  measureStatus.value = 'measuring_hr';
  measureProgress.value = 0;
  clearAllProgressIntervals();
  void sendMeasurementCommand(sendActiveMeasureCommand, 'heart_rate').then(() => {
    if (isRwDevice() && measureStatus.value === 'measuring_hr' && getLatestHeartRateData()?.heartRate) {
      startHrvMeasurement();
    }
  });
  pushProgressInterval(25, 'measuring_hr');
  measureTimeout = setTimeout(() => {
    if (measureStatus.value === 'measuring_hr') startHrvMeasurement();
  }, DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS);
};

const startHrvMeasurement = () => {
  measureStatus.value = 'measuring_hrv';
  clearAllProgressIntervals();
  clearMeasureTimeout();
  void sendMeasurementCommand(sendActiveMeasureCommand, 'hrv').then(() => {
    if (isRwDevice() && measureStatus.value === 'measuring_hrv' && getLatestHrvData()?.heartRateVariability) {
      startSpo2Measurement();
    }
  });
  pushProgressInterval(50, 'measuring_hrv');
  measureTimeout = setTimeout(() => {
    if (measureStatus.value === 'measuring_hrv') startSpo2Measurement();
  }, DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS);
};

const startSpo2Measurement = () => {
  measureStatus.value = 'measuring_spo2';
  clearAllProgressIntervals();
  clearMeasureTimeout();
  void sendMeasurementCommand(sendOxyGenCommand, 'blood_oxygen').then(() => {
    if (isRwDevice() && measureStatus.value === 'measuring_spo2' && getLatestSpo2Data()?.bloodOxygen) {
      startTemperatureMeasurement();
    }
  });
  pushProgressInterval(75, 'measuring_spo2');
  measureTimeout = setTimeout(() => {
    if (measureStatus.value === 'measuring_spo2') {
      startTemperatureMeasurement();
    }
  }, DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS);
};

const startTemperatureMeasurement = () => {
  measureStatus.value = 'measuring_temp';
  clearAllProgressIntervals();
  clearMeasureTimeout();
  void sendMeasurementCommand(sendBodyTemperatureCommand, 'temperature').then(() => {
    if (isRwDevice() && measureStatus.value === 'measuring_temp' && getLatestTemperatureData()?.temperature) {
      completeMeasurement();
    }
  });
  pushProgressInterval(100, 'measuring_temp');
  measureTimeout = setTimeout(() => {
    if (measureStatus.value === 'measuring_temp') completeMeasurement();
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

const isCollectingMeasureResult = (data: any) => {
  const statusText = String(data?.status ?? data?.message ?? data?.msg ?? data?.desc ?? '').toLowerCase();
  return statusText.includes('采集中') || statusText.includes('测量中') || statusText.includes('collect');
};

const showOtherStatusToast = (receivedData: any[], status: boolean, type: '心率' | '血氧' | '皮肤温度') => {
  if (!status) return;

  const typeMap = {
    心率: 'active_measure',
    血氧: 'active_OxyGenMeasure',
    皮肤温度: 'active_Temperature'
  } as const;
  const latestValidResult = receivedData.find((item: any) => item.type === typeMap[type]);
  if (!latestValidResult || isCollectingMeasureResult(latestValidResult)) return;
  clearMeasureTimeout();
  uni.showToast({ title: `${type}测量状态：${latestValidResult?.status || '未返回有效值'}`, icon: 'none', duration: 1500 });
  measureStatus.value = 'idle';
  setTimeout(() => {
    uni.navigateBack();
  }, 2000);
};

watch(
  () => [userStore.receivedData, userStore.latestMetrics, userStore.healthData],
  () => {
    if (!['measuring_temp', 'measuring_hr', 'measuring_hrv', 'measuring_spo2'].includes(measureStatus.value)) return;
    const receivedData = userStore.receivedData || [];

    if (isRwDevice() && measureStatus.value === 'measuring_hr' && getLatestHeartRateData()?.heartRate) {
      measureProgress.value = Math.max(measureProgress.value, 25);
      advanceRwMeasureSoon(() => {
        if (measureStatus.value === 'measuring_hr') startHrvMeasurement();
      });
      return;
    }

    if (isRwDevice() && measureStatus.value === 'measuring_hrv' && getLatestHrvData()?.heartRateVariability) {
      measureProgress.value = Math.max(measureProgress.value, 50);
      advanceRwMeasureSoon(() => {
        if (measureStatus.value === 'measuring_hrv') startSpo2Measurement();
      }, 500);
      return;
    }

    if (isRwDevice() && measureStatus.value === 'measuring_spo2' && hasRwRealtimeCoreData()) {
      measureProgress.value = Math.max(measureProgress.value, 75);
      advanceRwMeasureSoon(() => {
        if (measureStatus.value === 'measuring_spo2') startTemperatureMeasurement();
      }, 500);
      return;
    }

    if (isRwDevice() && measureStatus.value === 'measuring_temp' && getLatestTemperatureData()?.temperature) {
      quickProgressTo100();
      advanceRwMeasureSoon(() => {
        if (measureStatus.value === 'measuring_temp') completeMeasurement();
      }, 500);
      return;
    }

    if (isRwDevice()) return;

    const hasCompletedMeasureH = receivedData.some(
      (data: any) => data.type === 'active_measure' && data.heartbeatStatus != null && data.heartbeatStatus !== 0x03 && !isCollectingMeasureResult(data)
    );
    const hasCompletedMeasureO = receivedData.some(
      (data: any) => data.type === 'active_OxyGenMeasure' && data.bloodOxygenStatus != null && data.bloodOxygenStatus !== 0x03 && !isCollectingMeasureResult(data)
    );
    const hasCompletedMeasureT = receivedData.some(
      (data: any) =>
        data.type === 'active_Temperature' &&
        data.temperatureStatus != null &&
        data.temperatureStatus !== 0x00 &&
        data.temperatureStatus !== 0x01 &&
        !isCollectingMeasureResult(data)
    );
    const hasCompletedStatus = receivedData.some((data: any) => data.type === 'active_Temperature' && data.temperatureStatus === 0x01);

    if (hasCompletedStatus) {
      clearMeasureTimeout();
      quickProgressTo100();
      setTimeout(() => {
        completeMeasurement();
      }, 1000);
    }

    showOtherStatusToast(receivedData, hasCompletedMeasureH, '心率');
    showOtherStatusToast(receivedData, hasCompletedMeasureO, '血氧');
    showOtherStatusToast(receivedData, hasCompletedMeasureT, '皮肤温度');
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

  if (latestHrData?.heartRate) heartRate.value = latestHrData.heartRate;
  if (latestHrvData?.heartRateVariability) heartRateVariability.value = latestHrvData.heartRateVariability;
  if (latestStressData?.stressIndex) stressIndex.value = latestStressData.stressIndex;
  if (latestBloodSugarData?.bloodSugar) bloodSugar.value = latestBloodSugarData.bloodSugar;
  if (latestBloodPressureData?.systolic) systolic.value = latestBloodPressureData.systolic;
  if (latestBloodPressureData?.diastolic) diastolic.value = latestBloodPressureData.diastolic;
  if (latestSpo2Data?.bloodOxygen) spo2Value.value = latestSpo2Data.bloodOxygen;
  if (latestTempData?.temperature) temperature.value = latestTempData.temperature;
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
    if (latestHrData?.heartRate) measurementRecord.heartRate = latestHrData.heartRate;
    if (latestHrvData?.heartRateVariability) measurementRecord.hrv = latestHrvData.heartRateVariability;
    if (latestStressData?.stressIndex) measurementRecord.stress = latestStressData.stressIndex;
    if (latestBloodSugarData?.bloodSugar) measurementRecord.bloodSugar = latestBloodSugarData.bloodSugar;
    if (latestBloodPressureData?.systolic) measurementRecord.systolic = latestBloodPressureData.systolic;
    if (latestBloodPressureData?.diastolic) measurementRecord.diastolic = latestBloodPressureData.diastolic;
    if (latestSpo2Data?.bloodOxygen) measurementRecord.spo2 = latestSpo2Data.bloodOxygen;
    if (latestTempData?.temperature) measurementRecord.temperature = latestTempData.temperature;

    if (
      measurementRecord.heartRate == null &&
      measurementRecord.spo2 == null &&
      measurementRecord.temperature == null &&
      measurementRecord.hrv == null &&
      measurementRecord.stress == null &&
      measurementRecord.bloodSugar == null &&
      measurementRecord.systolic == null &&
      measurementRecord.diastolic == null
    ) {
      uni.showToast({ title: '设备未返回有效测量值', icon: 'none', duration: 1500 });
      setTimeout(() => {
        uni.navigateBack();
      }, 1500);
      return;
    }

    if (latestHrData?.heartRate) heartRate.value = latestHrData.heartRate;
    if (latestHrvData?.heartRateVariability) heartRateVariability.value = latestHrvData.heartRateVariability;
    if (latestStressData?.stressIndex) stressIndex.value = latestStressData.stressIndex;
    if (latestBloodSugarData?.bloodSugar) bloodSugar.value = latestBloodSugarData.bloodSugar;
    if (latestBloodPressureData?.systolic) systolic.value = latestBloodPressureData.systolic;
    if (latestBloodPressureData?.diastolic) diastolic.value = latestBloodPressureData.diastolic;
    if (latestSpo2Data?.bloodOxygen) spo2Value.value = latestSpo2Data.bloodOxygen;
    if (latestTempData?.temperature) temperature.value = latestTempData.temperature;

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
    resetMeasurementValues();
    clearCompletionDelayTimer();
    measureStartedAt = Date.now();

    if (deviceId) {
      const alreadyConnected = await isDeviceConnected(deviceId, serviceId || '');
      if (!alreadyConnected) {
        const restored = await autoConnectLastDevice();
        if (!restored) {
          uni.showToast({
            title: '设备未连接，请靠近戒指后重试',
            icon: 'none',
            duration: 2000
          });
          return;
        }
      }
    } else {
      const restored = await autoConnectLastDevice();
      if (!restored) {
        uni.showToast({ title: '请先连接设备', icon: 'none' });
        return;
      }
    }

    await ensureCommunicationReady();
    startHrMeasurement();
  } catch (error) {
    if (!isExpectedBleRuntimeError(error)) {
      formatBleErrorMessage(error);
    }
    uni.showToast({ title: '设备暂未返回，请稍后重试', icon: 'none' });
  }
};

onLoad(async () => {
  userStore.receivedData = userStore.receivedData.filter(
    (data: any) => !['active_measure', 'active_OxyGenMeasure', 'active_Temperature'].includes(data.type)
  );
  await handleMeasure();
});

onUnload(() => {
  stopMeasurementFlow();
  measureStartedAt = 0;
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

    <view class="tips-card">
      <text class="tips-title">测量小提示</text>
      <text class="tips-text">保持手指放松、戒指贴合，测量中请不要频繁移动或切换页面。</text>
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
  align-items: baseline;
  justify-content: center;
  background: #ffffff;
  color: #2e70fc;
  border-radius: 50%;
  box-shadow: 0 16rpx 28rpx rgba(12, 45, 120, 0.16);
}

.measure-percent {
  font-size: 48rpx;
  font-weight: 800;
}

.measure-percent-unit {
  margin-left: 4rpx;
  font-size: 24rpx;
}

.progress-card,
.tips-card {
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

.tips-card {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.tips-title {
  color: #111827;
  font-size: 30rpx;
  font-weight: 700;
}

.tips-text {
  color: #6b7280;
  font-size: 26rpx;
  line-height: 1.6;
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
