<script setup lang="ts">
import { ref, nextTick, onMounted, computed, watch } from 'vue';
import { onLoad, onShow, onReady, onHide, onPageScroll, onUnload, onPullDownRefresh } from '@dcloudio/uni-app';
import { useUserStore } from '@/stores/user';
import { useRingStore } from '@/stores';
import { useRingBLE } from '@/composables/useRingBLE';
import { getDateInfo, getYesterday, getBeforeYesterday, getSleepDurationHours, getSleepDurationMinutes } from '@/utils/utils.js';
import { chartOptionFirst, chartOptionSecound, chartOptionThird, vitalOption, relaxOption } from './echartOptions';
import {
  getSleepOverview,
  getMotionOverview,
  getStressData,
  getHeartRateDetail,
  getBloodOxygenDetail,
  getMotionSummary,
  getStressSummary,
  getVitalSign,
  getBalanceScore,
  getSystemRuleTypeDict,
  getSystemUnhealthDict,
  getUserGirlHealthAll,
  getGirlHealth
} from '@/common/api/homeDetail';
import type {
  sleepOverview,
  motionOverview,
  stressDetail,
  heartRateDetail,
  motionSummary,
  stressSummaryType,
  vitalSignType,
  Point,
  balanceScoreType
} from '@/types/api/homeDetail';
import CustomSteps from '@/components/customSteps.vue';
import ProgressBar from '@/components/progressBar.vue';
import { submitData } from '@/common/api/homeDetail';
import { bind, unbind, getBindInfo } from '@/common/api/device';
import { getGoalInfo } from '@/common/api/user';
import DetailInfo from '@/components/DetailInfo.vue';
import { usePopupFixer } from '@/hooks/usePopupFixer';
import { formatBleErrorMessage } from '@/utils/bleError';
import { normalizeHealthLevel, normalizeHealthText } from '@/utils/healthText';
import { clearFrontendRingBindingState, hasBoundRingIdentity } from '@/utils/ringBinding';
import { hasAnyRingCommunicationReady, isRingConnectionActive, isRingConnectionConnecting } from '@/utils/ringConnectionStatus';
import { useRingBusinessHistoryPageSync } from '@/composables/useRingBusinessHistoryPageSync';
import { appendRingDiagnosticLog, RW_DIAGNOSTIC_BUILD_TAG } from '@/composables/useRwForegroundMeasurement';
import { MOTION_CALORIE_DISPLAY_UNIT, formatMotionCalorieKcal, normalizeMotionCalorieKcal } from '@/utils/motionCalorie';
import { formatBatteryStatusForDisplay, isBatteryChargingLike } from '@/utils/batteryDisplay';
import { getAppForegroundSessionId } from '@/utils/appForegroundSession';
import {
  buildRingHistorySubmitRecords,
  countRingHistoryRecordMetrics,
  getRingHistoryRecordUnixTime,
  getRingSubmitDeviceMac,
  isRingHistoryPayload,
  isRingHistoryReadComplete
} from '@/composables/useRingHistoryUpload';
import type { RwHistoryDataName } from '@/sdk/ring-ble';
// import AiLab from './aiLab.vue'

const { isPopupActive, fixedPageStyle } = usePopupFixer();

const echarts = require('../../static/echarts.min.js');

const userStore = useUserStore();
const ringStore = useRingStore();
const {
  initBluetooth,
  autoConnectLastDevice,
  isDeviceConnected,
  refreshHealthData,
  readLocalData,
  ensureCommunicationReady,
  updateDeviceTime
} = useRingBLE();
const ringBusinessBridge = useRingBusinessHistoryPageSync();
const RW_HOME_HISTORY_SYNC_TIMEOUT_MS = 30000;
const LEGACY_HOME_DEVICE_INFO_TIMEOUT_MS = 12000;
const LEGACY_HOME_HISTORY_SYNC_TIMEOUT_MS = 30000;
const RW_HOME_HISTORY_DATA_TYPES: RwHistoryDataName[] = [
  'lastData',
  'sleepData',
  'activity',
  // 压力由后端根据已入库指标计算，首页不主动从设备采集 stress 历史。
  'heartRate',
  'bloodOxygen',
  'hrv',
  'temperature',
  'skinTemperature',
  'bloodSugar',
  'bloodPressure'
];

const sleepOverviewObj = ref<sleepOverview>();
const motionOverviewObj = ref<motionOverview>();
const stressDetailObj = ref<stressDetail>();
const heartRateDetailObj = ref<heartRateDetail>();
const bloodOxygenDetailObj = ref<heartRateDetail>();
const motionSummaryObj = ref<motionSummary>();
const stressSummaryObj = ref<stressSummaryType>();
const vitalSignObj = ref<vitalSignType>();
const balanceScoreObj = ref<balanceScoreType>();
const homeGoalInfo = ref<Record<string, any>>({});

const healthAvgScore = computed(() => {
  const sleepScore = balanceScoreObj.value?.sleepScore || 0;
  const vitalSignsScore = balanceScoreObj.value?.vitalSignScore || 0;
  const motionScore = balanceScoreObj.value?.activityScore || 0;
  const relaxationScore = balanceScoreObj.value?.relaxScore || 0;
  return (sleepScore + vitalSignsScore + motionScore + relaxationScore) / 4;
});

const selectedDayIndex = ref(2);
const chartRef1 = ref<any>(null);
const chartRef2 = ref<any>(null);
const chartRef3 = ref<any>(null);
const chartVitalRef = ref<any>(null);
const chartRelaxlRef = ref<any>(null);
const calendar = ref<any>(null);

const selectData = ref<any>(null);

const sendTimer = ref<any>(null);
let awarenessRefreshPromise: Promise<void> | null = null;
let awarenessHistorySyncPromise: Promise<void> | null = null;
let legacyLocalDataUploadPromise: Promise<unknown> | null = null;
let awarenessProcessedRefreshPromise: Promise<void> | null = null;
let lastAwarenessRefreshAt = 0;
let lastAwarenessHistorySyncAt = 0;
let lastAwarenessDeviceTimeSyncAt = 0;
let lastAwarenessHomeUploadSessionKey = '';
let lastLegacyLocalDataUploadKey = '';
let lastLegacyLocalDataUploadAt = 0;
let lastAwarenessProcessedRefreshAt = 0;
const RW_AWARENESS_REFRESH_DEDUP_MS = 8000;
const RW_AWARENESS_HISTORY_DEDUP_MS = 45000;
const RW_AWARENESS_DEVICE_TIME_SYNC_DEDUP_MS = 10 * 60 * 1000;
const LEGACY_LOCAL_DATA_UPLOAD_DEDUP_MS = 60 * 1000;
const AWARENESS_PROCESSED_REFRESH_DEDUP_MS = 3000;
const hasAwarenessCommunicationReady = () =>
  hasAnyRingCommunicationReady(userStore.deviceInfo, ringStore.deviceInfo);
const isAwarenessRwRing = () => userStore.deviceInfo?.protocol === 'rw' || ringStore.deviceInfo?.protocol === 'rw';
const summarizeAwarenessDevice = (device: Record<string, any> | null | undefined) => ({
  deviceId: device?.deviceId,
  name: device?.deviceName || device?.name || device?.localName || device?.displayName,
  protocol: device?.protocol,
  uniMacId: device?.uniMacId,
  mac: device?.mac || device?.advertis?.macInfo,
  serviceId: device?.serviceId,
  cmdCharId: device?.cmdCharId,
  dataServiceId: device?.dataServiceId,
  dataCharId: device?.dataCharId,
  notifyEnabled: device?.notifyEnabled
});
const isAwarenessPageConnected = () =>
  isRingConnectionActive({
    ready: hasAwarenessCommunicationReady(),
    connected: userStore.isConnected === true || ringStore.isConnected === true,
    reconnectStatus: userStore.reconnectStatus || ringStore.reconnectStatus
  });
