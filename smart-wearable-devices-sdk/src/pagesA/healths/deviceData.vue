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

const measureStatus = ref<'idle' | 'measuring_hr' | 'measuring_spo2' | 'measuring_temp' | 'completed'>('idle');
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
let measureStartedAt = 0;

const DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS = 35000;
const RW_OPTIONAL_TEMPERATURE_TIMEOUT_MS = 8000;

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

const stopMeasurementFlow = () => {
  clearMeasureTimeout();
  clearRwAdvanceTimer();
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
  void sendMeasurementCommand(sendActiveMeasureCommand, 'heart_rate');
  pushProgressInterval(33, 'measuring_hr');
  measureTimeout = setTimeout(() => {
    if (measureStatus.value === 'measuring_hr') startSpo2Measurement();
  }, DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS);
};

const startSpo2Measurement = () => {
  measureStatus.value = 'measuring_spo2';
  clearAllProgressIntervals();
  clearMeasureTimeout();
  void sendMeasurementCommand(sendOxyGenCommand, 'blood_oxygen');
  pushProgressInterval(66, 'measuring_spo2');
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
  void sendMeasurementCommand(sendBodyTemperatureCommand, 'temperature');
  pushProgressInterval(100, 'measuring_temp');
  measureTimeout = setTimeout(() => {
    if (measureStatus.value === 'measuring_temp') completeMeasurement();
  }, isRwDevice() && hasRwAnyRealtimeCoreData() ? RW_OPTIONAL_TEMPERATURE_TIMEOUT_MS : DEFAULT_MEASUREMENT_STEP_TIMEOUT_MS);
};

const completeMeasurement = () => {
  clearMeasureTimeout();
  clearRwAdvanceTimer();
  if (progressAnimationTimer) {
    clearInterval(progressAnimationTimer);
    progressAnimationTimer = null;
  }
  clearAllProgressIntervals();
  void stopActiveRwMeasurement('RW PAGE');
  measureProgress.value = 100;
  measureStatus.value = 'completed';
};

const showOtherStatusToast = (receivedData: any[], status: boolean, type: '心率' | '血氧' | '体温') => {
  if (!status) return;

  const typeMap = {
    心率: 'active_measure',
    血氧: 'active_OxyGenMeasure',
    体温: 'active_Temperature'
  } as const;
  const latestValidResult = receivedData.find((item: any) => item.type === typeMap[type]);
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
    if (!['measuring_temp', 'measuring_hr', 'measuring_spo2'].includes(measureStatus.value)) return;
    const receivedData = userStore.receivedData || [];

    if (isRwDevice() && measureStatus.value === 'measuring_hr' && getLatestHeartRateData()?.heartRate) {
      measureProgress.value = Math.max(measureProgress.value, 50);
      advanceRwMeasureSoon(() => {
        if (measureStatus.value === 'measuring_hr') startSpo2Measurement();
      });
      return;
    }

    if (isRwDevice() && measureStatus.value === 'measuring_spo2' && hasRwRealtimeCoreData()) {
      measureProgress.value = Math.max(measureProgress.value, 66);
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

    const hasCompletedMeasureH = receivedData.some((data: any) => data.type === 'active_measure' && data.heartbeatStatus !== 0x03);
    const hasCompletedMeasureO = receivedData.some((data: any) => data.type === 'active_OxyGenMeasure' && data.bloodOxygenStatus !== 0x03);
    const hasCompletedMeasureT = receivedData.some((data: any) => data.type === 'active_Temperature' && data.temperatureStatus !== 0x00 && data.temperatureStatus !== 0x01);
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
    showOtherStatusToast(receivedData, hasCompletedMeasureT, '体温');
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
<!-- 设备测量数据 -->
<template>
  <view class="pl-30 pr-30 pt-30 wrapper">
    <uv-navbar placeholder leftIcon="" title="设备测量数据" bgColor="#f1f3f6"></uv-navbar>
    <view class="flex ai-center jc-center pl-70 pr-70 floating-image">
      <view class="measure-visual">
        <view class="measure-ring"></view>
        <view class="measure-dot"></view>
      </view>
    </view>
    <view>
      <view class="ta-c mt-50" style="color: #2e70fc">
        <text class="" style="font-size: 96rpx">{{ measureProgress }}</text>
        <text class="fs-36">%</text>
      </view>
      <view class="ta-c fs-36 mt-30">正在为您测量中...</view>
      <view class="ta-c fs-28 t-979797 mt-10">测量时间较长，请您耐心等待~</view>
    </view>
  </view>
</template>

<style lang="scss">
.wrapper {
  box-sizing: border-box;
}
// 添加浮动动画
.floating-image {
  animation: float 3s ease-in-out infinite;
}

.measure-visual {
  position: relative;
  width: 420rpx;
  height: 420rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(46, 112, 252, 0.14) 0%, rgba(46, 112, 252, 0.04) 58%, transparent 60%);
}

.measure-ring {
  position: absolute;
  inset: 96rpx;
  border: 18rpx solid rgba(46, 112, 252, 0.78);
  border-top-color: rgba(46, 112, 252, 0.18);
  border-radius: 50%;
  animation: spin 1.8s linear infinite;
}

.measure-dot {
  position: absolute;
  top: 190rpx;
  left: 190rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: #2e70fc;
  box-shadow: 0 0 28rpx rgba(46, 112, 252, 0.5);
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