const appendAwarenessDiagnosticLog = (event: string, details?: unknown) => {
  const detailPayload =
    details && typeof details === 'object' && !Array.isArray(details)
      ? { buildTag: RW_DIAGNOSTIC_BUILD_TAG, ...(details as Record<string, unknown>) }
      : { buildTag: RW_DIAGNOSTIC_BUILD_TAG, value: details };
  appendRingDiagnosticLog('RW HOME', event, detailPayload);
};
const getAwarenessConnectionSnapshot = () => ({
  buildTag: RW_DIAGNOSTIC_BUILD_TAG,
  page: 'awareness',
  connected: isAwarenessPageConnected(),
  pageConnected: isAwarenessPageConnected(),
  ready: hasAwarenessCommunicationReady(),
  storeConnected: ringStore.isConnected,
  userConnected: userStore.isConnected,
  storeReconnectStatus: ringStore.reconnectStatus,
  userReconnectStatus: userStore.reconnectStatus,
  storeReconnectResult: ringStore.reconnectResult,
  userReconnectResult: userStore.reconnectResult,
  isReconnecting: userStore.isReconnecting,
  storeDevice: summarizeAwarenessDevice(ringStore.deviceInfo as Record<string, any>),
  userDevice: summarizeAwarenessDevice(userStore.deviceInfo as Record<string, any>)
});
const getAwarenessHomeUploadDeviceKey = () => {
  const device = (userStore.deviceInfo || ringStore.deviceInfo || {}) as Record<string, any>;
  return String(
    device.deviceId ||
      device.uniMacId ||
      device.mac ||
      device.advertis?.macInfo ||
      device.deviceName ||
      device.name ||
      'unknown-device'
  );
};
const getAwarenessHomeUploadSessionKey = () => `${getAppForegroundSessionId() || 'unknown-session'}:${getAwarenessHomeUploadDeviceKey()}`;
const claimAwarenessHomeSyncSession = (trigger: string, options: { force?: boolean } = {}) => {
  const uploadSessionKey = getAwarenessHomeUploadSessionKey();
  if (!options.force && lastAwarenessHomeUploadSessionKey === uploadSessionKey) {
    appendAwarenessDiagnosticLog('home-sync-session-skipped', {
      reason: 'same-app-foreground-session',
      trigger,
      uploadSessionKey,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }
  lastAwarenessHomeUploadSessionKey = uploadSessionKey;
  appendAwarenessDiagnosticLog('home-sync-session-claimed', {
    trigger,
    force: options.force === true,
    uploadSessionKey,
    snapshot: getAwarenessConnectionSnapshot()
  });
  return true;
};
const getLocalDayStartUnixTimestamp = (date = new Date()) => Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000);
const formatUnixTimestampForLog = (timestamp?: number) => {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');
  const second = date.getSeconds().toString().padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};
const getAwarenessHistoryUploadSinceTimestamp = (isRwRing: boolean) => {
  if (isRwRing) return userStore.lastReadTimestamp;
  return getLocalDayStartUnixTimestamp(new Date());
};

const pullDownRefresh = ref(false);
const pullDownProgress = ref(0);
const homeDataSyncing = ref(false);
// const showProgress = ref(false);


const today = ref(new Date());
const yesterday = ref(getYesterday(today.value));
const beforeYesterday = ref(getBeforeYesterday(today.value));


const yesterdayInfo = ref(getDateInfo(yesterday.value));
const beforeYesterdayInfo = ref(getDateInfo(beforeYesterday.value));


const hasSelectedDate = ref(false);


const selectedDateInfo = ref({
  year: today.value.getFullYear().toString(),
  monthDay: `${(today.value.getMonth() + 1).toString().padStart(2, '0')}-${today.value.getDate().toString().padStart(2, '0')}`
});

const popupSteps = ref<any>(null);

const showPeriodDetail = ref(false);
const periodPhases = ref([
  { key: 'menstrual', icon: 'M', label: '\u6708\u7ecf\u671f' },
  { key: 'ovulation', icon: 'O', label: '\u6392\u5375\u671f' },
  { key: 'fertile', icon: 'F', label: '\u6613\u5b55\u671f' },
  { key: 'safe', icon: 'S', label: '\u5b89\u5168\u671f' }
]);const homeDetailRoutes = {
  sleep: '/homeDetail/sleepPage/sleepPage',
  exercise: '/homeDetail/exercise/exercise',
  relax: '/homeDetail/relaxStatus/relaxStatus',
  vitalSigns: '/homeDetail/vitalSigns/vitalSigns'
} as const;
const currentPhaseIndex = ref(3);
const periodTodayDate = ref('');
const periodTip = ref('');

const togglePeriodDetail = () => {
  showPeriodDetail.value = !showPeriodDetail.value;
  if (showPeriodDetail.value && !periodTodayDate.value) {
    const now = new Date();
    const y = now.getFullYear();
    const m = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    periodTodayDate.value = `${y}-${m}-${d}`;
  }
};

let lastLocalDataLength = 0;

const isIOS = computed(() => {
  const systemInfo = uni.getSystemInfoSync();
  return systemInfo.platform.toLowerCase().includes('ios');
});
const local = computed(() => userStore.localData);
const getLegacyLocalDataUploadKey = (
  deviceMac: string | undefined,
  uploadSinceTimestamp: number,
  submitArray: Array<Record<string, any>>,
  submitMetricCounts: Record<string, number>
) => {
  const timestamps = submitArray.map((record) => getRingHistoryRecordUnixTime(record)).filter((timestamp): timestamp is number => Boolean(timestamp && timestamp > 0));
  const firstTimestamp = timestamps.length ? Math.min(...timestamps) : 0;
  const lastTimestamp = timestamps.length ? Math.max(...timestamps) : 0;
  return [
    deviceMac || 'unknown-device',
    uploadSinceTimestamp || 0,
    submitArray.length,
    firstTimestamp,
    lastTimestamp,
    JSON.stringify(submitMetricCounts)
  ].join('|');
};
const hasAwarenessCachedSnapshot = () => {
  const metrics = userStore.latestMetrics || {};
  const healthData = userStore.healthData || {};
  return Boolean(
    metrics.battery != null ||
      metrics.firmwareVersion ||
      metrics.softwareVersion ||
      metrics.heartRate != null ||
      metrics.bloodOxygen != null ||
      metrics.sleepTotalMinutes != null ||
      metrics.stepCount != null ||
      healthData.battery != null ||
      healthData.firmwareVersion ||
      healthData.softwareVersion ||
      healthData.heartRate != null ||
      healthData.bloodOxygen != null ||
      healthData.sleepTotalMinutes != null ||
      healthData.stepCount != null ||
      userStore.receivedData?.some((item: any) => item?.type === 'battery' || item?.type === 'firmware_version')
  );
};

const dateList = computed(() => [
  { date: beforeYesterday.value, info: beforeYesterdayInfo.value, label: 'beforeYesterday' },
  { date: yesterday.value, info: yesterdayInfo.value, label: 'yesterday' },
  { date: today.value, info: { week: '\u4eca\u5929', day: '' }, label: 'today' }
]);const getSelectedDetailDate = () => {
  const value = selectData.value;
  if (value instanceof Date) return formatLocalDate(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return formatLocalDate(dateList.value[selectedDayIndex.value]?.date || today.value);
};
const openHomeDetail = (key: keyof typeof homeDetailRoutes) => {
  const route = homeDetailRoutes[key];
  const query = `selectedDayIndex=${selectedDayIndex.value}&selectedDate=${encodeURIComponent(getSelectedDetailDate())}`;
  uni.navigateTo({
    url: `${route}?${query}`,
    fail: () => {
      uni.showToast({ title: '\\u9875\\u9762\\u52a0\\u8f7d\\u5931\\u8d25\\uff0c\\u8bf7\\u7a0d\\u540e\\u91cd\\u8bd5', icon: 'none' });
    }
  });
};
const getPositiveMetricNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (value == null || value === '') continue;
    const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
};
const unwrapAwarenessApiData = (source: any) => {
  const first = source?.data ?? source?.result ?? source;
  return first?.goalInfo ?? first?.userGoal ?? first?.data ?? first?.result ?? first ?? {};
};
const getAwarenessValueByKeys = (source: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};
const getHomeGoalNumber = (keys: string[], fallback: unknown) =>
  getPositiveMetricNumber(getAwarenessValueByKeys(homeGoalInfo.value, keys), fallback);
const isPendingMetricStatus = (value: unknown) => /[\u91c7\u96c6\u4e2d\u6d4b\u91cf\u8bfb\u53d6\u8bf7\u6c42\u7b49\u5f85]/.test(String(value ?? ''));
const getRelaxStatusByScore = (score: number) => {
  if (score >= 80) return '\u5e73\u7a33\u72b6\u6001';
  if (score >= 60) return '\u7565\u6709\u538b\u529b';
  if (score > 0) return '\u538b\u529b\u504f\u9ad8';
  return '';
};
const sleepDurationMinutes = computed(() =>
  getPositiveMetricNumber(
    sleepOverviewObj.value?.sleepDuration,
    userStore.healthData?.sleepTotalMinutes,
    userStore.healthData?.sleep_total_minutes,
    userStore.healthData?.sleep,
    userStore.latestMetrics?.sleepTotalMinutes
  )
);
const sleepScoreNumber = computed(() => getPositiveMetricNumber(sleepOverviewObj.value?.sleepScore, balanceScoreObj.value?.sleepScore));
const sleepQualityText = computed(() => {
  const quality = sleepScoreNumber.value;
  const status = userStore.healthData?.sleepStatus || userStore.latestMetrics?.sleepStatus;
  if (!quality || quality < 0 || quality > 100) return normalizeHealthText(status, '--');

  if (quality >= 0 && quality <= 20) return '\u8f83\u5dee';
  if (quality >= 21 && quality <= 40) return '\u5f85\u6539\u5584';
  if (quality >= 41 && quality <= 60) return '\u4e2d\u7b49';
  if (quality >= 61 && quality <= 80) return '\u826f\u597d';
  if (quality >= 81 && quality <= 100) return '\u4f18\u79c0';

  return '--';
});const relaxStressNumber = computed(() =>
  getPositiveMetricNumber(
    stressDetailObj.value?.stressValue,
    stressDetailObj.value?.avgStressValue,
    stressSummaryObj.value?.todayStressScore,
    stressSummaryObj.value?.weekAvgStressScore,
    balanceScoreObj.value?.relaxScore,
    userStore.healthData?.stress,
    userStore.healthData?.stressIndex,
    userStore.latestMetrics?.stress
  )
);
const relaxStressValue = computed(() => (relaxStressNumber.value > 0 ? `${relaxStressNumber.value}` : '00'));
const relaxStressStatus = computed(() => {
  const rawStatus = stressDetailObj.value?.stressLevel || userStore.healthData?.stressStatus || userStore.latestMetrics?.stressStatus;
  if (relaxStressNumber.value > 0 && isPendingMetricStatus(rawStatus)) {
    return getRelaxStatusByScore(relaxStressNumber.value) || normalizeHealthLevel('', relaxStressNumber.value, '\u5e73\u7a33\u72b6\u6001');
  }
  const normalized = normalizeHealthText(rawStatus, '');
  if (/^\s*\d+\s*(?:级|等级)\s*$/.test(normalized) || normalized === '等级') {
    return getRelaxStatusByScore(relaxStressNumber.value) || '\u5e73\u7a33\u72b6\u6001';
  }
  return normalized || getRelaxStatusByScore(relaxStressNumber.value) || '\u5e73\u7a33\u72b6\u6001';
});
const activeIcon = computed(() => {
  const activeLevel = relaxStressNumber.value;


  if (activeLevel < 60) {
    return '/static/images/homeDetail/cry.png';
  }
  else if (activeLevel >= 60 && activeLevel <= 79) {
    return '/static/images/homeDetail/normal.png';
  }

  else if (activeLevel >= 80 && activeLevel <= 100) {
    return '/static/images/homeDetail/smile.png';
  }

  return '/static/images/homeDetail/normal.png';
});
const activityStepNumber = computed(() =>
  getPositiveMetricNumber(motionOverviewObj.value?.step, userStore.healthData?.stepCount, userStore.healthData?.steps, userStore.latestMetrics?.stepCount)
);
const activityCalorieRawNumber = computed(() =>
  getPositiveMetricNumber(
    motionOverviewObj.value?.calorie,
    userStore.healthData?.calorie,
    userStore.healthData?.calories,
    userStore.healthData?.motionCalorie,
    userStore.latestMetrics?.calorie
  )
);
const activityCalorieNumber = computed(
  () =>
    normalizeMotionCalorieKcal(activityCalorieRawNumber.value, {
      stepCount: activityStepNumber.value,
      targetCalorie:
        getHomeGoalNumber(
          ['calorie', 'calorieTarget', 'targetCalorie', 'caloriesTarget', 'targetCalories'],
          motionOverviewObj.value?.targetCalorie
        ) || 500
    }) || 0
);
const activityMotionTimeNumber = computed(() =>
  getPositiveMetricNumber(
    motionOverviewObj.value?.motionTime,
    userStore.healthData?.activityMinutes,
    userStore.healthData?.activeMinutes,
    userStore.healthData?.motionTime,
    userStore.latestMetrics?.activityMinutes
  )
);
const activityStepValue = computed(() => (activityStepNumber.value > 0 ? `${activityStepNumber.value}` : '00'));
const activityCalorieValue = computed(() => formatMotionCalorieKcal(activityCalorieNumber.value));
const activityCalorieUnit = computed(() => MOTION_CALORIE_DISPLAY_UNIT);
const activityMotionTimeValue = computed(() => (activityMotionTimeNumber.value > 0 ? `${activityMotionTimeNumber.value}` : '00'));
const activityTargetStep = computed(() =>
  getHomeGoalNumber(['step', 'stepTarget', 'targetStep', 'stepsTarget'], motionOverviewObj.value?.targetStep) || 6000
);
const activityTargetCalorie = computed(() =>
  getHomeGoalNumber(['calorie', 'calorieTarget', 'targetCalorie', 'caloriesTarget', 'targetCalories'], motionOverviewObj.value?.targetCalorie) || 500
);
const activityTargetMotionTime = computed(() =>
  getHomeGoalNumber(
    ['motionTime', 'activityDurationTarget', 'targetActivityDuration', 'targetMotionTime', 'motionTimeTarget'],
    motionOverviewObj.value?.targetMotionTime
  ) || 30
);
const firstCricle = computed(() => {
  const Percentage = activityStepNumber.value / activityTargetStep.value;

  return Math.min(Math.max(Percentage * 100, 0), 100);
});
const secoundCricle = computed(() => {
  const Percentage = activityCalorieNumber.value / activityTargetCalorie.value;

  return Math.min(Math.max(Percentage * 100, 0), 100);
});
const thirdCricle = computed(() => {
  const Percentage = activityMotionTimeNumber.value / activityTargetMotionTime.value;

  return Math.min(Math.max(Percentage * 100, 0), 100);
});
const getBatteryDisplaySourceValue = (item: Record<string, any> | null | undefined) =>
  item?.metrics?.battery ?? item?.metrics?.batteryValue ?? item?.metrics?.value ?? item?.battery ?? item?.batteryValue ?? item?.value;
const getBatteryDisplayStatusValue = (item: Record<string, any> | null | undefined) =>
  item?.metrics?.chargingStatusText ??
  item?.metrics?.batteryStatus ??
  item?.chargingStatusText ??
  item?.chargeStatusText ??
  item?.batteryStatus ??
  item?.status;
const isValidBatteryDisplayValue = (value: unknown) => {
  if (value == null || value === '') return false;
  const numeric = Number(String(value).replace('%', '').trim());
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100;
};
const latestBattery = computed(() => {
  const sources = [userStore.normalizedData || [], userStore.receivedData || []];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const item = source[index] as Record<string, any>;
      const type = item?.type || item?.dataType || item?.sourceType;
      if (type !== 'battery' && type !== 'firmware_version') continue;
      if (
        isValidBatteryDisplayValue(getBatteryDisplaySourceValue(item)) ||
        isBatteryChargingLike(getBatteryDisplaySourceValue(item), getBatteryDisplayStatusValue(item))
      ) return item;
    }
  }
  return null;
});
const displayBatteryValue = computed(() => {
  const value =
    getBatteryDisplaySourceValue(latestBattery.value as Record<string, any> | null) ??
    userStore.healthData?.battery ??
    userStore.latestMetrics?.battery ??
    ringStore.healthData?.battery ??
    ringStore.latestMetrics?.battery;
  const status =
    getBatteryDisplayStatusValue(latestBattery.value as Record<string, any> | null) ??
    userStore.healthData?.chargingStatusText ??
    userStore.latestMetrics?.chargingStatusText ??
    userStore.healthData?.batteryStatus ??
    ringStore.healthData?.chargingStatusText ??
    ringStore.latestMetrics?.chargingStatusText ??
    ringStore.healthData?.batteryStatus;
  return formatBatteryStatusForDisplay(value, status, '');
});
const getDisplayMetricValue = (...values: unknown[]) => {
  for (const value of values) {
    if (value == null || value === '') continue;
    const numeric = getPositiveMetricNumber(value);
    if (Number.isFinite(numeric) && numeric > 0) return `${numeric}`;
    const text = String(value).trim();
    if (text && text !== '--' && text !== '-' && text !== '00') return text;
  }
  return '00';
};
const vitalHeartRateNumber = computed(() =>
  getPositiveMetricNumber(vitalSignObj.value?.heartRate, userStore.healthData?.heartRate, userStore.latestMetrics?.heartRate)
);
const vitalBloodOxygenNumber = computed(() =>
  getPositiveMetricNumber(
    vitalSignObj.value?.spo2,
    userStore.healthData?.bloodOxygen,
    userStore.healthData?.bloodOxygenSaturation,
    userStore.latestMetrics?.bloodOxygen
  )
);
const displayHeartRateValue = computed(() =>
  getDisplayMetricValue(vitalSignObj.value?.heartRate, userStore.healthData?.heartRate, userStore.latestMetrics?.heartRate)
);
const displayBloodOxygenValue = computed(() =>
  getDisplayMetricValue(
    vitalSignObj.value?.spo2,
    userStore.healthData?.bloodOxygen,
    userStore.healthData?.bloodOxygenSaturation,
    userStore.latestMetrics?.bloodOxygen
  )
);
const bluetoothStatus = computed(() => {
  const isConnected = isAwarenessPageConnected();
  const isConnecting = isRingConnectionConnecting({
    ready: hasAwarenessCommunicationReady(),
    connected: userStore.isConnected === true || ringStore.isConnected === true,
    reconnectStatus: userStore.reconnectStatus || ringStore.reconnectStatus,
    isReconnecting: userStore.isReconnecting === true || ringStore.isReconnecting === true
  });
  const isDisconnected = !isConnecting && !isConnected;
  const isSyncing =
    isConnected &&
    (homeDataSyncing.value ||
      userStore.isSending === true ||
      ringStore.isSending === true ||
      userStore.uploadingStatus === 'uploading' ||
      ringStore.uploadingStatus === 'uploading');

  return {
    isDisconnected,
    isConnecting,
    isConnected,
    isSyncing,


    statusText: isConnecting ? '\u8fde\u63a5\u4e2d' : '',
    syncingText: isSyncing ? '\u4e0a\u4f20\u4e2d' : '',
    batteryText: isConnected ? displayBatteryValue.value : '',


    iconPath: isConnected
      ? '/static/images/mine/bluetooth02.png'
      : isConnecting
        ? '/static/images/mine/bluetooth01.png'
        : '/static/images/mine/bluetooth03.png'
  };
});


const shouldShowBluetoothStatus = computed(() => {
  return userStore.isReconnecting !== undefined && userStore.isReconnecting !== null;
});

async function restoreAwarenessDeviceSnapshot(options: { refreshAfterRestore?: boolean } = {}) {
  appendAwarenessDiagnosticLog('restore-start', {
    snapshot: getAwarenessConnectionSnapshot()
  });
  try {
    userStore.updateUploadingStatus('0');
    userStore.updateReconnectingStatus('1');
    const restored = await autoConnectLastDevice();
    if (!restored) {
      userStore.updateIsConnected(false);
      userStore.updateReconnectingStatus('0');
      appendAwarenessDiagnosticLog('restore-result', {
        restored: false,
        ready: hasAwarenessCommunicationReady(),
        snapshot: getAwarenessConnectionSnapshot()
      });
      return false;
    }
    if (!hasAwarenessCommunicationReady()) {
      userStore.updateIsConnected(false);
      userStore.updateReconnectingStatus('0');
      appendAwarenessDiagnosticLog('restore-result', {
        restored: true,
        ready: false,
        snapshot: getAwarenessConnectionSnapshot()
      });
      return false;
    }

    userStore.updateIsConnected(true);
    userStore.updateReconnectingStatus('2');
    const shouldRefreshAfterRestore = options.refreshAfterRestore ?? !isAwarenessRwRing();
    if (shouldRefreshAfterRestore) {
      if (claimAwarenessHomeSyncSession('restore-ready')) {
        await executeCommandsSequentially();
      }
    } else {
      appendAwarenessDiagnosticLog('restore-rw-home-sync-started', {
        snapshot: getAwarenessConnectionSnapshot()
      });
      void syncRwHomeHistoryAndRefreshOverview(formatLocalDate(new Date()), 'restore-ready');
    }
    appendAwarenessDiagnosticLog('restore-result', {
      restored: true,
      ready: true,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return true;
  } catch (error) {
    userStore.updateIsConnected(false);
    userStore.updateReconnectingStatus('0');
    appendAwarenessDiagnosticLog('restore-error', {
      message: formatBleErrorMessage(error, '\u5237\u65b0\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5'),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }
}

watch(
  () => userStore.reconnectResult,
  async (newValue, oldValue) => {
    if (newValue === true) {

      if (hasAwarenessCommunicationReady()) {
        userStore.updateIsConnected(true);
        userStore.updateReconnectingStatus('2');
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!isAwarenessRwRing()) {
          if (claimAwarenessHomeSyncSession('reconnect-result-ready')) {
            await executeCommandsSequentially();
          }
        } else {
          appendAwarenessDiagnosticLog('reconnect-result-rw-home-sync-started', {
            snapshot: getAwarenessConnectionSnapshot()
          });
          void syncRwHomeHistoryAndRefreshOverview(formatLocalDate(new Date()), 'reconnect-result-ready');
        }
        appendAwarenessDiagnosticLog('reconnect-result-ready', {
          snapshot: getAwarenessConnectionSnapshot()
        });
      } else {
        appendAwarenessDiagnosticLog('reconnect-result-not-ready', {
          snapshot: getAwarenessConnectionSnapshot()
        });
      }
    }
  }
);
watch(
  () => userStore.isBluetoothReady,
  async (newValue, oldValue) => {

    if (newValue === true) {
      try {
        // popupSteps.value.open();
        if (!userStore.token) {

          userStore.updateDeviceInfo({});
          userStore.updateReceivedData([]);
          return;
        }
        let res: any = null;
        try {
          res = await getBindInfo();
        } catch {
          res = null;
        }
        if (!hasBoundRingIdentity(res)) {
          await clearFrontendRingBindingState(userStore, ringStore);
          return;
        }
        const { deviceId, serviceId } = userStore.deviceInfo;
        // console.log('deviceId', deviceId, serviceId);
        if (deviceId && serviceId) {

          const alreadyConnected = await isDeviceConnected(deviceId, serviceId);
          if (alreadyConnected) {

            if (hasAwarenessCommunicationReady()) {

              userStore.updateIsConnected(true);
              userStore.updateReconnectingStatus('2');
              appendAwarenessDiagnosticLog('bluetooth-ready-already-connected', {
                snapshot: getAwarenessConnectionSnapshot()
              });
              if (!isAwarenessRwRing()) {
                if (claimAwarenessHomeSyncSession('bluetooth-ready-already-connected')) {
                  await executeCommandsSequentially();
                }
              } else {
                appendAwarenessDiagnosticLog('bluetooth-ready-rw-home-sync-started', {
                  snapshot: getAwarenessConnectionSnapshot()
                });
                void syncRwHomeHistoryAndRefreshOverview(formatLocalDate(new Date()), 'bluetooth-ready-already-connected');
              }
            } else {
              await restoreAwarenessDeviceSnapshot();
            }
            return;
          }

          await restoreAwarenessDeviceSnapshot();
        } else {
          let res: any = null;
          try {
            res = await getBindInfo();
          } catch {
            res = null;
          }
          if (hasBoundRingIdentity(res)) {
            await restoreAwarenessDeviceSnapshot();
          } else {
            const restored = await restoreAwarenessDeviceSnapshot();
            if (!restored) {
              userStore.updateDeviceInfo({});
              userStore.updateReceivedData([]);
            }
          }
        }
      } catch (error) {
        // userStore.updateReconnectingStatus('0');
      }
    } else {
    }
  }
);

watch(
  () => userStore.localData,
  async (newData) => {
    const protocol = userStore.deviceInfo?.protocol || ringStore.deviceInfo?.protocol || 'unknown';
    const isRwRing = isAwarenessRwRing();
    const localData: any = userStore.receivedData?.filter(isRingHistoryPayload);
    if (!localData || localData.length === 0) {
      userStore.updateIsSending(false);
      return;
    }

    const isRwHistoryPayload = localData.some((item: any) => {
      const type = `${item?.type || ''}`;
      return item?.protocol === 'rw' || type === 'rw_upload_file' || type === 'rw_file_list' || type === 'qkeer_v2_last_data' || type.startsWith('qkeer_v2_');
    });
    if (isRwRing && isRwHistoryPayload) {
      appendAwarenessDiagnosticLog('local-data-upload-skip-rw-bridge', {
        recordCount: localData.length,
        localDataLength: Array.isArray(local.value) ? local.value.length : 0,
        reason: 'rw-home-bridge-owns-upload',
        snapshot: getAwarenessConnectionSnapshot()
      });
      userStore.updateIsSending(false);
      return;
    }

    // if (userStore.localData.length > lastLocalDataLength) {
    //   uni.showLoading({

    //     mask: true
    //   });
    // }
    lastLocalDataLength = userStore.localData.length;


    try {
      if (isRingHistoryReadComplete(localData)) {
        userStore.updateIsSending(false);
        // uni.hideLoading();

        const filteredRecords = local.value || [];
        const uploadSinceTimestamp = getAwarenessHistoryUploadSinceTimestamp(isRwRing);
        const rawMetricCounts = countRingHistoryRecordMetrics(filteredRecords as Array<Record<string, any>>);
        const submitArray = buildRingHistorySubmitRecords(filteredRecords, uploadSinceTimestamp);
        const submitMetricCounts = countRingHistoryRecordMetrics(submitArray as Array<Record<string, any>>);
        if (!isRwRing) {
          appendAwarenessDiagnosticLog('legacy-local-data-upload-ready', {
            protocol,
            localDataCount: localData.length,
            filteredRecordCount: filteredRecords.length,
            submitCount: submitArray.length,
            lastReadTimestamp: userStore.lastReadTimestamp,
            uploadSinceTimestamp,
            uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
            rawMetricCounts,
            submitMetricCounts,
            sample: submitArray.slice(0, 2),
            snapshot: getAwarenessConnectionSnapshot()
          });
        }

        if (submitArray.length !== 0) {
          const deviceMac = getRingSubmitDeviceMac(userStore, isIOS.value);
          const uploadDedupKey = getLegacyLocalDataUploadKey(deviceMac, uploadSinceTimestamp, submitArray as Array<Record<string, any>>, submitMetricCounts);
          const now = Date.now();
          if (legacyLocalDataUploadPromise) {
            if (!isRwRing) {
              appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
                protocol,
                reason: 'dedup-running',
                submitCount: submitArray.length,
                uploadSinceTimestamp,
                uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
                submitMetricCounts,
                deviceMac,
                snapshot: getAwarenessConnectionSnapshot()
              });
            }
            return;
          }
          if (uploadDedupKey === lastLegacyLocalDataUploadKey && now - lastLegacyLocalDataUploadAt < LEGACY_LOCAL_DATA_UPLOAD_DEDUP_MS) {
            if (!isRwRing) {
              appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
                protocol,
                reason: 'dedup-recent',
                elapsedMs: now - lastLegacyLocalDataUploadAt,
                submitCount: submitArray.length,
                uploadSinceTimestamp,
                uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
                submitMetricCounts,
                deviceMac,
                snapshot: getAwarenessConnectionSnapshot()
              });
            }
            return;
          }
          homeDataSyncing.value = true;
          userStore.updateUploadingStatus('1');
          if (!isRwRing) {
            appendAwarenessDiagnosticLog('legacy-local-data-upload-start', {
              protocol,
              submitCount: submitArray.length,
              uploadSinceTimestamp,
              uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
              submitMetricCounts,
              deviceMac,
              sample: submitArray.slice(0, 2),
              snapshot: getAwarenessConnectionSnapshot()
            });
          }

          let submitResponse: unknown;
          try {
            legacyLocalDataUploadPromise = submitData({
              deviceMac,
              dataList: submitArray
            });
            submitResponse = await legacyLocalDataUploadPromise;
          } finally {
            legacyLocalDataUploadPromise = null;
          }
          lastLegacyLocalDataUploadKey = uploadDedupKey;
          lastLegacyLocalDataUploadAt = Date.now();
          if (!isRwRing) {
            appendAwarenessDiagnosticLog('legacy-local-data-upload-result', {
              protocol,
              submitCount: submitArray.length,
              uploadSinceTimestamp,
              uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
              submitMetricCounts,
              hasResponse: submitResponse !== null && submitResponse !== undefined,
              responseKeys: submitResponse && typeof submitResponse === 'object' ? Object.keys(submitResponse as Record<string, any>).slice(0, 12) : [],
              snapshot: getAwarenessConnectionSnapshot()
            });
          }

          userStore.updateUploadingStatus('2');
          const submittedTimestamps = submitArray
            .map((record: any) => getRingHistoryRecordUnixTime(record))
            .filter(
              (timestamp): timestamp is number =>
                Boolean(timestamp && timestamp > 0 && (!uploadSinceTimestamp || timestamp >= uploadSinceTimestamp))
            );
          if (submittedTimestamps.length > 0 && isRwRing) {
            const maxTimestamp = Math.max(...submittedTimestamps);
            userStore.updateLastReadTimestamp(maxTimestamp);
          }

          await new Promise((resolve) => setTimeout(resolve, 500));

          await refreshAwarenessAfterDataProcessed('legacy-local-data-upload-complete');
          // uni.hideLoading();
        } else if (!isRwRing) {
          appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
            protocol,
            reason: 'empty-submit-array',
            localDataCount: localData.length,
            filteredRecordCount: filteredRecords.length,
            lastReadTimestamp: userStore.lastReadTimestamp,
            uploadSinceTimestamp,
            uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
            rawMetricCounts,
            submitMetricCounts,
            snapshot: getAwarenessConnectionSnapshot()
          });
          await refreshAwarenessAfterDataProcessed('legacy-local-data-no-submit');
        }
      } else {
        // userStore.updateIsSending(false);
        userStore.updateUploadingStatus('2');
        if (!isRwRing) {
          appendAwarenessDiagnosticLog('legacy-local-data-upload-pending', {
            protocol,
            localDataCount: localData.length,
            localDataTail: localData.slice(-3),
            snapshot: getAwarenessConnectionSnapshot()
          });
        }
      }
    } catch (error) {
      userStore.updateIsSending(false);
      userStore.updateUploadingStatus('0');
      if (!isRwRing) {
        appendAwarenessDiagnosticLog('legacy-local-data-upload-failed', {
          protocol,
          error: formatBleErrorMessage(error, 'legacy local data upload failed'),
          rawError: getAwarenessRawError(error),
          snapshot: getAwarenessConnectionSnapshot()
        });
      }
      uni.hideLoading();
      uni.showToast({
        title: '\u6570\u636e\u4e0a\u4f20\u5931\u8d25',
        icon: 'none',
        duration: 2000
      });
    } finally {
      // userStore.updateIsSending(false);
      homeDataSyncing.value = false;
    }
  },
  { deep: true }
);

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseLocalDate = (date: string) => {
  const parts = `${date || ''}`.split('-').map((value) => Number(value));
  if (parts.length >= 3 && parts.every((value) => Number.isFinite(value))) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return new Date();
};
const getAwarenessSilentRequestConfig = () => ({ custom: { toast: false, catch: true } });
const getAwarenessRawError = (error: unknown) => {
  const typed = error as { rawMsg?: unknown; rawError?: unknown; errMsg?: unknown; message?: unknown };
  return typed?.rawMsg || typed?.rawError || typed?.errMsg || typed?.message;
};
const isAwarenessNetworkTimeoutError = (error: unknown) => {
  const raw = `${getAwarenessRawError(error) || ''}`.toLowerCase();
  return /timeout|time\s*out|err_connection_timed_out|\u7f51\u7edc\u8bf7\u6c42\u8d85\u65f6/.test(raw);
};
const requestAwarenessOverview = async <T>(key: string, date: Date, task: () => Promise<T>): Promise<T | null> => {
  try {
    const result = await task();
    appendAwarenessDiagnosticLog('business-overview-request-success', {
      key,
      date: formatLocalDate(date),
      summary: summarizeAwarenessResponse(result),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return result;
  } catch (error) {
    appendAwarenessDiagnosticLog('business-overview-request-failed', {
      key,
      date: formatLocalDate(date),
      error: formatBleErrorMessage(error, '\u9996\u9875\u6570\u636e\u8bf7\u6c42\u5931\u8d25'),
      rawError: getAwarenessRawError(error),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return null;
  }
};
const summarizeAwarenessResponse = (value: unknown) => {
  if (value == null || value === '') return { hasData: false, type: value == null ? 'null' : 'empty-string' };
  if (Array.isArray(value)) return { hasData: value.length > 0, type: 'array', length: value.length };
  if (typeof value !== 'object') return { hasData: Boolean(value), type: typeof value, value: String(value).slice(0, 80) };

  const record = value as Record<string, any>;
  const keys = Object.keys(record);
  return {
    hasData: keys.length > 0,
    type: 'object',
    keys: keys.slice(0, 12),
    sleepScore: record.sleepScore,
    vitalSignScore: record.vitalSignScore,
    activityScore: record.activityScore,
    relaxScore: record.relaxScore,
    step: record.step,
    sleepDuration: record.sleepDuration,
    stressValue: record.stressValue,
    heartRate: record.heartRate,
    spo2: record.spo2,
    overallScore: record.overallScore
  };
};
const requestAwarenessAuxiliary = async <T>(key: string, date: Date, task: () => Promise<T>): Promise<T | null> => {
  try {
    return await task();
  } catch (error) {
    appendAwarenessDiagnosticLog('business-aux-request-failed', {
      key,
      date: formatLocalDate(date),
      error: formatBleErrorMessage(error, '\u9996\u9875\u8f85\u52a9\u6570\u636e\u8bf7\u6c42\u5931\u8d25'),
      rawError: getAwarenessRawError(error),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return null;
  }
};

const getBalanceScoreData = async (currentDate = new Date()) => {
  const date = formatLocalDate(currentDate);
  const res = await requestAwarenessOverview('balanceScore', currentDate, () =>
    getBalanceScore({ date }, getAwarenessSilentRequestConfig())
  );
  if (res) {
    balanceScoreObj.value = res;
  }
};

const getSleepOverviewData = async (currentDate = new Date()) => {
  const date = formatLocalDate(currentDate);
  const res = await requestAwarenessOverview('sleepOverview', currentDate, () =>
    getSleepOverview({ date }, getAwarenessSilentRequestConfig())
  );
  if (res) {
    sleepOverviewObj.value = res;
  }
};

const getMotionOverviewData = async (currentDate = new Date()) => {
  const date = formatLocalDate(currentDate);
  const [res, resT] = await Promise.all([
    requestAwarenessOverview('motionOverview', currentDate, () => getMotionOverview({ date }, getAwarenessSilentRequestConfig())),
    requestAwarenessOverview('motionSummary', currentDate, () => getMotionSummary({ date }, getAwarenessSilentRequestConfig()))
  ]);
  if (res) {
    motionOverviewObj.value = res;
  }
  if (resT) {
    motionSummaryObj.value = resT;
  }
};

const getHomeGoalInfoData = async (currentDate = new Date()) => {
  const res = await requestAwarenessAuxiliary('goalInfo', currentDate, () =>
    getGoalInfo({}, getAwarenessSilentRequestConfig())
  );
  if (res) {
    homeGoalInfo.value = unwrapAwarenessApiData(res);
  }
};


const getStressInfo = async (currentDate = new Date()) => {

  const localDate = formatLocalDate(new Date());
  let offset = 0;
  if (selectedDayIndex.value === 3) {
    const today = new Date();

    const diffTime = today.getTime() - currentDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    offset = -diffDays;
  } else {
    offset = selectedDayIndex.value - 2;
  }
  const res = await getStressData({
    date: localDate,
    type: 'day',
    offset
  }, getAwarenessSilentRequestConfig()).catch((error: unknown) => {
    appendAwarenessDiagnosticLog('business-overview-request-failed', {
      key: 'stressDetail',
      date: formatLocalDate(currentDate),
      error: formatBleErrorMessage(error, '\u9996\u9875\u538b\u529b\u8bf7\u6c42\u5931\u8d25'),
      rawError: getAwarenessRawError(error),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return null;
  });

  const resT = await requestAwarenessOverview('stressSummary', currentDate, () =>
    getStressSummary({ date: formatLocalDate(currentDate) }, getAwarenessSilentRequestConfig())
  );
  if (res) {
    stressDetailObj.value = res;
  }
  if (resT) {
    stressSummaryObj.value = resT;
  }
};

const getVitalSigns = async (currentDate = new Date()) => {
  const date = formatLocalDate(currentDate);
  const res = await requestAwarenessOverview('vitalSign', currentDate, () =>
    getVitalSign({ date }, getAwarenessSilentRequestConfig())
  );
  if (res) {
    vitalSignObj.value = res;
  }
};

const refreshAwarenessBusinessOverview = async (date: string) => {
  const currentDate = parseLocalDate(date);
  await Promise.all([
    getHomeGoalInfoData(currentDate),
    getBalanceScoreData(currentDate),
    getSleepOverviewData(currentDate),
    getMotionOverviewData(currentDate),
    getStressInfo(currentDate),
    getVitalSigns(currentDate)
  ]);
  await Promise.all([initBalanceChart(), initSportChart(), initVitalChart(), initRelaxChart(), initSleepChart()]);
};

const refreshAwarenessAfterDataProcessed = async (reason: string, date = getSelectedDetailDate()) => {
  const now = Date.now();
  if (awarenessProcessedRefreshPromise) {
    appendAwarenessDiagnosticLog('business-processed-refresh-skip', {
      reason: 'dedup-running',
      trigger: reason,
      date,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return awarenessProcessedRefreshPromise;
  }
  if (now - lastAwarenessProcessedRefreshAt < AWARENESS_PROCESSED_REFRESH_DEDUP_MS) {
    appendAwarenessDiagnosticLog('business-processed-refresh-skip', {
      reason: 'dedup-recent',
      trigger: reason,
      date,
      elapsedMs: now - lastAwarenessProcessedRefreshAt,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }
  awarenessProcessedRefreshPromise = (async () => {
    appendAwarenessDiagnosticLog('business-processed-refresh-start', {
      trigger: reason,
      date,
      snapshot: getAwarenessConnectionSnapshot()
    });
    await refreshAwarenessBusinessOverview(date);
    lastAwarenessProcessedRefreshAt = Date.now();
    appendAwarenessDiagnosticLog('business-processed-refresh-result', {
      trigger: reason,
      date,
      balanceScore: summarizeAwarenessResponse(balanceScoreObj.value),
      sleepOverview: summarizeAwarenessResponse(sleepOverviewObj.value),
      motionOverview: summarizeAwarenessResponse(motionOverviewObj.value),
      stressDetail: summarizeAwarenessResponse(stressDetailObj.value),
      vitalSign: summarizeAwarenessResponse(vitalSignObj.value),
      snapshot: getAwarenessConnectionSnapshot()
    });
  })();
  try {
    await awarenessProcessedRefreshPromise;
  } finally {
    awarenessProcessedRefreshPromise = null;
  }
};

const syncRwHomeDeviceTimeBeforeHistory = async (trigger: string) => {
  if (!isAwarenessRwRing() || !hasAwarenessCommunicationReady()) return;

  const now = Date.now();
  if (now - lastAwarenessDeviceTimeSyncAt < RW_AWARENESS_DEVICE_TIME_SYNC_DEDUP_MS) {
    appendAwarenessDiagnosticLog('device-time-sync-skip', {
      reason: 'dedup-recent',
      trigger,
      elapsedMs: now - lastAwarenessDeviceTimeSyncAt,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  const timezone = -new Date().getTimezoneOffset() / 60;
  appendAwarenessDiagnosticLog('device-time-sync-start', {
    trigger,
    timestampMs: now,
    timezone,
    snapshot: getAwarenessConnectionSnapshot()
  });

  try {
    await updateDeviceTime(now, timezone);
    lastAwarenessDeviceTimeSyncAt = Date.now();
    appendAwarenessDiagnosticLog('device-time-sync-result', {
      trigger,
      timestampMs: now,
      timezone,
      snapshot: getAwarenessConnectionSnapshot()
    });
  } catch (error) {
    appendAwarenessDiagnosticLog('device-time-sync-failed', {
      trigger,
      timestampMs: now,
      timezone,
      error: formatBleErrorMessage(error, '\u8bbe\u5907\u65f6\u95f4\u6821\u51c6\u5931\u8d25'),
      snapshot: getAwarenessConnectionSnapshot()
    });
  }
};

const syncRwHomeHistoryAndRefreshOverview = async (
  date = formatLocalDate(new Date()),
  reason = 'manual',
  options: { force?: boolean } = {}
) => {
  if (!isAwarenessRwRing()) return;
  if (!claimAwarenessHomeSyncSession(reason, options)) return;

  const now = Date.now();
  if (awarenessHistorySyncPromise) {
    appendAwarenessDiagnosticLog('business-sync-background-skip', {
      reason: 'dedup-running',
      trigger: reason,
      date,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return awarenessHistorySyncPromise;
  }
  if (!options.force && now - lastAwarenessHistorySyncAt < RW_AWARENESS_HISTORY_DEDUP_MS) {
    appendAwarenessDiagnosticLog('business-sync-background-skip', {
      reason: 'dedup-recent',
      trigger: reason,
      date,
      elapsedMs: now - lastAwarenessHistorySyncAt,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  awarenessHistorySyncPromise = (async () => {
    const startedAt = Date.now();
    homeDataSyncing.value = true;
    appendAwarenessDiagnosticLog('business-sync-background-start', {
      trigger: reason,
      date,
      dataTypes: RW_HOME_HISTORY_DATA_TYPES,
      timeoutMs: RW_HOME_HISTORY_SYNC_TIMEOUT_MS,
      force: options.force === true,
      snapshot: getAwarenessConnectionSnapshot()
    });

    try {
      await syncRwHomeDeviceTimeBeforeHistory(reason);
      const result = await ringBusinessBridge.syncBusinessHistoryPage({
        page: 'awareness',
        date,
        dataTypes: RW_HOME_HISTORY_DATA_TYPES,
        allowRwDeviceSync: true,
        timeoutMs: RW_HOME_HISTORY_SYNC_TIMEOUT_MS
      });
      const records = Array.isArray((result as any)?.records) ? (result as any).records : [];
      appendAwarenessDiagnosticLog('business-sync-background-result', {
        trigger: reason,
        date,
        elapsedMs: Date.now() - startedAt,
        status: (result as any)?.status || (result ? 'success' : 'empty'),
        recordCount: records.length,
        uploaded: (result as any)?.uploaded,
        packetShape: (result as any)?.packetShape,
        sourceType: (result as any)?.sourceType,
        snapshot: getAwarenessConnectionSnapshot()
      });

      lastAwarenessHistorySyncAt = Date.now();
      appendAwarenessDiagnosticLog('business-sync-refresh-overview-start', {
        trigger: reason,
        date,
        recordCount: records.length,
        snapshot: getAwarenessConnectionSnapshot()
      });
      await refreshAwarenessBusinessOverview(date);
      appendAwarenessDiagnosticLog('business-sync-refresh-overview-result', {
        trigger: reason,
        date,
        balanceScore: summarizeAwarenessResponse(balanceScoreObj.value),
        sleepOverview: summarizeAwarenessResponse(sleepOverviewObj.value),
        motionOverview: summarizeAwarenessResponse(motionOverviewObj.value),
        stressDetail: summarizeAwarenessResponse(stressDetailObj.value),
        vitalSign: summarizeAwarenessResponse(vitalSignObj.value),
        snapshot: getAwarenessConnectionSnapshot()
      });
  } catch (error) {
    appendAwarenessDiagnosticLog('business-sync-background-failed', {
      trigger: reason,
      date,
      elapsedMs: Date.now() - startedAt,
      error: formatBleErrorMessage(error, '\u9996\u9875\u5386\u53f2\u540c\u6b65\u5931\u8d25'),
      rawError: getAwarenessRawError(error),
      snapshot: getAwarenessConnectionSnapshot()
    });
    await refreshAwarenessBusinessOverview(date).catch((overviewError) => {
      appendAwarenessDiagnosticLog('business-sync-refresh-overview-failed', {
        trigger: reason,
        date,
        error: formatBleErrorMessage(overviewError, '首页概览刷新失败'),
        rawError: getAwarenessRawError(overviewError),
        snapshot: getAwarenessConnectionSnapshot()
      });
    });
    } finally {
      homeDataSyncing.value = false;
      awarenessHistorySyncPromise = null;
    }
  })();

  return awarenessHistorySyncPromise;
};
function getHealthAvgScore() {
  const sleepScore = balanceScoreObj.value?.sleepScore || 0;
  const vitalSignsScore = balanceScoreObj.value?.vitalSignScore || 0;
  const motionScore = balanceScoreObj.value?.activityScore || 0;
  const relaxationScore = balanceScoreObj.value?.relaxScore || 0;
  return (sleepScore + vitalSignsScore + motionScore + relaxationScore) / 4;
};

const handleDateClick = async (index: number) => {
  selectedDayIndex.value = index;
  const currentDate = dateList.value[index].date;
  selectData.value = currentDate;
  await refreshAwarenessBusinessOverview(formatLocalDate(currentDate));
};
const openTimePicker = () => {
  calendar.value.open();
};
const confirm = async (date: any) => {

  let selectedDate;
  selectedDate = new Date(date.fulldate);


  const month = (selectedDate.getMonth() + 1).toString().padStart(2, '0');
  const day = selectedDate.getDate().toString().padStart(2, '0');

  selectedDateInfo.value = {
    year: selectedDate.getFullYear().toString(),
    monthDay: `${month}-${day}`
  };


  hasSelectedDate.value = true;
  selectedDayIndex.value = 3;
  selectData.value = selectedDate;
  const currentDate = formatLocalDate(selectedDate);
  await refreshAwarenessBusinessOverview(currentDate);
};

const initBalanceChart = async () => {
  if (!chartRef1.value) return;

  try {
    const chart = await chartRef1.value.init(echarts);
    const sleepScore = balanceScoreObj.value?.sleepScore || 0;
    const vitalSignsScore = balanceScoreObj.value?.vitalSignScore || 0;
    const motionScore = balanceScoreObj.value?.activityScore || 0;
    const relaxationScore = balanceScoreObj.value?.relaxScore || 0;
    const indicatorNames = ['\u7761\u7720', '\u751f\u547d\u4f53\u5f81', '\u6d3b\u52a8', '\u653e\u677e\u72b6\u6001'];

    const radarValues = [sleepScore, vitalSignsScore, motionScore, relaxationScore];


    const dynamicOption = {
      ...chartOptionSecound,
      radar: {
        ...chartOptionSecound.radar,
        indicator: indicatorNames.map((name, index) => ({
          name: `{a|${name}} {b|${radarValues[index]}}`,
          max: 100
        })),

        axisName: {
          rich: {
            a: {
              color: '#333',
              fontSize: 14
            },
            b: {
              color: '#2E70FC',
              fontSize: 14
            }
          }
        }
      },
      series: [
        {
          ...chartOptionSecound.series[0],
          data: [
            {
              ...chartOptionSecound.series[0].data[0],
              value: radarValues
            }
          ]
        }
      ]
    };

    chart.setOption(dynamicOption);
  } catch (error) {
  }
};


const initSleepChart = async () => {
  if (!chartRef3.value) return;

  try {
    const chart = await chartRef3.value.init(echarts);


    const modifiedOption = {
      ...chartOptionThird,
      series: [
        {
          ...chartOptionThird.series[0],
          data: [
            {
              ...chartOptionThird.series[0].data[0],
              value: sleepScoreNumber.value
            }
          ]
        }
      ]
    };

    chart.setOption(modifiedOption);
  } catch (error) {
  }
};


const initSportChart = async () => {
  if (!chartRef2.value) return;
  try {
    const chart = await chartRef2.value.init(echarts);
    const dynamicOption = {
      ...chartOptionFirst,
      series: [
        {
          ...chartOptionFirst.series[0],
          data: [{ value: firstCricle.value }],
          progress: {
            ...chartOptionFirst.series[0].progress,
            show: firstCricle.value > 0
          }
        },
        {
          ...chartOptionFirst.series[1],
          data: [{ value: secoundCricle.value }],
          progress: {
            ...chartOptionFirst.series[1].progress,
            show: secoundCricle.value > 0
          }
        },
        {
          ...chartOptionFirst.series[2],
          data: [{ value: thirdCricle.value }],
          progress: {
            ...chartOptionFirst.series[2].progress,
            show: thirdCricle.value > 0
          }
        }
      ]
    };
    chart.setOption(dynamicOption);
  } catch (error) {
  }
};
const getProcessedOption = () => {
  const newOption = JSON.parse(JSON.stringify(vitalOption));
  const heartRateChart = Array.isArray(vitalSignObj.value?.heartRateChart) ? vitalSignObj.value.heartRateChart : [];
  const fallbackHeartRateData = vitalHeartRateNumber.value > 0 ? [vitalHeartRateNumber.value] : [];
  const fullXData = heartRateChart.length > 0 ? heartRateChart.map((item: Point) => item.time?.toString() || '00:00') : fallbackHeartRateData.map(() => '\u5f53\u524d');

  const fullSeriesData = heartRateChart.length > 0 ? heartRateChart.map((item: Point) => Number(item.value)) : fallbackHeartRateData;
  // const fullSeriesData = [62, 60, 58, 59, 61, 63, 70, 75, 80, 78, 76, 72, 78, 82, 85, 83, 80, 77, 75, 73, 70, 68, 65, 63];
  newOption.xAxis.data = fullXData;
  newOption.series[0].data = fullSeriesData;
  return newOption;
};
const getRelaxOption = () => {
  const newOption = JSON.parse(JSON.stringify(relaxOption));
  const stressChart = Array.isArray(stressDetailObj.value?.stressChart) ? stressDetailObj.value.stressChart : [];
  const fallbackStressData = relaxStressNumber.value > 0 ? [relaxStressNumber.value] : [];
  const fullXData = stressChart.length > 0 ? stressChart.map((item: Point) => item.time?.toString() || '00:00') : fallbackStressData.map(() => '\u5f53\u524d');

  const fullSeriesData = stressChart.length > 0 ? stressChart.map((item: Point) => Number(item.value)) : fallbackStressData;
  // const fullSeriesData = [62, 60, 58, 59, 61, 63, 70, 75, 80, 78, 76, 72, 78, 82, 85, 83, 80, 77, 75, 73, 70, 68, 65, 63];
  newOption.xAxis.data = fullXData;
  newOption.series[0].data = fullSeriesData;
  return newOption;
};
const initVitalChart = async () => {
  if (!chartVitalRef.value) return;
  try {
    const pie = await chartVitalRef.value.init(echarts);
    pie.setOption(getProcessedOption());
  } catch (error) {
  }
};
const initRelaxChart = async () => {
  if (!chartRelaxlRef.value) return;
  try {
    const pie = await chartRelaxlRef.value.init(echarts);
    pie.setOption(getRelaxOption());
  } catch (error) {
  }
};
const getRingRefreshTimeoutMs = () => (isAwarenessRwRing() ? 35000 : LEGACY_HOME_DEVICE_INFO_TIMEOUT_MS);
const executeCommandsSequentially = async () => {
  if (awarenessRefreshPromise) return awarenessRefreshPromise;

  const hasCachedSnapshot = hasAwarenessCachedSnapshot();
  const now = Date.now();
  const isRwRing = isAwarenessRwRing();
  if (isRwRing && hasCachedSnapshot && now - lastAwarenessRefreshAt < RW_AWARENESS_REFRESH_DEDUP_MS) {
    return;
  }

  awarenessRefreshPromise = (async () => {
    let started = false;
    const startedAt = Date.now();
    const protocol = userStore.deviceInfo?.protocol || ringStore.deviceInfo?.protocol || 'unknown';
    try {
      homeDataSyncing.value = true;
      userStore.updateIsSending(true);
      started = true;
      sendTimer.value = setTimeout(() => {
        userStore.updateIsSending(false);
      }, 20000);
      appendAwarenessDiagnosticLog('legacy-home-sync-start', {
        protocol,
        hasCachedSnapshot,
        snapshot: getAwarenessConnectionSnapshot()
      });
      await ensureCommunicationReady();
      const refreshResult = await refreshHealthData({
        includeDeviceTime: false,
        includeCollectPeriod: false,
        includeDeviceInfo: !isRwRing || !hasCachedSnapshot,
        includeRealtimeMetrics: false,
        includeHistorySnapshot: false,
        timeoutMs: getRingRefreshTimeoutMs()
      });
      appendAwarenessDiagnosticLog('legacy-home-device-info-result', {
        protocol,
        elapsedMs: Date.now() - startedAt,
        result: refreshResult,
        battery: displayBatteryValue.value,
        snapshot: getAwarenessConnectionSnapshot()
      });
      if (!isRwRing) {
        const historyStartedAt = Date.now();
        const historyDate = formatLocalDate(new Date());
        appendAwarenessDiagnosticLog('legacy-home-history-read-start', {
          protocol,
          date: historyDate,
          timeoutMs: LEGACY_HOME_HISTORY_SYNC_TIMEOUT_MS,
          snapshot: getAwarenessConnectionSnapshot()
        });
        const historyResult = await readLocalData(false, historyDate, undefined, {
          timeoutMs: LEGACY_HOME_HISTORY_SYNC_TIMEOUT_MS
        });
        const records = Array.isArray((historyResult as any)?.records) ? (historyResult as any).records : [];
        appendAwarenessDiagnosticLog('legacy-home-history-read-result', {
          protocol,
          date: historyDate,
          elapsedMs: Date.now() - historyStartedAt,
          status: (historyResult as any)?.status,
          uploaded: (historyResult as any)?.uploaded,
          recordCount: records.length,
          receivedCount: Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0,
          localDataLength: Array.isArray(userStore.localData) ? userStore.localData.length : 0,
          sample: records.slice(0, 2),
          snapshot: getAwarenessConnectionSnapshot()
        });
      }
      lastAwarenessRefreshAt = Date.now();
      userStore.updateIsSending(false);
      return;
    } catch (error) {
      appendAwarenessDiagnosticLog('legacy-home-sync-failed', {
        protocol,
        elapsedMs: Date.now() - startedAt,
        error: formatBleErrorMessage(error, 'legacy home sync failed'),
        rawError: getAwarenessRawError(error),
        snapshot: getAwarenessConnectionSnapshot()
      });
    } finally {
      if (started) {
        clearTimer();
        userStore.updateIsSending(false);
      }
      homeDataSyncing.value = false;
      awarenessRefreshPromise = null;
    }
  })();
  return awarenessRefreshPromise;
};

const clearTimer = () => {
  if (sendTimer.value) {
    clearTimeout(sendTimer.value);
    sendTimer.value = null;
  }
};
const showStartGirlCard = ref(false);
onLoad(async () => {
  if (!userStore.token) {
    return;
  }
});
onShow(async () => {
  try {
    if (!userStore.token) {
      return;
    }
    appendAwarenessDiagnosticLog('page-show', {
      snapshot: getAwarenessConnectionSnapshot()
    });
    pullDownProgress.value = 0;
    pullDownRefresh.value = true;

    // popupSteps.value.open();
    // if (!userStore.token) {
    //   return;
    // }
    // popupSteps.value.open();

    const now = new Date();
    const y = now.getFullYear();
    const m = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    periodTodayDate.value = `${y}-${m}-${d}`;

    today.value = new Date();
    yesterday.value = getYesterday(today.value);
    beforeYesterday.value = getBeforeYesterday(today.value);
    void requestAwarenessAuxiliary('unhealthDict', today.value, () =>
      getSystemUnhealthDict({}, getAwarenessSilentRequestConfig())
    ).then((systemSync) => {
      if (systemSync) uni.setStorageSync('unhealthDict', systemSync);
    });
    void requestAwarenessAuxiliary('ruleTypeDict', today.value, () =>
      getSystemRuleTypeDict({}, getAwarenessSilentRequestConfig())
    ).then((ruleTypeSync) => {
      if (ruleTypeSync) uni.setStorageSync('ruleTypeDict', ruleTypeSync);
    });
    const userInfo = uni.getStorageSync('userInfo');
    if (userInfo.sex == 1) {
      void (async () => {
      const detailData = await requestAwarenessAuxiliary('userGirlHealthAll', today.value, () =>
        getUserGirlHealthAll({}, getAwarenessSilentRequestConfig())
      );
      const todayTime = new Date().getTime();
      if (detailData != null && detailData != '') {
        if (detailData.predictedCycle != null) {
          if (detailData.predictedCycle.menstrual != null) {
            uni.setStorageSync('menstrual', detailData.predictedCycle.menstrual);
            const targetTime = new Date(detailData.predictedCycle.menstrual.start);
            const targetEndTime = new Date(detailData.predictedCycle.menstrual.end);
            if (todayTime >= targetTime.getTime() && todayTime <= targetEndTime.getTime()) {
              currentPhaseIndex.value = 0;
              periodTip.value = 'Current menstrual phase';
            }
          }
          if (detailData.predictedCycle.ovulation != null) {
            const pretargetTime = new Date(detailData.predictedCycle.ovulation.start);
            const pretargetEndTime = new Date(detailData.predictedCycle.ovulation.end);
            uni.setStorageSync('ovulation', detailData.predictedCycle.ovulation);
            if (todayTime >= pretargetTime.getTime() && todayTime <= pretargetEndTime.getTime()) {
              currentPhaseIndex.value = 1;
              periodTip.value = 'Current ovulation phase';
            }
          }
          if (detailData.predictedCycle.fertility != null) {
            uni.setStorageSync('fertility', detailData.predictedCycle.fertility);
          }
          if (detailData.predictedCycle.safe != null) {
            uni.setStorageSync('safe', detailData.predictedCycle.safe);
          }
        }
      }
      const healthData = await requestAwarenessAuxiliary('girlHealth', today.value, () =>
        getGirlHealth({}, getAwarenessSilentRequestConfig())
      );
      if (healthData == null) {
        showStartGirlCard.value = true;
        showPeriodDetail.value = false;
      } else {
        showStartGirlCard.value = false;
        showPeriodDetail.value = true;
      }
      })().catch((error) => {
        appendAwarenessDiagnosticLog('girl-health-background-load-failed', {
          error: formatBleErrorMessage(error, 'girl health background load failed')
        });
      });

    }


    yesterdayInfo.value = getDateInfo(yesterday.value);
    beforeYesterdayInfo.value = getDateInfo(beforeYesterday.value);
    // await connectReload();
    userStore.fetchUserInfo();
    pullDownProgress.value = 30;
    if (selectedDayIndex.value) {

      const dayIndex = Number(selectedDayIndex.value) ?? 2;
      selectedDayIndex.value = dayIndex;

      if (dayIndex !== 3) {
        await handleDateClick(selectedDayIndex.value);
      } else {

        if (selectData.value) {

          const formattedDate = uni.$uv.timeFormat(selectData.value, 'yyyy-mm-dd');
          if (formattedDate && formattedDate !== 'NaN-NaN-NaN') {
            await confirm({ fulldate: formattedDate });
          }
        }
      }
    }

    await Promise.all([initBalanceChart(), initSportChart(), initVitalChart(), initRelaxChart(), initSleepChart()]);
    if (isAwarenessRwRing()) {
      void syncRwHomeHistoryAndRefreshOverview(getSelectedDetailDate(), 'page-show');
    } else if (hasAwarenessCommunicationReady()) {
      if (claimAwarenessHomeSyncSession('legacy-page-show')) {
        appendAwarenessDiagnosticLog('legacy-home-page-show-sync-started', {
          snapshot: getAwarenessConnectionSnapshot()
        });
        void executeCommandsSequentially()
          .then(() => refreshAwarenessBusinessOverview(getSelectedDetailDate()))
          .then(() => {
            appendAwarenessDiagnosticLog('legacy-home-page-show-sync-result', {
              snapshot: getAwarenessConnectionSnapshot()
            });
          })
          .catch((syncError) => {
            appendAwarenessDiagnosticLog('legacy-home-page-show-sync-failed', {
              error: formatBleErrorMessage(syncError, 'legacy home sync failed'),
              rawError: getAwarenessRawError(syncError),
              snapshot: getAwarenessConnectionSnapshot()
            });
          });
      }
    }
    pullDownProgress.value = 100;
  } catch (error) {
    const typedError = error as { msg?: unknown; errMsg?: unknown; message?: unknown };
    const message = typedError?.msg || typedError?.errMsg || typedError?.message || '';
    const normalizedMessage = String(message).trim().toLowerCase().replace(/[\s._-]+/g, '');
    if (normalizedMessage !== 'requestok') {
      // Network and BLE refresh errors are surfaced through page state/toasts elsewhere.
      appendAwarenessDiagnosticLog('page-show-error', {
        message: formatBleErrorMessage(error, '\u5237\u65b0\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5'),
        snapshot: getAwarenessConnectionSnapshot()
      });
    }
  } finally {
    pullDownRefresh.value = false;
    pullDownProgress.value = 0;
  }
});
onHide(() => {
  // clearTimer();
});
const scrollTop = ref(0);
onPageScroll((e) => {
  scrollTop.value = e.scrollTop;
});
onUnload(() => {
  if (chartRef1.value && chartRef1.value) {
    chartRef1.value?.dispose();
  }
  if (chartRef2.value && chartRef2.value) {
    chartRef2.value?.dispose();
  }
  if (chartVitalRef.value && chartVitalRef.value) {
    chartVitalRef.value?.dispose();
  }
  if (chartRelaxlRef.value && chartRelaxlRef.value) {
    chartRelaxlRef.value?.dispose();
  }
  clearTimer();
});
onPullDownRefresh(async () => {
  let pullDownInterval: NodeJS.Timeout | null = null;
  try {
    pullDownRefresh.value = true;
    pullDownProgress.value = 0;
    selectedDayIndex.value = 2;
    pullDownProgress.value = 30;
    if (isAwarenessRwRing()) {
      pullDownProgress.value = 60;
      await syncRwHomeHistoryAndRefreshOverview(formatLocalDate(new Date()), 'pull-down-refresh', { force: true });
      pullDownProgress.value = 100;
      return;
    }
    if (hasAwarenessCommunicationReady()) {
      appendAwarenessDiagnosticLog('legacy-home-pull-down-sync-started', {
        snapshot: getAwarenessConnectionSnapshot()
      });
      pullDownProgress.value = 60;
      await executeCommandsSequentially();
      pullDownProgress.value = 80;
      await refreshAwarenessBusinessOverview(formatLocalDate(new Date()));
      appendAwarenessDiagnosticLog('legacy-home-pull-down-sync-result', {
        snapshot: getAwarenessConnectionSnapshot()
      });
      pullDownProgress.value = 100;
      return;
    }
    await refreshAwarenessBusinessOverview(formatLocalDate(new Date()));
    pullDownProgress.value = 100;


  } catch (error) {
    const typedError = error as { msg?: unknown; errMsg?: unknown; message?: unknown };
    const message = typedError?.msg || typedError?.errMsg || typedError?.message || '';
    const normalizedMessage = String(message).trim().toLowerCase().replace(/[\s._-]+/g, '');
    if (normalizedMessage !== 'requestok') {
      appendAwarenessDiagnosticLog('pull-down-refresh-error', {
        message: formatBleErrorMessage(error, '\u5237\u65b0\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5'),
        rawError: getAwarenessRawError(error),
        snapshot: getAwarenessConnectionSnapshot()
      });
      if (!isAwarenessRwRing() || !isAwarenessNetworkTimeoutError(error)) {
        uni.showToast({
          title: formatBleErrorMessage(error, '\u5237\u65b0\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5'),
          icon: 'none',
          duration: 2000
        });
      }
    }
  } finally {
    pullDownRefresh.value = false;
    pullDownProgress.value = 0;
    uni.stopPullDownRefresh();
  }
});
</script>

<template>
  <page-meta :page-style="fixedPageStyle"></page-meta>
  <view style="position: relative">
    <uv-navbar placeholder leftIcon="" title="首页" :bgColor="scrollTop > 0 ? '#f1f3f6' : 'rgba(255, 255, 255, 0)'"></uv-navbar>
    <view style="position: absolute; top: 0; left: 0; width: 100%">
      <uv-image src="/static/images/bg01.png" width="100%" mode="widthFix"></uv-image>
    </view>
    <view class="pt-30 pr-30 pb-100 pl-30 relative" style="z-index: 1; box-sizing: border-box">
      <!-- 自定义的步骤条 -->
      <!-- <custom-steps></custom-steps> -->
      <view class="pt-30 pr-30 pl-30 relative mb-30" style="z-index: 1; box-sizing: border-box">
        <view class="flex jc-between">
          <view class="flex">
            <view
              class="calendar-day flex fd-c jc-center ai-center mr-20"
              :class="{
                'calendar-day--selected': selectedDayIndex === 3
              }"
              @tap="openTimePicker()"
            >
              <view class="calendar-day__label" :class="selectedDayIndex === 3 ? 't-white' : 't-979797'">
                <template v-if="hasSelectedDate">
                  <view class="ta-c">{{ selectedDateInfo.year }}</view>
                  <view class="ta-c">{{ selectedDateInfo.monthDay }}</view>
                </template>
                <template v-else>
                  <view class="ta-c">选择</view>
                  <view class="ta-c">日期</view>
                </template>
              </view>
            </view>
            <view
              v-for="(dateItem, index) in dateList"
              :key="index"
              class="calendar-day flex fd-c jc-center ai-center mr-20"
              :class="{
                'calendar-day--selected': index === selectedDayIndex
              }"
              @tap="handleDateClick(index)"
            >
              <!-- @tap="handleDateClick(index)" -->
              <view class="calendar-day__label" :class="index === selectedDayIndex ? 't-white' : 't-979797'">
                {{ dateItem.info.week }}
              </view>
              <view class="calendar-day__date" :class="index === selectedDayIndex ? 't-white' : ''">
                <template v-if="index === 2">
                  <uv-icon name="arrow-down" color="#fff" size="14" v-if="index === selectedDayIndex"></uv-icon>
                  <uv-icon name="arrow-down" color="#010101" size="14" v-else></uv-icon>
                </template>
                <template v-else>
                  {{ dateItem.info.day }}
                </template>
              </view>
            </view>
          </view>
          <!-- <view class="flex ai-center jc-center">
            <view v-if="userStore.isReconnecting === '0' || userStore.isReconnecting == ''" class="bluetooth-transition bluetooth-disconnected">
              <uv-image src="/static/images/mine/bluetooth03.png" width="48rpx" height="48rpx"></uv-image>
            </view>
            <view class="flex fd-c ai-center bluetooth-transition bluetooth-connecting" v-else-if="userStore.isReconnecting === '1'">
              <uv-image src="/static/images/mine/bluetooth01.png" width="48rpx" height="48rpx"></uv-image>
              <view class="fs-20">
                <text>连接中</text>
              </view>
            </view>
            <view v-else-if="userStore.isReconnecting === '2'" class="bluetooth-transition bluetooth-connected flex fd-c ai-center">
              <uv-image src="/static/images/mine/bluetooth02.png" width="48rpx" height="48rpx"></uv-image>
              <view class="fs-20">{{ latestBattery ? latestBattery.value : '' }}</view>
            </view>
          </view> -->
          <view class="flex ai-center jc-center">
            <!-- 调试信息（可选） -->
            <!-- <view v-if="false" style="position: absolute; top: -30rpx; left: 0; background: rgba(0,0,0,0.7); color: white; padding: 5rpx; font-size: 20rpx; z-index: 9999;">
    调试: {{ debugBluetoothInfo }}
  </view> -->

            <!-- 使用计算属性进行条件渲染 -->
            <view v-if="bluetoothStatus.isDisconnected" class="bluetooth-transition bluetooth-disconnected">
              <uv-image :src="bluetoothStatus.iconPath" width="48rpx" height="48rpx"></uv-image>
            </view>

            <view v-else-if="bluetoothStatus.isConnecting" class="bluetooth-transition bluetooth-connecting flex fd-c ai-center">
              <uv-image :src="bluetoothStatus.iconPath" width="48rpx" height="48rpx"></uv-image>
              <view class="fs-20">
                <text>{{ bluetoothStatus.statusText }}</text>
              </view>
            </view>

            <view v-else-if="bluetoothStatus.isConnected" class="bluetooth-transition bluetooth-connected flex fd-c ai-center">
              <view class="bluetooth-icon-wrap" :class="{ 'bluetooth-icon-wrap--syncing': bluetoothStatus.isSyncing }">
                <uv-image :src="bluetoothStatus.iconPath" width="48rpx" height="48rpx"></uv-image>
              </view>
              <view v-if="bluetoothStatus.isSyncing" class="fs-20 bluetooth-sync-text">{{ bluetoothStatus.syncingText }}</view>
              <view v-else class="fs-20">{{ bluetoothStatus.batteryText }}</view>
            </view>

            <!-- 默认状态（可选） -->
            <!-- <view v-else class="bluetooth-transition bluetooth-disconnected">
    <uv-image src="/static/images/mine/bluetooth03.png" width="48rpx" height="48rpx"></uv-image>
  </view> -->
          </view>
        </view>
      </view>
      <!-- <uv-calendar ref="calendar" :minDate="minDate" :maxDate="maxDate" @confirm="confirm"></uv-calendar> -->
      <!-- <uv-calendar ref="calendar" mode="single" @confirm="confirm"></uv-calendar> -->
      <uni-calendar ref="calendar" :insert="false" @confirm="confirm" />

      <!-- 身心平衡卡片（已隐藏）
      <view class="module-card p-10 bg-white mt-30 r-50">
        <view class="health-section p-30 r-50">
          <view class="health-header mb-40">
            <view class="health-title fs-36">
              身心平衡
              <DetailInfo id="mind_body_balance" v-model:isPopupActive="isPopupActive"></DetailInfo>
            </view>
            <view class="health-status flex ai-end">
              <view class="health-status__label t-979797">当前健康状态</view>
              <view class="health-status__separator ml-10 mr-10">|</view>
              <view class="relative">
                <view class="health-status__score fs-72 ta-c" style="line-height: 100%; width: 250rpx">{{ healthAvgScore }}</view>
                <view class="absolute" style="z-index: 0; bottom: -5rpx">
                  <uv-image src="/static/images/bg02.png" width="130rpx" mode="widthFix" class="health-status__bg"></uv-image>
                </view>
              </view>
            </view>
          </view>
          <view class="health-chart" style="width: 100%; height: 420rpx">
            <l-echart ref="chartRef1" @finished="initBalanceChart" style="width: 100%; height: 420rpx"></l-echart>
          </view>
        </view>
      </view>
      -->

      <!-- 睡眠模块 -->
      <view
        class="module-card sleep-module bg-white p-40 mt-30 r-50"
        @tap="$uv.route('/homeDetail/sleepPage/sleepPage', { selectedDayIndex: selectedDayIndex, selectedDate: selectData })"
      >
        <view class="module-header flex jc-between ai-center mb-30">
          <view class="module-icon-title flex ai-center jc-between">
            <uv-image src="/static/images/icon01.png" width="56rpx" height="56rpx"></uv-image>
            <view class="module-title ml-10 fs-36">
              睡眠
              <DetailInfo id="sleep_score" v-model:isPopupActive="isPopupActive"></DetailInfo>
            </view>
          </view>
          <view class="module-action flex ai-center t-979797">
            <!-- <view class="module-action flex ai-center t-979797"> -->
            <!-- <view class="module-date">今天</view> -->
            <uv-icon name="arrow-right" color="#C6C6C6" size="14"></uv-icon>
          </view>
        </view>
        <view class="module-content flex ai-end jc-between">
          <view>
            <view class="sleep-detail mb-30">
              <text class="fs-72">{{ getSleepDurationHours(sleepDurationMinutes) }}</text>
              <text class="fs-24">小时</text>
              <text class="fs-72">{{ getSleepDurationMinutes(sleepDurationMinutes) }}</text>
              <text class="fs-24">分钟</text>
            </view>
            <view class="mb-10">
              <text class="fs-24">睡眠质量</text>
              <text class="quality-level fs-36 ml-10">{{ sleepQualityText }}</text>
            </view>
            <view class="lineProgressStyle mb-10 ml-10">
              <ProgressBar
                gradient="linear-gradient(270deg, #07a6f1 0%, #6cd6ad 25%, #e6c478 50%, #f99446 75%, #fe4451 100%);"
                :percentage="sleepScoreNumber"
                :custom-container-style="{ width: '100%', height: '16rpx' }"
              />
            </view>
          </view>
          <view class="sleep-chart" style="width: 192rpx; height: 192rpx">
            <l-echart ref="chartRef3" @finished="initSleepChart" style="width: 192rpx; height: 192rpx"></l-echart>
          </view>
        </view>
      </view>
      <!-- 活动模块 -->
      <view
        class="module-card activity-module bg-white p-40 mt-30 r-50"
        @tap="$uv.route('/homeDetail/exercise/exercise', { selectedDayIndex: selectedDayIndex, selectedDate: selectData })"
      >
        <view class="module-header flex jc-between ai-center mb-30">
          <view class="module-icon-title flex ai-center">
            <uv-image src="/static/images/icon09.png" width="56rpx" height="56rpx"></uv-image>

            <view class="module-title ml-10 fs-36">
              活动
              <DetailInfo id="activity" v-model:isPopupActive="isPopupActive"></DetailInfo>
            </view>
          </view>
          <view class="module-action">
            <!-- <view class="module-action"> -->
            <uv-icon name="arrow-right" color="#C6C6C6" size="14"></uv-icon>
          </view>
        </view>
        <view class="module-content flex ai-end jc-between">
          <view class="activity-list">
            <view class="activity-item flex ai-center mb-10">
              <uv-image src="/static/images/icon08.png" width="36rpx" height="36rpx"></uv-image>
              <view class="activity-text ml-10">
                <text class="activity-value fs-36">{{ activityStepValue }}</text>
                <text class="activity-goal t-979797 fs-24">/{{ activityTargetStep }}步</text>
              </view>
            </view>
            <view class="activity-item flex ai-center mb-10">
              <uv-image src="/static/images/icon10.png" width="36rpx" height="36rpx"></uv-image>
              <view class="activity-text ml-10">
                <text class="activity-value fs-36">{{ activityCalorieValue }}</text>
                <text class="activity-goal t-979797 fs-24">/{{ activityTargetCalorie }}{{ activityCalorieUnit }}</text>
              </view>
            </view>
            <view class="activity-item flex ai-center mb-10">
              <uv-image src="/static/images/icon02.png" width="36rpx" height="36rpx"></uv-image>
              <view class="activity-text ml-10">
                <text class="activity-value fs-36">{{ activityMotionTimeValue }}</text>
                <text class="activity-goal t-979797 fs-24">/{{ activityTargetMotionTime }}分钟</text>
              </view>
            </view>
          </view>
          <view class="activity-chart" style="width: 192rpx; height: 192rpx">
            <l-echart ref="chartRef2" @finished="initSportChart" style="width: 192rpx; height: 192rpx"></l-echart>
          </view>
        </view>
      </view>

      <!-- 放松状态模块 -->
      <view
        class="module-card relax-module bg-white p-40 mt-30 r-50"
        @tap="$uv.route('/homeDetail/relaxStatus/relaxStatus', { selectedDayIndex: selectedDayIndex, selectedDate: selectData })"
      >
        <view class="module-header flex jc-between ai-center mb-30">
          <view class="module-icon-title flex ai-center">
            <uv-image src="/static/images/icon04.png" width="56rpx" height="56rpx"></uv-image>
            <view class="module-title ml-10 fs-36">
              压力
              <DetailInfo id="stress" v-model:isPopupActive="isPopupActive"></DetailInfo>
            </view>
          </view>
          <view class="module-action flex ai-center">
            <!-- <view class="module-action flex ai-center"> -->
            <view class="mr-20">
              <!-- <uv-image src="/static/images/icon05.png" width="56rpx" height="56rpx"></uv-image> -->
              <uv-image :src="activeIcon" width="56rpx" height="56rpx"></uv-image>
            </view>
            <uv-icon name="arrow-right" color="#C6C6C6" size="14"></uv-icon>
          </view>
        </view>
        <view class="module-content flex ai-end jc-between">
          <view class="relax-score">
            <text class="score-label">{{ relaxStressStatus }}</text>
          </view>
          <view class="flex ai-center jc-center flex-1 ml-30">
            <l-echart ref="chartRelaxlRef" @finished="initRelaxChart" style="width: 100%; height: 192rpx; margin: 0"></l-echart>
          </view>
          <!-- <uv-image src="/static/images/bg03.png" width="336rpx" mode="widthFix"></uv-image> -->
        </view>
      </view>

      <!-- 生命体征模块 -->
      <view
        class="module-card vital-signs-module bg-white p-40 mt-30 r-50"
        @tap="$uv.route('/homeDetail/vitalSigns/vitalSigns', { selectedDayIndex: selectedDayIndex, selectedDate: selectData })"
      >
        <view class="module-header flex jc-between ai-center mb-30">
          <!-- <view class="module-header flex jc-between ai-center mb-30"> -->
          <view class="module-icon-title flex ai-center">
            <uv-image src="/static/images/icon03.png" width="56rpx" height="56rpx"></uv-image>
            <view class="module-title ml-10 fs-36">
              生命体征
              <DetailInfo id="vital_signs_status" v-model:isPopupActive="isPopupActive"></DetailInfo>
            </view>
          </view>
          <view class="module-action">
            <uv-icon name="arrow-right" color="#C6C6C6" size="14"></uv-icon>
          </view>
        </view>
        <view class="module-summary mb-30">
          <text class="summary-label">综合评分</text>
          <text class="summary-score fs-72" style="line-height: 100%">{{ vitalSignObj?.overallScore || '00' }}</text>
        </view>
        <view class="module-content flex ai-end jc-between">
          <view class="vital-list">
            <view class="vital-item flex ai-center mb-10">
              <uv-image src="/static/images/icon06.png" width="36rpx" height="36rpx"></uv-image>
              <view class="vital-text ml-10">
                <text class="vital-value fs-36">{{ displayHeartRateValue }}</text>
                <text class="vital-unit t-979797">次/分钟</text>
              </view>
            </view>
            <view class="vital-item flex ai-center mb-10">
              <uv-image src="/static/images/icon07.png" width="36rpx" height="36rpx"></uv-image>
              <view class="vital-text ml-10">
                <text class="vital-value fs-36">{{ displayBloodOxygenValue }}</text>
                <text class="vital-unit t-979797">%</text>
              </view>
            </view>
          </view>
          <view class="flex ai-center jc-center flex-1 ml-30">
            <l-echart ref="chartVitalRef" @finished="initVitalChart" style="width: 100%; height: 192rpx; margin: 0"></l-echart>
          </view>
          <!-- <uv-image src="/static/images/bg04.png" width="336rpx" mode="widthFix"></uv-image> -->
        </view>
      </view>

      <!-- 生理期预测卡片 -->
      <view v-if="showStartGirlCard" class="module-card period-card bg-white p-40 mt-30 r-50">
        <!-- 右箭头：绝对定位到卡片右上角 -->
        <view class="period-arrow-right">
          <uv-icon name="arrow-right" color="#C6C6C6" size="14"></uv-icon>
        </view>
        <view class="flex ai-center">
          <!-- 左侧内容 -->
          <view class="flex-1">
            <view class="module-title fs-36 mb-20">生理期管理</view>
            <view class="fs-28 t-979797 mb-30">开始掌握你的生理周期</view>
            <view class="period-btn flex ai-center" @tap="$uv.route('/homeDetail/periodQuestionnaire/periodQuestionnaire')">
              <text class="fs-28 t-white">去开启</text>
            </view>
          </view>
          <!-- 右侧圆形图片 -->
          <view class="period-icon-wrap">
            <uv-image src="/static/images/homeDetail/girl.png" width="150rpx" height="150rpx" mode="aspectFit"></uv-image>
          </view>
        </view>
      </view>

      <!-- 生理期周期详情卡片（点击去开启后展开） -->
      <view v-if="showPeriodDetail" class="module-card period-detail-card bg-white p-40 mt-30 r-50" @tap="$uv.route('/homeDetail/periodDetail/periodDetail')">
        <!-- 标题行 -->
        <view class="flex jc-between ai-center mb-30">
          <view class="fs-34 fw-bold" style="color: #333">当前周期阶段</view>
          <view class="fs-24" style="color: #999">{{ periodTodayDate }}</view>
        </view>
        <!-- 阶段 Tab  : idx === currentPhaseIndex-->
        <view class="period-phases flex jc-between mb-30">
          <view
            v-for="(phase, idx) in periodPhases"
            :key="phase.key"
            class="period-phase-item flex fd-c ai-center jc-center"
            :class="{ 'period-phase-item--active': idx === currentPhaseIndex }"
          >
            <view class="period-phase-icon mb-10">
              <text class="fs-40" :style="{ color: idx === currentPhaseIndex ? '#ffffff' : idx === 0 ? '#ff80b0' : idx === 2 ? '#ff80b0' : '#999' }">{{ phase.icon }}</text>
            </view>
            <view class="fs-24" :style="{ color: idx === currentPhaseIndex ? '#ffffff' : '#666' }">{{ phase.label }}</view>
          </view>
        </view>
        <!-- 提示信息 -->
        <view class="period-tip flex ai-start">
          <!--  <text class="period-tip-icon fs-28 mr-10" style="color: #5b9bd5; flex-shrink: 0">ℹ</text> -->
          <uv-icon name="error-circle-fill" size="13" style="top: 10rpx" color=" #5b9bd5"></uv-icon>
          <text class="fs-26" style="font-size: 9px; line-height: 1.6">{{ periodTip }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.calendar-day {
  width: 118rpx;
  height: 118rpx;
  background-color: #ffffff;
  border-radius: 50%;
  transition: all 0.3s ease;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:last-child {
    margin-right: 0;
  }

  &:active {
    transform: scale(0.95);
  }
}
.calendar-day--selected {
  background: #2e70fc;
}

.vital-item,
.activity-item {
  &:last-child {
    margin-bottom: 0;
  }
}
.health-section {
  background: linear-gradient(136.9deg, #2e70fc0d 0%, #ffffff00 100%);
}
.lineProgressStyle {
  width: 100%;
}

// 生理期周期详情卡片
.period-detail-card {
  .period-phases {
    .period-phase-item {
      flex: 1;
      padding: 20rpx 10rpx;
      border-radius: 20rpx;
      margin: 0 8rpx;
      background: #fafafa;
      transition: all 0.2s ease;

      &:first-child {
        margin-left: 0;
      }
      &:last-child {
        margin-right: 0;
      }

      &--active {
        background: #8b5cf6;
      }
    }
  }

  .period-tip {
    background: #eef5fb;
    border-radius: 16rpx;
    padding: 20rpx 24rpx;
  }
}

// 生理期预测卡片
.period-card {
  position: relative;

  .period-arrow-right {
    position: absolute;
    top: 40rpx;
    right: 40rpx;
  }

  .period-btn {
    display: inline-flex;
    background: linear-gradient(135deg, #ff6eb4, #ff3e8d);
    border-radius: 40rpx;
    padding: 14rpx 36rpx;
    align-self: flex-start;
  }

  .period-icon-wrap {
    flex-shrink: 0;
    width: 150rpx;
    height: 150rpx;
    margin-top: 60rpx; /* 往下移 */
    margin-right: 12rpx; /* 往左移 */
  }
}

// 蓝牙连接状态过渡效果
.bluetooth-transition {
  transition: all 0.3s ease-in-out;
}

.bluetooth-enter-active,
.bluetooth-leave-active {
  transition:
    opacity 0.3s,
    transform 0.3s;
}

.bluetooth-enter-from {
  opacity: 0;
  transform: translateX(-20rpx);
}

.bluetooth-enter-to {
  opacity: 1;
  transform: translateX(0);
}

.bluetooth-leave-from {
  opacity: 1;
  transform: translateX(0);
}

.bluetooth-leave-to {
  opacity: 0;
  transform: translateX(20rpx);
}

// 为每个状态添加特定的动画效果
.bluetooth-disconnected {
  animation: pulse 2s infinite;
}

.bluetooth-connecting {
  animation: pulseStrong 1.5s infinite;
}

.bluetooth-connected {
  animation: fadeInScale 0.5s ease-out;
}

.bluetooth-icon-wrap {
  position: relative;
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bluetooth-icon-wrap--syncing::after {
  content: '';
  position: absolute;
  inset: -6rpx;
  border: 4rpx solid rgba(76, 118, 241, 0.18);
  border-top-color: #4c76f1;
  border-radius: 50%;
  animation: bluetoothSpin 0.85s linear infinite;
}

.bluetooth-sync-text {
  margin-top: 6rpx;
  color: #4c76f1;
  white-space: nowrap;
}

@keyframes bluetoothSpin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@keyframes pulse {
  0% {
    opacity: 0.7;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0.7;
  }
}

@keyframes pulseStrong {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-5rpx);
  }
}

@keyframes fadeInScale {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

</style>
