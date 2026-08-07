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
import { submitData, submitRingHistoryRawFrames } from '@/common/api/homeDetail';
import { buildRingRawHistoryFrames } from '@/api/ringDevice';
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
import { MOTION_CALORIE_DISPLAY_UNIT, normalizeMotionCalorieKcal } from '@/utils/motionCalorie';
import { formatBatteryStatusForDisplay, isBatteryChargingLike } from '@/utils/batteryDisplay';
import { getAppForegroundSessionId } from '@/utils/appForegroundSession';
import {
  assertBackendUploadBinding,
  buildUploadSyncMeta,
  createUploadSessionId,
  markPendingUploadDataDone,
  markPendingUploadDataFailed,
  stagePendingUploadSession,
  uploadPendingRawFramesInBackground
} from '@/utils/dataUploadCompensation';
import {
  getDeviceHistoryCheckpoint,
  normalizeHistoryCheckpointDeviceMac,
  setDeviceHistoryCheckpoint
} from '@/utils/deviceHistoryCheckpoint';
import {
  claimDeviceSyncSession,
  finishDeviceSyncSession,
  normalizeDeviceSyncMac,
  type DeviceSyncSessionClaim
} from '@/utils/deviceSyncSession';
import {
  PERIOD_PHASE_ICON,
  PERIOD_PHASE_INDEX,
  PERIOD_PHASE_LABEL,
  resolvePeriodPhaseIndex,
  resolvePeriodProfileState,
  type PeriodPhaseKey
} from '@/utils/periodPhase';
import {
  buildRingHistorySubmitRecords,
  countRingHistoryRecordMetrics,
  filterUploadedRingHistorySubmitRecordsForDevice,
  getRingHistoryRecordSyncUnixTime,
  getRingHistoryRecordUnixTime,
  isRingHistoryPayload,
  isRingHistoryReadComplete,
  markUploadedRingHistorySubmitRecordsForDevice
} from '@/composables/useRingHistoryUpload';
import { resolveRingProtocol, type RwHistoryDataName } from '@/sdk/ring-ble';
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
const RW_HOME_HISTORY_SYNC_TIMEOUT_MS = 5000;
const LEGACY_HOME_DEVICE_INFO_TIMEOUT_MS = 6000;
const LEGACY_HOME_DEVICE_INFO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const LEGACY_HOME_HISTORY_SYNC_TIMEOUT_MS = 5000;
const LEGACY_HOME_HISTORY_BACKGROUND_TIMEOUT_MS = 4500;
const LEGACY_HOME_EMPTY_HISTORY_FALLBACK_TIMEOUT_MS = 5000;
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
let legacyLocalDataStablePromise: Promise<void> | null = null;
let legacyLocalDataStableUploadScheduled = false;
let legacyLocalDataStableReadyAt = 0;
let legacyLocalDataUploadWatcherActive = false;
let legacyLocalDataUploadWatcherActiveAt = 0;
let legacyLocalDataUploadWatcherPending = false;
let awarenessBusinessRefreshPromise: Promise<void> | null = null;
let awarenessBusinessChartRefreshPromise: Promise<void> | null = null;
let awarenessProcessedRefreshPromise: Promise<void> | null = null;
let legacyHomeDeviceInfoRefreshPromise: Promise<void> | null = null;
let pendingAwarenessBusinessRefreshDate = '';
let pendingAwarenessBusinessRefreshTrigger = '';
let pendingAwarenessBusinessRefreshKey = '';
let runningAwarenessBusinessRefreshKey = '';
const legacyHomeHistoryReadInFlight = ref(false);
const legacyHomeHistoryReadCompletedTick = ref(0);
let legacyHomeHistoryReadPromise: Promise<void> | null = null;
let legacyHomeHistoryReadStartedAt = 0;
let legacyHomeHistoryReadActiveKey = '';
let legacyHomeHistoryReadActiveScopeKey = '';
let lastAwarenessRefreshAt = 0;
let lastAwarenessHistorySyncAt = 0;
let lastAwarenessDeviceTimeSyncAt = 0;
let lastAwarenessHomeUploadSessionKey = '';
let activeAwarenessHomeSyncClaim: DeviceSyncSessionClaim | null = null;
let lastLegacyLocalDataUploadKey = '';
let lastLegacyLocalDataUploadAt = 0;
let lastAwarenessProcessedRefreshAt = 0;
let lastAwarenessFinalRefreshKey = '';
let lastAwarenessFinalRefreshAt = 0;
let lastAwarenessPageShowRefreshKey = '';
let lastAwarenessPageShowRefreshAt = 0;
const awarenessAuxiliaryRefreshAt = new Map<string, number>();
const awarenessHomeSyncCompletedAt = new Map<string, number>();
let cachedBackendUploadBinding:
  | {
      deviceMacNorm: string;
      checkedAt: number;
      binding: Awaited<ReturnType<typeof assertBackendUploadBinding>>;
    }
  | null = null;
const closedLegacyLocalDataUploadSessions = new Map<
  string,
  { uploadDedupKey: string; uploadedUntil: number; completedAt: number; uploadSessionKey: string }
>();
const runningLegacyLocalDataUploadSignatures = new Map<
  string,
  { uploadDedupKey: string; deviceMacNorm: string; signature: string; startedAt: number }
>();
const completedLegacyLocalDataUploadSignatures = new Map<
  string,
  { uploadDedupKey: string; deviceMacNorm: string; signature: string; uploadedUntil: number; completedAt: number }
>();
const RW_AWARENESS_REFRESH_DEDUP_MS = 8000;
const AWARENESS_HOME_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const RW_AWARENESS_HISTORY_DEDUP_MS = AWARENESS_HOME_SYNC_COOLDOWN_MS;
const RW_AWARENESS_DEVICE_TIME_SYNC_DEDUP_MS = 10 * 60 * 1000;
const LEGACY_LOCAL_DATA_UPLOAD_DEDUP_MS = 60 * 1000;
const LEGACY_LOCAL_DATA_CLOSED_SESSION_TTL_MS = 30 * 60 * 1000;
const LEGACY_LOCAL_DATA_UPLOAD_SIGNATURE_TTL_MS = LEGACY_LOCAL_DATA_CLOSED_SESSION_TTL_MS;
const AWARENESS_BACKEND_BINDING_CACHE_MS = 15000;
const LEGACY_LOCAL_DATA_STABLE_WAIT_MS = 500;
const LEGACY_LOCAL_DATA_STABLE_POLL_MS = 200;
const LEGACY_LOCAL_DATA_STABLE_TIMEOUT_MS = 1500;
const LEGACY_LOCAL_DATA_STABLE_READY_TTL_MS = 5000;
const LEGACY_LOCAL_DATA_UPLOAD_WATCHER_STALE_MS = 15000;
const LEGACY_HOME_HISTORY_UPLOAD_SOFT_WAIT_MS = 3500;
const LEGACY_HISTORY_READ_CHECKPOINT_OVERLAP_SECONDS = 10 * 60;
const LEGACY_HOME_HISTORY_READ_RETRY_DEDUP_MS = 5 * 60 * 1000;
const LEGACY_HOME_HISTORY_READ_SCOPE_DEDUP_MS = 5 * 60 * 1000;
const AWARENESS_PROCESSED_REFRESH_DEDUP_MS = 3000;
const AWARENESS_FINAL_REFRESH_DEDUP_MS = 15000;
const AWARENESS_PAGE_SHOW_REFRESH_DEDUP_MS = 5 * 60 * 1000;
const AWARENESS_AUXILIARY_REFRESH_TTL_MS = 5 * 60 * 1000;
const AWARENESS_STRONG_AUXILIARY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GIRL_HEALTH_PROFILE_UPDATED_STORAGE_KEY = 'qkeer_girl_health_profile_updated_at';
const GIRL_HEALTH_PROFILE_EXISTS_STORAGE_KEY_PREFIX = 'qkeer_girl_health_profile_exists';
const GIRL_HEALTH_PROFILE_STORAGE_KEY_PREFIX = 'qkeer_girl_health_profile';
const AWARENESS_BUSINESS_REQUEST_SOFT_TIMEOUT_MS = 8000;
const AWARENESS_AUXILIARY_REQUEST_SOFT_TIMEOUT_MS = 5000;
const AWARENESS_BUSINESS_STAGE_SOFT_TIMEOUT_MS = 10000;
const LEGACY_LOCAL_DATA_TERMINAL_SKIP_REASONS = new Set([
  'checkpoint-covered',
  'all-submit-records-already-uploaded',
  'upload-session-closed',
  'same-signature-uploaded',
  'all-payloads-device-mismatch',
  'missing-device-mac'
]);
const LEGACY_LOCAL_DATA_SILENT_TERMINAL_SKIP_REASONS = new Set([
  'checkpoint-covered',
  'upload-session-closed',
  'same-signature-uploaded'
]);
const LEGACY_DEFAULT_SLEEP_WINDOW_START_HOUR = 21;
const legacyHomeHistoryReadAttemptAt = new Map<string, number>();
const legacyHomeHistoryReadCompletedAt = new Map<string, number>();
const hasAwarenessCommunicationReady = () =>
  hasAnyRingCommunicationReady(userStore.deviceInfo, ringStore.deviceInfo);
const isAwarenessRwRing = () =>
  resolveRingProtocol(userStore.deviceInfo as any) === 'rw' ||
  resolveRingProtocol(ringStore.deviceInfo as any) === 'rw';
const isAwarenessColonSeparatedBleMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());
const pickAwarenessStableMacCandidate = (source: Record<string, any> | null | undefined) => {
  if (!source) return '';
  const advertis = source.advertis || {};
  const deviceIdKey = normalizeHistoryCheckpointDeviceMac(source.deviceId || source.platformDeviceId);
  const preferredCandidates = [
    source.deviceMac,
    source.device_mac,
    source.bluetoothMac,
    source.bleMac,
    source.macAddr,
    source.mac_addr,
    source.normalMac,
    advertis.macInfo,
    advertis.mac,
    advertis.macAddress,
    advertis.deviceMac,
    isAwarenessColonSeparatedBleMac(source.uniMacId) ? source.uniMacId : ''
  ];
  const preferred = preferredCandidates.find((value) => normalizeHistoryCheckpointDeviceMac(value));
  if (preferred) return String(preferred || '').trim();

  const macKey = normalizeHistoryCheckpointDeviceMac(source.mac);
  if (macKey && (!deviceIdKey || macKey !== deviceIdKey)) return String(source.mac || '').trim();
  if (macKey) return String(source.mac || '').trim();
  return isAwarenessColonSeparatedBleMac(source.deviceId) ? String(source.deviceId || '').trim() : '';
};
const getAwarenessDeviceCanonicalMacFromSource = (device: Record<string, any> | null | undefined) => {
  if (!device) return '';
  return pickAwarenessStableMacCandidate(device);
};
const getAwarenessCanonicalDeviceMac = () =>
  getAwarenessDeviceCanonicalMacFromSource(ringStore.boundDevice as Record<string, any>) ||
  getAwarenessDeviceCanonicalMacFromSource(ringStore.deviceInfo as Record<string, any>) ||
  getAwarenessDeviceCanonicalMacFromSource(userStore.deviceInfo as Record<string, any>);
const summarizeAwarenessDevice = (device: Record<string, any> | null | undefined) => ({
  canonicalDeviceMac: getAwarenessDeviceCanonicalMacFromSource(device),
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
  const canonicalDeviceMac = getAwarenessCanonicalDeviceMac();
  const detailPayload =
    details && typeof details === 'object' && !Array.isArray(details)
      ? {
          buildTag: RW_DIAGNOSTIC_BUILD_TAG,
          canonicalDeviceMac,
          ...(details as Record<string, unknown>),
          deviceId: canonicalDeviceMac || (details as Record<string, unknown>).deviceId
        }
      : { buildTag: RW_DIAGNOSTIC_BUILD_TAG, canonicalDeviceMac, deviceId: canonicalDeviceMac, value: details };
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
  const canonicalMac = getAwarenessCanonicalDeviceMac();
  if (canonicalMac) return canonicalMac;
  const device = (ringStore.boundDevice || ringStore.deviceInfo || userStore.deviceInfo || {}) as Record<string, any>;
  return String(
    device.mac ||
      device.advertis?.macInfo ||
      device.deviceMac ||
      device.device_mac ||
      (isAwarenessColonSeparatedBleMac(device.uniMacId) ? device.uniMacId : '') ||
      (isAwarenessColonSeparatedBleMac(device.deviceId) ? device.deviceId : '') ||
      device.deviceId ||
      device.deviceName ||
      device.name ||
      'unknown-device'
  );
};
const getAwarenessHomeUploadSessionKey = () => `${getAppForegroundSessionId() || 'unknown-session'}:${getAwarenessHomeUploadDeviceKey()}`;
const getAwarenessHomeSyncCooldownKey = () => {
  const deviceKey = getAwarenessHomeUploadDeviceKey();
  return normalizeHistoryCheckpointDeviceMac(deviceKey) || deviceKey || 'unknown-device';
};
const getAwarenessHomeSyncUserId = () => {
  const userInfo = (userStore.userInfo || {}) as Record<string, any>;
  return String(userInfo.id || userInfo.user_id || userInfo.userId || userInfo.uid || (userStore as any).userId || 'anonymous');
};
const releaseAwarenessHomeSyncSession = (trigger: string, status = 'released', markCompleted = false) => {
  if (!activeAwarenessHomeSyncClaim) return;
  const releasedClaim = activeAwarenessHomeSyncClaim;
  const completed = status === 'completed' && markCompleted === true;
  finishDeviceSyncSession(releasedClaim, status, completed);
  activeAwarenessHomeSyncClaim = null;
  if (!completed) {
    lastAwarenessHomeUploadSessionKey = '';
  }
  appendAwarenessDiagnosticLog('home-sync-global-session-released', {
    trigger,
    status,
    markCompleted: completed,
    clearedUploadSessionKey: !completed,
    globalSessionKey: releasedClaim.key,
    globalSessionId: releasedClaim.sessionId,
    runningForMs: Date.now() - releasedClaim.startedAt,
    snapshot: getAwarenessConnectionSnapshot()
  });
};
const pruneAwarenessHomeSyncCooldown = () => {
  const now = Date.now();
  awarenessHomeSyncCompletedAt.forEach((completedAt, key) => {
    if (!completedAt || now - completedAt > AWARENESS_HOME_SYNC_COOLDOWN_MS) {
      awarenessHomeSyncCompletedAt.delete(key);
    }
  });
};
const isAwarenessHomeSyncInCooldown = (trigger: string, options: { force?: boolean } = {}) => {
  if (options.force) return false;
  pruneAwarenessHomeSyncCooldown();
  const cooldownKey = getAwarenessHomeSyncCooldownKey();
  const completedAt = awarenessHomeSyncCompletedAt.get(cooldownKey) || 0;
  const elapsedMs = completedAt > 0 ? Date.now() - completedAt : Number.POSITIVE_INFINITY;
  if (completedAt > 0 && elapsedMs < AWARENESS_HOME_SYNC_COOLDOWN_MS) {
    appendAwarenessDiagnosticLog('home-sync-cooldown-skip', {
      trigger,
      cooldownKey,
      elapsedMs,
      cooldownMs: AWARENESS_HOME_SYNC_COOLDOWN_MS,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return true;
  }
  return false;
};
const markAwarenessHomeSyncCompleted = (trigger: string) => {
  const cooldownKey = getAwarenessHomeSyncCooldownKey();
  if (!cooldownKey || cooldownKey === 'unknown-device') {
    releaseAwarenessHomeSyncSession(trigger, 'completed', true);
    return;
  }
  awarenessHomeSyncCompletedAt.set(cooldownKey, Date.now());
  appendAwarenessDiagnosticLog('home-sync-cooldown-mark', {
    trigger,
    cooldownKey,
    cooldownMs: AWARENESS_HOME_SYNC_COOLDOWN_MS,
    snapshot: getAwarenessConnectionSnapshot()
  });
  releaseAwarenessHomeSyncSession(trigger, 'completed', true);
};
const claimAwarenessHomeSyncSession = (trigger: string, options: { force?: boolean } = {}) => {
  if (isAwarenessHomeSyncInCooldown(trigger, options)) {
    return false;
  }
  const uploadSessionKey = getAwarenessHomeUploadSessionKey();
  if (!options.force && activeAwarenessHomeSyncClaim && lastAwarenessHomeUploadSessionKey === uploadSessionKey) {
    appendAwarenessDiagnosticLog('home-sync-session-skipped', {
      reason: 'same-app-foreground-session',
      trigger,
      uploadSessionKey,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }
  const globalClaim = claimDeviceSyncSession({
    userId: getAwarenessHomeSyncUserId(),
    mac: getAwarenessHomeUploadDeviceKey(),
    trigger,
    force: options.force === true,
    cooldownMs: AWARENESS_HOME_SYNC_COOLDOWN_MS,
    staleMs: 2 * 60 * 1000
  });
  if (globalClaim.claimed === false) {
    appendAwarenessDiagnosticLog('home-sync-global-session-skipped', {
      reason: globalClaim.reason,
      trigger,
      uploadSessionKey,
      globalSessionKey: globalClaim.key,
      globalSessionId: globalClaim.sessionId,
      runningForMs: globalClaim.runningForMs,
      completedElapsedMs: globalClaim.completedElapsedMs,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }
  activeAwarenessHomeSyncClaim = globalClaim.claim;
  lastAwarenessHomeUploadSessionKey = uploadSessionKey;
  appendAwarenessDiagnosticLog('home-sync-session-claimed', {
    trigger,
    force: options.force === true,
    uploadSessionKey,
    globalSessionKey: globalClaim.claim.key,
    globalSessionId: globalClaim.claim.sessionId,
    snapshot: getAwarenessConnectionSnapshot()
  });
  return true;
};
const getAwarenessActiveHomeSyncMac = () =>
  normalizeDeviceSyncMac(activeAwarenessHomeSyncClaim?.mac || '');
const getAwarenessLiveDeviceContextMac = () =>
  normalizeDeviceSyncMac(
    getAwarenessDeviceCanonicalMacFromSource(ringStore.deviceInfo as Record<string, any>) ||
      getAwarenessDeviceCanonicalMacFromSource(userStore.deviceInfo as Record<string, any>)
  );
const getAwarenessCurrentContextMac = () => getAwarenessLiveDeviceContextMac();
const validateAwarenessHomeSyncContext = (
  reason: string,
  options: {
    expectedMac?: string;
    requireActive?: boolean;
    requireReady?: boolean;
    allowMissingCurrent?: boolean;
  } = {}
) => {
  const activeMac = getAwarenessActiveHomeSyncMac();
  const expectedMac = normalizeDeviceSyncMac(options.expectedMac || activeMac || getAwarenessHomeUploadDeviceKey());
  const currentMac = getAwarenessCurrentContextMac();

  if (options.requireActive && !activeMac) {
    appendAwarenessDiagnosticLog('home-sync-context-skip', {
      reason,
      skipReason: 'missing-active-session',
      expectedMac,
      currentMac,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }

  if (expectedMac && currentMac && expectedMac !== currentMac) {
    appendAwarenessDiagnosticLog('home-sync-context-mismatch', {
      reason,
      activeMac,
      expectedMac,
      currentMac,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }

  if (expectedMac && !currentMac && !options.allowMissingCurrent) {
    appendAwarenessDiagnosticLog('home-sync-context-skip', {
      reason,
      skipReason: 'missing-current-device-context',
      activeMac,
      expectedMac,
      currentMac,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }

  if (options.requireReady && !hasAwarenessCommunicationReady()) {
    appendAwarenessDiagnosticLog('home-sync-context-skip', {
      reason,
      skipReason: 'communication-not-ready',
      activeMac,
      expectedMac,
      currentMac,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }

  return true;
};
const getLegacyDefaultSleepWindowStartUnixTimestamp = (date = new Date()) =>
  Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, LEGACY_DEFAULT_SLEEP_WINDOW_START_HOUR, 0, 0, 0).getTime() / 1000);
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
const getAwarenessLastReadTimestamp = () => {
  const deviceMac = getAwarenessCheckpointDeviceMac();
  const protocol = getAwarenessCheckpointProtocol();
  const timestamp = getDeviceHistoryCheckpoint(deviceMac, protocol);
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : 0;
};
const pickAwarenessDeviceMacCandidate = (source: Record<string, any> | null | undefined) =>
  pickAwarenessStableMacCandidate(source);
const getAwarenessCheckpointProtocol = () =>
  resolveRingProtocol((ringStore.boundDevice || ringStore.deviceInfo || userStore.deviceInfo || {}) as any);
const getAwarenessUploadDeviceMac = () =>
  pickAwarenessDeviceMacCandidate(ringStore.boundDevice as Record<string, any>) ||
  pickAwarenessDeviceMacCandidate(ringStore.deviceInfo as Record<string, any>) ||
  pickAwarenessDeviceMacCandidate(userStore.deviceInfo as Record<string, any>) ||
  ringStore.normalMac ||
  userStore.normalMac ||
  (isAwarenessColonSeparatedBleMac(ringStore.iosMacId) ? ringStore.iosMacId : '') ||
  (isAwarenessColonSeparatedBleMac(userStore.iosMacId) ? userStore.iosMacId : '');
const getAwarenessCheckpointDeviceMac = () => {
  const submitMac = getAwarenessUploadDeviceMac();
  if (normalizeHistoryCheckpointDeviceMac(submitMac)) return submitMac;
  const candidates = [
    pickAwarenessDeviceMacCandidate(ringStore.boundDevice as Record<string, any>),
    pickAwarenessDeviceMacCandidate(ringStore.deviceInfo as Record<string, any>),
    pickAwarenessDeviceMacCandidate(userStore.deviceInfo as Record<string, any>),
    userStore.normalMac,
    ringStore.normalMac,
    isAwarenessColonSeparatedBleMac(userStore.iosMacId) ? userStore.iosMacId : '',
    isAwarenessColonSeparatedBleMac(ringStore.iosMacId) ? ringStore.iosMacId : ''
  ];
  return candidates.find((item) => normalizeHistoryCheckpointDeviceMac(item)) || '';
};
const getAwarenessPayloadDeviceIdentityValues = (source: Record<string, any> | null | undefined) => {
  if (!source) return [];
  const values = [
    source.platformDeviceId,
    source.platformUniMacId,
    source.mac,
    source.deviceMac,
    source.device_mac,
    source.bluetoothMac,
    source.bleMac,
    source.macAddr,
    source.mac_addr,
    source.normalMac,
    source.advertis?.macInfo,
    source.advertis?.mac,
    source.advertis?.macAddress,
    source.advertis?.deviceMac,
    isAwarenessColonSeparatedBleMac(source.uniMacId) ? source.uniMacId : '',
    isAwarenessColonSeparatedBleMac(source.deviceId) ? source.deviceId : ''
  ];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeHistoryCheckpointDeviceMac(value))
        .filter(Boolean)
    )
  );
};
const getAwarenessDeviceAliasIdentityValues = (source: Record<string, any> | null | undefined, targetDeviceMac: string) => {
  if (!source) return [];
  const target = normalizeHistoryCheckpointDeviceMac(targetDeviceMac);
  if (!target) return [];
  const canonical = normalizeHistoryCheckpointDeviceMac(getAwarenessDeviceCanonicalMacFromSource(source));
  const sourceIdentities = getAwarenessPayloadDeviceIdentityValues(source);
  if (canonical !== target && !sourceIdentities.includes(target)) return [];
  return Array.from(
    new Set(
      [
        targetDeviceMac,
        source.deviceId,
        source.platformDeviceId,
        source.uniMacId,
        source.platformUniMacId,
        source.mac,
        source.advertis?.macInfo,
        source.advertis?.mac,
        source.advertis?.macAddress,
        source.advertis?.deviceMac
      ]
        .map((value) => normalizeHistoryCheckpointDeviceMac(value))
        .filter(Boolean)
    )
  );
};
const getAwarenessDeviceIdentityAliasesForMac = (deviceMac: string) => {
  const target = normalizeHistoryCheckpointDeviceMac(deviceMac);
  if (!target) return [];
  return Array.from(
    new Set(
      [
        target,
        ...getAwarenessDeviceAliasIdentityValues(ringStore.boundDevice as Record<string, any>, deviceMac),
        ...getAwarenessDeviceAliasIdentityValues(ringStore.deviceInfo as Record<string, any>, deviceMac),
        ...getAwarenessDeviceAliasIdentityValues(userStore.deviceInfo as Record<string, any>, deviceMac)
      ].filter(Boolean)
    )
  );
};
const hasAwarenessPayloadDeviceIdentity = (source: Record<string, any> | null | undefined) =>
  getAwarenessPayloadDeviceIdentityValues(source).length > 0;
const isAwarenessPayloadSourceForDevice = (source: Record<string, any> | null | undefined, deviceMac: string) => {
  const target = normalizeHistoryCheckpointDeviceMac(deviceMac);
  if (!target) return false;
  const identities = getAwarenessPayloadDeviceIdentityValues(source);
  if (identities.length === 0) return true;
  const aliases = getAwarenessDeviceIdentityAliasesForMac(deviceMac);
  return identities.some((identity) => aliases.includes(identity));
};
const isAwarenessHistoryPayloadForDevice = (payload: Record<string, any>, deviceMac: string) => {
  const parsed = payload.parsed && typeof payload.parsed === 'object' ? (payload.parsed as Record<string, any>) : payload;
  if (!isAwarenessPayloadSourceForDevice(payload, deviceMac)) return false;
  if (!isAwarenessPayloadSourceForDevice(parsed, deviceMac)) return false;
  const records = Array.isArray(payload.records) ? (payload.records as Array<Record<string, any>>) : [];
  return records.every((record) => !hasAwarenessPayloadDeviceIdentity(record) || isAwarenessPayloadSourceForDevice(record, deviceMac));
};
const filterAwarenessHistoryRecordsForDevice = (records: any[], deviceMac: string) =>
  (records || []).filter((record) => !hasAwarenessPayloadDeviceIdentity(record) || isAwarenessPayloadSourceForDevice(record, deviceMac));
const getAwarenessHistoryPayloadsForDevice = (payloads: any[], deviceMac: string) => {
  const allPayloads = (payloads || []).filter(isRingHistoryPayload) as Array<Record<string, any>>;
  if (!deviceMac) {
    return {
      allPayloads,
      matchedPayloads: allPayloads,
      skippedDeviceMismatchCount: 0
    };
  }
  const matchedPayloads = allPayloads.filter((payload) => isAwarenessHistoryPayloadForDevice(payload, deviceMac));
  return {
    allPayloads,
    matchedPayloads,
    skippedDeviceMismatchCount: Math.max(0, allPayloads.length - matchedPayloads.length)
  };
};
const getAwarenessCurrentHistoryPayloadsForUpload = () =>
  getAwarenessHistoryPayloadsForDevice(Array.isArray(userStore.receivedData) ? userStore.receivedData : [], getAwarenessUploadDeviceMac());
const updateAwarenessDeviceHistoryCheckpoint = (timestamp: number, reason: string) => {
  const deviceMac = getAwarenessCheckpointDeviceMac();
  const protocol = getAwarenessCheckpointProtocol();
  const savedTimestamp = setDeviceHistoryCheckpoint(deviceMac, protocol, timestamp);
  if (savedTimestamp > 0) {
    appendAwarenessDiagnosticLog('device-history-checkpoint-updated', {
      reason,
      protocol,
      deviceMac,
      timestamp: savedTimestamp,
      timeText: formatUnixTimestampForLog(savedTimestamp),
      snapshot: getAwarenessConnectionSnapshot()
    });
  } else {
    appendAwarenessDiagnosticLog('device-history-checkpoint-skip', {
      reason,
      protocol,
      deviceMac,
      timestamp,
      timeText: formatUnixTimestampForLog(timestamp),
      message: 'missing-device-mac-or-invalid-timestamp',
      snapshot: getAwarenessConnectionSnapshot()
    });
  }
  if (savedTimestamp > 0 || timestamp > 0) {
    userStore.updateLastReadTimestamp(Math.max(savedTimestamp || 0, timestamp || 0));
  }
};
const getAwarenessHistoryUploadSinceTimestamp = (isRwRing: boolean) => {
  const lastReadTimestamp = getAwarenessLastReadTimestamp();
  if (lastReadTimestamp > 0) return lastReadTimestamp;
  if (isRwRing) return 0;
  return Math.max(0, getLegacyDefaultSleepWindowStartUnixTimestamp(new Date()));
};
const getAwarenessHistoryReadSinceTimestamp = (isRwRing: boolean) => {
  const uploadSinceTimestamp = getAwarenessHistoryUploadSinceTimestamp(isRwRing);
  const lastReadTimestamp = getAwarenessLastReadTimestamp();
  if (isRwRing || lastReadTimestamp <= 0) return uploadSinceTimestamp;
  return Math.max(0, lastReadTimestamp - LEGACY_HISTORY_READ_CHECKPOINT_OVERLAP_SECONDS);
};
const getLegacyHomeHistoryReadScopeKey = (deviceMac: string, date: string) =>
  `${normalizeHistoryCheckpointDeviceMac(deviceMac) || 'unknown-device'}:${date}`;
const getLegacyHomeHistoryReadKey = (deviceMac: string, date: string, sinceTimestamp: number) =>
  `${getLegacyHomeHistoryReadScopeKey(deviceMac, date)}:${sinceTimestamp}`;
const markLegacyHomeHistoryReadCompletedForDevice = (deviceMac: string, date = formatLocalDate(new Date())) => {
  const scopeKey = getLegacyHomeHistoryReadScopeKey(deviceMac, date);
  if (!scopeKey.startsWith('unknown-device')) {
    legacyHomeHistoryReadCompletedAt.set(scopeKey, Date.now());
  }
};

const pullDownRefresh = ref(false);
const pullDownProgress = ref(0);
const homeDataSyncing = ref(false);
const homeDataRefreshingAfterSync = ref(false);
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
const periodPhases = ref(
  (['menstrual', 'ovulation', 'fertile', 'safe'] as PeriodPhaseKey[]).map((key) => ({
    key,
    icon: PERIOD_PHASE_ICON[key],
    label: PERIOD_PHASE_LABEL[key]
  }))
);
const homeDetailRoutes = {
  sleep: '/homeDetail/sleepPage/sleepPage',
  exercise: '/homeDetail/exercise/exercise',
  relax: '/homeDetail/relaxStatus/relaxStatus',
  vitalSigns: '/homeDetail/vitalSigns/vitalSigns'
} as const;
const HOME_DETAIL_NAVIGATION_LOCK_MS = 2000;
const homeDetailNavigating = ref(false);
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
const getRecordSourceTypeForLog = (record: Record<string, any>) =>
  String(record?.sourceType || record?.source_type || record?.type || '').toLowerCase();
const countSleepSegmentRecordsForLog = (records: Array<Record<string, any>> = []) =>
  records.filter((record) => getRecordSourceTypeForLog(record) === 'l19_sleep_segment').length;
const summarizeRingHistoryTimeRangeForLog = (records: Array<Record<string, any>> = [], useSyncTime = false) => {
  const timestamps = records
    .map((record) => (useSyncTime ? getRingHistoryRecordSyncUnixTime(record) : getRingHistoryRecordUnixTime(record)))
    .filter((timestamp): timestamp is number => Boolean(timestamp && timestamp > 0));
  if (timestamps.length === 0) {
    return {
      count: records.length,
      timestampCount: 0
    };
  }
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  return {
    count: records.length,
    timestampCount: timestamps.length,
    minTimestamp,
    minTime: formatUnixTimestampForLog(minTimestamp),
    maxTimestamp,
    maxTime: formatUnixTimestampForLog(maxTimestamp)
  };
};
const summarizeLegacyUploadRecordsForLog = (records: Array<Record<string, any>> = []) => ({
  startTimeRange: summarizeRingHistoryTimeRangeForLog(records, false),
  syncTimeRange: summarizeRingHistoryTimeRangeForLog(records, true),
  l19SleepSegmentCount: countSleepSegmentRecordsForLog(records)
});
const summarizeLegacyHistoryPayloadsForLog = (payloads: Array<Record<string, any>> = []) => ({
  count: payloads.length,
  tail: payloads.slice(-3).map((payload) => {
    const records = Array.isArray(payload?.records) ? payload.records : [];
    return {
      type: payload?.type,
      protocol: payload?.protocol,
      status: payload?.status,
      totalNum: payload?.totalNum,
      recordCount: records.length,
      recordSummary: summarizeLegacyUploadRecordsForLog(records as Array<Record<string, any>>)
    };
  })
});
const waitForAwarenessMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const enrichAwarenessHistoryRecordForUpload = (
  record: Record<string, any>,
  payload: Record<string, any>,
  parsed: Record<string, any>,
  deviceMac: string,
  extra: Record<string, any> = {}
) => {
  const deviceInfo = (ringStore.deviceInfo || {}) as Record<string, any>;
  const protocol = record.protocol || parsed.protocol || payload.protocol || deviceInfo.protocol;
  const stableIdentity = record.uniMacId || parsed.uniMacId || payload.uniMacId || deviceMac;
  const mac =
    record.mac ||
    record.deviceMac ||
    record.device_mac ||
    parsed.mac ||
    parsed.deviceMac ||
    parsed.device_mac ||
    payload.mac ||
    payload.deviceMac ||
    payload.device_mac ||
    deviceInfo.mac ||
    deviceInfo.advertis?.macInfo ||
    deviceMac;

  return {
    ...record,
    ...extra,
    protocol,
    sourceType: record.sourceType || parsed.type || payload.type,
    deviceId: deviceMac || record.deviceId || parsed.deviceId || payload.deviceId || deviceInfo.deviceId,
    deviceName: record.deviceName || parsed.deviceName || payload.deviceName || deviceInfo.name,
    uniMacId: stableIdentity,
    mac,
    advertis: record.advertis || parsed.advertis || payload.advertis || deviceInfo.advertis
  };
};

const getAwarenessHistoryRecordExtraFromPayload = (payload: Record<string, any>) => {
  const type = String(payload.type || payload.sourceType || '').toLowerCase();
  if (type === 'qkeer_v2_step_list') return { dataType: 'step' };
  if (type === 'qkeer_v2_health_list') return { dataType: 'vital' };
  if (type === 'qkeer_v2_sleep_list') return { dataType: 'sleep' };
  return {};
};

const getAwarenessHistoryRecordUploadKey = (record: Record<string, any>) => {
  const timestamp =
    getRingHistoryRecordSyncUnixTime(record as any) ||
    getRingHistoryRecordUnixTime(record as any) ||
    record.unixTime ||
    record.timestamp ||
    record.recordTime ||
    record.time ||
    '';
  const seq = record.seq ?? record.index ?? record.fileSeq ?? record.fileName ?? '';
  const metricKey = [
    record.dataType,
    record.rawDataType,
    record.sourceType,
    record.sleepState,
    record.sleepDuration,
    record.startTime,
    record.endTime,
    record.heartRate,
    record.hrv,
    record.spo2,
    record.stress,
    record.stepCount,
    record.rawStepCount
  ]
    .map((value) => (value == null ? '' : String(value)))
    .join(',');

  return `${getRecordSourceTypeForLog(record)}|${timestamp}|${seq}|${metricKey}`;
};

const dedupeAwarenessHistoryRecordsForUpload = (records: Array<Record<string, any>>) => {
  const keyedRecords = new Map<string, Record<string, any>>();
  for (const record of records || []) {
    if (!record || typeof record !== 'object') continue;
    const key = getAwarenessHistoryRecordUploadKey(record);
    if (!key || key.replace(/[|,]/g, '') === '') {
      keyedRecords.set(JSON.stringify(record), record);
      continue;
    }
    keyedRecords.set(key, record);
  }
  return Array.from(keyedRecords.values());
};

const buildAwarenessHistoryRecordsFromPayloadsForUpload = (payloads: any[], deviceMac: string) => {
  const records: Array<Record<string, any>> = [];
  for (const payload of payloads || []) {
    if (!payload || typeof payload !== 'object') continue;
    if (deviceMac && !isAwarenessHistoryPayloadForDevice(payload as Record<string, any>, deviceMac)) continue;

    const parsed = payload.parsed && typeof payload.parsed === 'object' ? (payload.parsed as Record<string, any>) : (payload as Record<string, any>);
    const payloadRecords = Array.isArray(payload.records) ? (payload.records as Array<Record<string, any>>) : [];
    const extra = getAwarenessHistoryRecordExtraFromPayload(payload as Record<string, any>);
    payloadRecords.forEach((record) => {
      if (!record || typeof record !== 'object') return;
      records.push(enrichAwarenessHistoryRecordForUpload(record, payload as Record<string, any>, parsed, deviceMac, extra));
    });
  }

  return dedupeAwarenessHistoryRecordsForUpload(records).filter(
    (record) => !deviceMac || !hasAwarenessPayloadDeviceIdentity(record) || isAwarenessPayloadSourceForDevice(record, deviceMac)
  );
};

const buildLegacyLocalDataRawFramesForUpload = (payloads: any[], deviceMac: string) => {
  const keyedFrames = new Map<string, ReturnType<typeof buildRingRawHistoryFrames>[number]>();
  let skippedDeviceMismatchCount = 0;
  for (const payload of payloads || []) {
    if (!payload || typeof payload !== 'object') continue;
    if (deviceMac && !isAwarenessHistoryPayloadForDevice(payload as Record<string, any>, deviceMac)) {
      skippedDeviceMismatchCount += 1;
      continue;
    }
    const parsed = payload.parsed && typeof payload.parsed === 'object' ? payload.parsed : payload;
    const records = Array.isArray(payload.records) ? payload.records : [];
    const frames = buildRingRawHistoryFrames(records, parsed, deviceMac);
    frames.forEach((frame) => {
      if (frame.rawHash) keyedFrames.set(frame.rawHash, frame);
    });
  }
  if (skippedDeviceMismatchCount > 0) {
    appendAwarenessDiagnosticLog('legacy-local-raw-frame-skip', {
      reason: 'device-mismatch',
      deviceMac,
      skippedDeviceMismatchCount,
      totalPayloadCount: payloads?.length || 0,
      rawFrameCount: keyedFrames.size,
      snapshot: getAwarenessConnectionSnapshot()
    });
  }
  return Array.from(keyedFrames.values());
};

const buildLegacyLocalDataUploadBatch = (deviceMac: string, uploadSinceTimestamp: number) => {
  const payloadScope = getAwarenessCurrentHistoryPayloadsForUpload();
  const payloadRecords = buildAwarenessHistoryRecordsFromPayloadsForUpload(payloadScope.matchedPayloads, deviceMac);
  const cachedRecords = filterAwarenessHistoryRecordsForDevice(
    Array.isArray(local.value) ? (local.value as Array<Record<string, any>>) : [],
    deviceMac
  );
  const records = payloadRecords.length > 0 ? payloadRecords : cachedRecords;
  const rawFrames = buildLegacyLocalDataRawFramesForUpload(payloadScope.matchedPayloads, deviceMac);
  const rawMetricCounts = countRingHistoryRecordMetrics(records as Array<Record<string, any>>);
  const builtSubmitArray = buildRingHistorySubmitRecords(records, uploadSinceTimestamp);
  const uploadedRecordFilter = filterUploadedRingHistorySubmitRecordsForDevice(deviceMac, builtSubmitArray);
  const submitArray = uploadedRecordFilter.submitRecords;
  const submitMetricCounts = countRingHistoryRecordMetrics(submitArray as Array<Record<string, any>>);

  return {
    payloadScope,
    source: payloadRecords.length > 0 ? 'matched-payloads' : 'local-cache',
    records,
    rawFrames,
    rawMetricCounts,
    builtSubmitArray,
    uploadedRecordFilter,
    submitArray,
    submitMetricCounts,
    rawRecordSummary: summarizeLegacyUploadRecordsForLog(records as Array<Record<string, any>>),
    submitRecordSummary: summarizeLegacyUploadRecordsForLog(submitArray as Array<Record<string, any>>)
  };
};

const getLegacyLocalDataStableSnapshot = () => {
  const deviceMac = getAwarenessActiveHomeSyncMac() || getAwarenessUploadDeviceMac();
  const deviceMacNorm = normalizeHistoryCheckpointDeviceMac(deviceMac);
  const uploadSinceTimestamp = getAwarenessHistoryUploadSinceTimestamp(false);
  const uploadBatch = deviceMac
    ? buildLegacyLocalDataUploadBatch(deviceMac, uploadSinceTimestamp)
    : {
        payloadScope: getAwarenessCurrentHistoryPayloadsForUpload(),
        source: 'missing-device',
        records: [] as Array<Record<string, any>>,
        rawFrames: [],
        rawMetricCounts: {},
        builtSubmitArray: [],
        uploadedRecordFilter: { submitRecords: [], alreadyUploadedRecords: [], uploadedRecordKeyCount: 0 },
        submitArray: [] as Array<Record<string, any>>,
        submitMetricCounts: {},
        rawRecordSummary: {},
        submitRecordSummary: {}
      };
  const { allPayloads, matchedPayloads, skippedDeviceMismatchCount } = uploadBatch.payloadScope;
  const allRecords = Array.isArray(local.value) ? (local.value as Array<Record<string, any>>) : [];
  const records = uploadBatch.records;
  const builtSubmitRecords = uploadBatch.builtSubmitArray;
  const uploadedRecordFilter = uploadBatch.uploadedRecordFilter;
  const submitRecords = uploadedRecordFilter.submitRecords;
  const rawRange = summarizeRingHistoryTimeRangeForLog(records, false);
  const builtSubmitRange = summarizeRingHistoryTimeRangeForLog(builtSubmitRecords as Array<Record<string, any>>, false);
  const submitRange = summarizeRingHistoryTimeRangeForLog(submitRecords as Array<Record<string, any>>, false);
  const completed = isRingHistoryReadComplete(matchedPayloads as Array<Record<string, any>>);
  const submitMetricCounts = countRingHistoryRecordMetrics(submitRecords as Array<Record<string, any>>);
  const uploadDedupKey = deviceMac ? getLegacyLocalDataUploadKey(deviceMac, uploadSinceTimestamp, submitRecords, submitMetricCounts) : '';
  const checkpointTimestamp = getAwarenessLastReadTimestamp();
  const latestKnownTimestamp = Math.max(rawRange.maxTimestamp || 0, builtSubmitRange.maxTimestamp || 0, submitRange.maxTimestamp || 0);
  const checkpointCovered =
    Boolean(deviceMacNorm) && checkpointTimestamp > 0 && latestKnownTimestamp > 0 && checkpointTimestamp >= latestKnownTimestamp;

  return {
    signature: [
      deviceMacNorm || 'unknown-device',
      allPayloads.length,
      matchedPayloads.length,
      skippedDeviceMismatchCount,
      allRecords.length,
      records.length,
      builtSubmitRecords.length,
      submitRecords.length,
      rawRange.minTimestamp || 0,
      rawRange.maxTimestamp || 0,
      builtSubmitRange.minTimestamp || 0,
      builtSubmitRange.maxTimestamp || 0,
      submitRange.minTimestamp || 0,
      submitRange.maxTimestamp || 0,
      completed ? 1 : 0,
      checkpointTimestamp || 0,
      checkpointCovered ? 1 : 0,
      uploadDedupKey
    ].join('|'),
    deviceMac,
    deviceMacNorm,
    payloadCount: allPayloads.length,
    matchingPayloadCount: matchedPayloads.length,
    skippedDeviceMismatchCount,
    totalRecordCount: allRecords.length,
    recordCount: records.length,
    builtSubmitCount: builtSubmitRecords.length,
    submitCount: submitRecords.length,
    alreadyUploadedCount: uploadedRecordFilter.alreadyUploadedRecords.length,
    uploadedRecordKeyCount: uploadedRecordFilter.uploadedRecordKeyCount,
    completed,
    uploadSinceTimestamp,
    uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
    checkpointTimestamp,
    checkpointText: formatUnixTimestampForLog(checkpointTimestamp),
    checkpointCovered,
    uploadDedupKey,
    source: uploadBatch.source,
    rawFrameCount: uploadBatch.rawFrames.length,
    rawRange,
    builtSubmitRange,
    submitRange
  };
};
const pruneClosedLegacyLocalDataUploadSessions = () => {
  const now = Date.now();
  closedLegacyLocalDataUploadSessions.forEach((value, key) => {
    if (!value?.completedAt || now - value.completedAt > LEGACY_LOCAL_DATA_CLOSED_SESSION_TTL_MS) {
      closedLegacyLocalDataUploadSessions.delete(key);
    }
  });
};
const getLegacyLocalDataUploadSignatureKey = (snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>) => {
  if (!snapshot.deviceMacNorm || !snapshot.signature) return '';
  return `${snapshot.deviceMacNorm}|${snapshot.signature}`;
};
const pruneLegacyLocalDataUploadSignatures = () => {
  const now = Date.now();
  runningLegacyLocalDataUploadSignatures.forEach((value, key) => {
    if (!value?.startedAt || now - value.startedAt > LEGACY_LOCAL_DATA_UPLOAD_SIGNATURE_TTL_MS) {
      runningLegacyLocalDataUploadSignatures.delete(key);
    }
  });
  completedLegacyLocalDataUploadSignatures.forEach((value, key) => {
    if (!value?.completedAt || now - value.completedAt > LEGACY_LOCAL_DATA_UPLOAD_SIGNATURE_TTL_MS) {
      completedLegacyLocalDataUploadSignatures.delete(key);
    }
  });
};
const claimLegacyLocalDataUploadSignature = (snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>) => {
  pruneLegacyLocalDataUploadSignatures();
  const key = getLegacyLocalDataUploadSignatureKey(snapshot);
  if (!key || !snapshot.uploadDedupKey) return '';
  if (runningLegacyLocalDataUploadSignatures.has(key) || completedLegacyLocalDataUploadSignatures.has(key)) return '';
  runningLegacyLocalDataUploadSignatures.set(key, {
    uploadDedupKey: snapshot.uploadDedupKey,
    deviceMacNorm: snapshot.deviceMacNorm,
    signature: snapshot.signature,
    startedAt: Date.now()
  });
  return key;
};
const releaseLegacyLocalDataUploadSignature = (snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>) => {
  const key = getLegacyLocalDataUploadSignatureKey(snapshot);
  if (key) runningLegacyLocalDataUploadSignatures.delete(key);
};
const completeLegacyLocalDataUploadSignature = (snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>, uploadedUntil = 0) => {
  const key = getLegacyLocalDataUploadSignatureKey(snapshot);
  if (!key || !snapshot.uploadDedupKey) return;
  runningLegacyLocalDataUploadSignatures.delete(key);
  completedLegacyLocalDataUploadSignatures.set(key, {
    uploadDedupKey: snapshot.uploadDedupKey,
    deviceMacNorm: snapshot.deviceMacNorm,
    signature: snapshot.signature,
    uploadedUntil,
    completedAt: Date.now()
  });
};
const getLegacyLocalDataStableSkipReason = (snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>) => {
  pruneClosedLegacyLocalDataUploadSessions();
  pruneLegacyLocalDataUploadSignatures();
  if (!snapshot.deviceMacNorm) return 'missing-device-mac';
  if (snapshot.payloadCount > 0 && snapshot.matchingPayloadCount === 0 && snapshot.skippedDeviceMismatchCount > 0) {
    return 'all-payloads-device-mismatch';
  }
  if (snapshot.recordCount > 0 && snapshot.checkpointCovered) return 'checkpoint-covered';
  if (snapshot.builtSubmitCount > 0 && snapshot.submitCount === 0) {
    return snapshot.alreadyUploadedCount >= snapshot.builtSubmitCount ? 'all-submit-records-already-uploaded' : 'no-submit-candidate';
  }
  const signatureKey = getLegacyLocalDataUploadSignatureKey(snapshot);
  if (signatureKey && completedLegacyLocalDataUploadSignatures.has(signatureKey)) return 'same-signature-uploaded';
  if (signatureKey && runningLegacyLocalDataUploadSignatures.has(signatureKey)) return 'same-signature-upload-running';
  const closed = closedLegacyLocalDataUploadSessions.get(snapshot.deviceMacNorm);
  if (
    closed &&
    closed.uploadDedupKey &&
    snapshot.uploadDedupKey &&
    closed.uploadDedupKey === snapshot.uploadDedupKey &&
    Date.now() - closed.completedAt <= LEGACY_LOCAL_DATA_CLOSED_SESSION_TTL_MS
  ) {
    return 'upload-session-closed';
  }
  return '';
};
const isLegacyLocalDataTerminalSkipReason = (reason = '') => LEGACY_LOCAL_DATA_TERMINAL_SKIP_REASONS.has(reason);
const isLegacyLocalDataSilentTerminalSkipReason = (reason = '') => LEGACY_LOCAL_DATA_SILENT_TERMINAL_SKIP_REASONS.has(reason);
const closeLegacyLocalDataUploadSession = (deviceMac: string, uploadDedupKey: string, uploadedUntil = 0) => {
  const deviceMacNorm = normalizeHistoryCheckpointDeviceMac(deviceMac);
  if (!deviceMacNorm || !uploadDedupKey) return;
  closedLegacyLocalDataUploadSessions.set(deviceMacNorm, {
    uploadDedupKey,
    uploadedUntil,
    completedAt: Date.now(),
    uploadSessionKey: getAwarenessHomeUploadSessionKey()
  });
};
const closeLegacyLocalDataTerminalSkip = (snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>) => {
  closeLegacyLocalDataUploadSession(
    snapshot.deviceMac,
    snapshot.uploadDedupKey,
    snapshot.checkpointTimestamp || snapshot.rawRange?.maxTimestamp || snapshot.builtSubmitRange?.maxTimestamp || 0
  );
  if (snapshot.deviceMac) {
    markLegacyHomeHistoryReadCompletedForDevice(snapshot.deviceMac);
  }
  legacyLocalDataStableReadyAt = 0;
  legacyLocalDataStableUploadScheduled = false;
  legacyLocalDataUploadWatcherActive = false;
  legacyLocalDataUploadWatcherActiveAt = 0;
  legacyLocalDataUploadWatcherPending = false;
  userStore.updateUploadingStatus('2');
  userStore.updateIsSending(false);
  markAwarenessHomeSyncCompleted('legacy-local-data-terminal-skip');
};
const shouldSkipLegacyLocalDataStableWait = (trigger: string, protocol: string) => {
  const stableSnapshot = getLegacyLocalDataStableSnapshot();
  const reason = getLegacyLocalDataStableSkipReason(stableSnapshot);
  if (!reason) return false;
  if (isLegacyLocalDataTerminalSkipReason(reason)) {
    closeLegacyLocalDataTerminalSkip(stableSnapshot);
    if (isLegacyLocalDataSilentTerminalSkipReason(reason)) {
      return true;
    }
  }
  legacyLocalDataStableReadyAt = 0;
  appendAwarenessDiagnosticLog('legacy-local-data-stable-wait-skip', {
    protocol,
    trigger,
    reason,
    stableSnapshot,
    snapshot: getAwarenessConnectionSnapshot()
  });
  return true;
};
const waitForLegacyLocalDataStableBeforeUpload = async (trigger: string, protocol: string) => {
  if (legacyLocalDataStablePromise) return legacyLocalDataStablePromise;

  legacyLocalDataStablePromise = (async () => {
    const startedAt = Date.now();
    let stableStartedAt = startedAt;
    let previous = getLegacyLocalDataStableSnapshot();
    appendAwarenessDiagnosticLog('legacy-local-data-stable-wait-start', {
      protocol,
      trigger,
      timeoutMs: LEGACY_LOCAL_DATA_STABLE_TIMEOUT_MS,
      stableWaitMs: LEGACY_LOCAL_DATA_STABLE_WAIT_MS,
      pollMs: LEGACY_LOCAL_DATA_STABLE_POLL_MS,
      ...previous,
      snapshot: getAwarenessConnectionSnapshot()
    });

    while (Date.now() - startedAt < LEGACY_LOCAL_DATA_STABLE_TIMEOUT_MS) {
      await waitForAwarenessMs(LEGACY_LOCAL_DATA_STABLE_POLL_MS);
      const current = getLegacyLocalDataStableSnapshot();

      if (current.signature !== previous.signature) {
        appendAwarenessDiagnosticLog('legacy-local-data-stable-wait-progress', {
          protocol,
          trigger,
          elapsedMs: Date.now() - startedAt,
          previousSignature: previous.signature,
          currentSignature: current.signature,
          ...current,
          snapshot: getAwarenessConnectionSnapshot()
        });
        previous = current;
        stableStartedAt = Date.now();
        continue;
      }

      if (Date.now() - stableStartedAt >= LEGACY_LOCAL_DATA_STABLE_WAIT_MS) {
        appendAwarenessDiagnosticLog('legacy-local-data-stable-wait-result', {
          protocol,
          trigger,
          elapsedMs: Date.now() - startedAt,
          stableMs: Date.now() - stableStartedAt,
          ...current,
          snapshot: getAwarenessConnectionSnapshot()
        });
        return;
      }
    }

    const timedOutSnapshot = getLegacyLocalDataStableSnapshot();
    appendAwarenessDiagnosticLog('legacy-local-data-stable-wait-timeout', {
      protocol,
      trigger,
      elapsedMs: Date.now() - startedAt,
      ...timedOutSnapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
  })().finally(() => {
    legacyLocalDataStablePromise = null;
  });

  return legacyLocalDataStablePromise;
};
const isLegacyLocalDataStableReadyForUpload = () =>
  Boolean(legacyLocalDataStableReadyAt && Date.now() - legacyLocalDataStableReadyAt <= LEGACY_LOCAL_DATA_STABLE_READY_TTL_MS);
const scheduleLegacyLocalDataUploadAfterStableWait = (trigger: string, protocol: string) => {
  if (shouldSkipLegacyLocalDataStableWait(trigger, protocol)) {
    userStore.updateUploadingStatus('2');
    userStore.updateIsSending(false);
    return;
  }
  if (legacyLocalDataStableUploadScheduled || legacyLocalDataStablePromise) {
    appendAwarenessDiagnosticLog('legacy-local-data-stable-wait-skip', {
      protocol,
      trigger,
      reason: 'dedup-running',
      stableSnapshot: getLegacyLocalDataStableSnapshot(),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  legacyLocalDataStableUploadScheduled = true;
  void waitForLegacyLocalDataStableBeforeUpload(trigger, protocol)
    .then(() => {
      legacyLocalDataStableReadyAt = Date.now();
      legacyHomeHistoryReadCompletedTick.value = Date.now();
    })
    .catch((error) => {
      appendAwarenessDiagnosticLog('legacy-local-data-stable-wait-failed', {
        protocol,
        trigger,
        error: formatBleErrorMessage(error, 'legacy local data stable wait failed'),
        rawError: getAwarenessRawError(error),
        snapshot: getAwarenessConnectionSnapshot()
      });
    })
    .finally(() => {
      legacyLocalDataStableUploadScheduled = false;
    });
};
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

const summarizeBackendUploadBindingForLog = (binding: Awaited<ReturnType<typeof assertBackendUploadBinding>>) => ({
  ok: binding.ok,
  reasonCode: binding.reasonCode,
  reason: binding.reason,
  deviceMac: binding.deviceMac,
  bindingId: binding.bindingId,
  bindingVersion: binding.bindingVersion,
  dataUserId: binding.dataUserId,
  protocol: binding.protocol,
  backendDevice: summarizeAwarenessDevice(binding.device as Record<string, any> | null | undefined)
});

const assertAwarenessBackendUploadBindingWithLog = async (
  deviceMac: string,
  details: Record<string, any>
) => {
  const startedAt = Date.now();
  appendAwarenessDiagnosticLog('binding-check-start', {
    ...details,
    deviceMac,
    snapshot: getAwarenessConnectionSnapshot()
  });
  try {
    const binding = await assertBackendUploadBinding(deviceMac);
    appendAwarenessDiagnosticLog('binding-check-result', {
      ...details,
      deviceMac,
      elapsedMs: Date.now() - startedAt,
      binding: summarizeBackendUploadBindingForLog(binding),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return binding;
  } catch (error) {
    appendAwarenessDiagnosticLog('binding-check-failed', {
      ...details,
      deviceMac,
      elapsedMs: Date.now() - startedAt,
      error: formatBleErrorMessage(error, 'backend binding check failed'),
      rawError: getAwarenessRawError(error),
      snapshot: getAwarenessConnectionSnapshot()
    });
    throw error;
  }
};
const assertAwarenessBackendUploadBindingCached = async (deviceMac: string, details: Record<string, any>) => {
  const deviceMacNorm = normalizeHistoryCheckpointDeviceMac(deviceMac);
  const now = Date.now();
  if (
    deviceMacNorm &&
    cachedBackendUploadBinding &&
    cachedBackendUploadBinding.deviceMacNorm === deviceMacNorm &&
    now - cachedBackendUploadBinding.checkedAt <= AWARENESS_BACKEND_BINDING_CACHE_MS
  ) {
    appendAwarenessDiagnosticLog('binding-check-cache-result', {
      ...details,
      deviceMac,
      elapsedMs: 0,
      binding: summarizeBackendUploadBindingForLog(cachedBackendUploadBinding.binding),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return cachedBackendUploadBinding.binding;
  }

  const binding = await assertAwarenessBackendUploadBindingWithLog(deviceMac, details);
  if (deviceMacNorm && binding.ok) {
    cachedBackendUploadBinding = {
      deviceMacNorm,
      checkedAt: Date.now(),
      binding
    };
  } else if (cachedBackendUploadBinding?.deviceMacNorm === deviceMacNorm) {
    cachedBackendUploadBinding = null;
  }
  return binding;
};

const summarizeSubmitDataResponse = (response: unknown) => {
  if (response == null || typeof response !== 'object') {
    return {
      hasResponse: response !== null && response !== undefined,
      value: response
    };
  }

  const source = response as Record<string, any>;
  const payload = source.data && typeof source.data === 'object' ? (source.data as Record<string, any>) : source;
  const fieldNames = [
    'success',
    'count',
    'healthCount',
    'sleepCount',
    'sleepInputCount',
    'sleepDuplicateInputCount',
    'sleepOverlapDeletedCount',
    'sleepInsertedCount',
    'sleepUpdatedCount',
    'failCount',
    'touchedDates',
    'syncElapsedMs',
    'healthWriteMs',
    'sleepWriteMs',
    'deviceUpdateMs',
    'summaryMs',
    'summaryDates'
  ];
  const result: Record<string, unknown> = {
    hasResponse: true,
    responseKeys: Object.keys(source).slice(0, 12)
  };

  if (payload !== source) {
    result.payloadKeys = Object.keys(payload).slice(0, 12);
  }

  fieldNames.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      result[field] = payload[field];
    } else if (Object.prototype.hasOwnProperty.call(source, field)) {
      result[field] = source[field];
    }
  });

  return result;
};
const getSubmitDataResponsePayload = (response: unknown) => {
  if (response == null || typeof response !== 'object') return null;
  const source = response as Record<string, any>;
  return source.data && typeof source.data === 'object' ? (source.data as Record<string, any>) : source;
};
const getSubmitDataResponseNumber = (response: unknown, field: string) => {
  const payload = getSubmitDataResponsePayload(response);
  const value = payload?.[field] ?? (response && typeof response === 'object' ? (response as Record<string, any>)[field] : undefined);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};
const isSubmitDataResponseSuccessful = (response: unknown) => {
  const payload = getSubmitDataResponsePayload(response);
  if (!payload) return true;
  if (payload.success === false) return false;
  const code = Number(payload.code);
  return !Number.isFinite(code) || code === 0 || code === 200;
};
const shouldKeepLegacyLocalHistoryCacheAfterUpload = (submitMetricCounts: Record<string, number>, response: unknown) => {
  const submittedSleepCount = Number(submitMetricCounts.sleep || 0);
  if (submittedSleepCount <= 0) return false;
  const responseSleepCount = getSubmitDataResponseNumber(response, 'sleepCount');
  return responseSleepCount === 0;
};
const clearLegacyLocalHistoryCacheAfterUpload = (context: Record<string, unknown>) => {
  const receivedBefore = Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0;
  const localBefore = Array.isArray(userStore.localData) ? userStore.localData.length : 0;
  const historyBefore = Array.isArray(ringStore.historyRecords) ? ringStore.historyRecords.length : 0;
  ringStore.clearHistoryRuntimeData();
  lastLocalDataLength = 0;
  appendAwarenessDiagnosticLog('legacy-local-data-cache-cleared', {
    ...context,
    receivedBefore,
    localBefore,
    historyBefore,
    receivedAfter: Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0,
    localAfter: Array.isArray(userStore.localData) ? userStore.localData.length : 0,
    historyAfter: Array.isArray(ringStore.historyRecords) ? ringStore.historyRecords.length : 0,
    snapshot: getAwarenessConnectionSnapshot()
  });
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
  if (homeDetailNavigating.value) {
    appendAwarenessDiagnosticLog('home-detail-navigate-skip', {
      key,
      reason: 'navigation-lock'
    });
    return;
  }
  const route = homeDetailRoutes[key];
  const query = `selectedDayIndex=${selectedDayIndex.value}&selectedDate=${encodeURIComponent(getSelectedDetailDate())}`;
  const url = `${route}?${query}`;
  const startedAt = Date.now();
  homeDetailNavigating.value = true;
  appendAwarenessDiagnosticLog('home-detail-navigate-start', { key, url });
  setTimeout(() => {
    uni.navigateTo({
      url,
      success: () => {
        appendAwarenessDiagnosticLog('home-detail-navigate-success', {
          key,
          elapsedMs: Date.now() - startedAt
        });
      },
      fail: (error) => {
        appendAwarenessDiagnosticLog('home-detail-navigate-fail', {
          key,
          elapsedMs: Date.now() - startedAt,
          error: String((error as any)?.errMsg || error || '')
        });
        uni.showToast({ title: '页面加载失败，请稍后重试', icon: 'none' });
      },
      complete: () => {
        setTimeout(() => {
          homeDetailNavigating.value = false;
        }, HOME_DETAIL_NAVIGATION_LOCK_MS);
      }
    });
  }, 0);
};
const openPeriodPage = (url: string) => {
  const targetUrl = String(url || '').trim();
  if (!targetUrl) return;
  if (homeDetailNavigating.value) {
    appendAwarenessDiagnosticLog('period-navigate-skip', {
      url: targetUrl,
      reason: 'navigation-lock'
    });
    return;
  }
  const startedAt = Date.now();
  homeDetailNavigating.value = true;
  appendAwarenessDiagnosticLog('period-navigate-start', { url: targetUrl });
  setTimeout(() => {
    uni.navigateTo({
      url: targetUrl,
      success: () => {
        appendAwarenessDiagnosticLog('period-navigate-success', {
          url: targetUrl,
          elapsedMs: Date.now() - startedAt
        });
      },
      fail: (error) => {
        appendAwarenessDiagnosticLog('period-navigate-fail', {
          url: targetUrl,
          elapsedMs: Date.now() - startedAt,
          error: String((error as any)?.errMsg || error || '')
        });
        uni.showToast({ title: '页面加载失败，请稍后重试', icon: 'none' });
      },
      complete: () => {
        setTimeout(() => {
          homeDetailNavigating.value = false;
        }, HOME_DETAIL_NAVIGATION_LOCK_MS);
      }
    });
  }, 0);
};
const getPositiveMetricNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (value == null || value === '') continue;
    const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
};
const HOME_MAIN_SLEEP_MAX_MINUTES = 16 * 60;
const HOME_VITAL_CHART_Y_AXIS_MAX = 260;
const HOME_RELAX_CHART_Y_AXIS_MAX = 300;
const getPlausibleHomeSleepDurationNumber = (...values: unknown[]) => {
  for (const value of values) {
    const numeric = getPositiveMetricNumber(value);
    if (numeric > 0 && numeric <= HOME_MAIN_SLEEP_MAX_MINUTES) return numeric;
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
const GIRL_HEALTH_ADVICE_KEYS = [
  'periodTips',
  'periodTip',
  'healthTips',
  'healthTip',
  'healthAdvice',
  'advice',
  'advise',
  'suggestion',
  'suggestions',
  'recommend',
  'recommendation',
  'recommendations',
  'message',
  'content'
];
const GIRL_HEALTH_PHASE_ADVICE_KEYS: Record<number, string[]> = {
  0: ['menstrual', 'menstruation', 'period'],
  1: ['ovulation'],
  2: ['fertile', 'fertility'],
  3: ['safe', 'luteal']
};
const GIRL_HEALTH_PHASE_FALLBACK_TIPS: Record<number, string> = {
  0: '\u7ecf\u671f\u6ce8\u610f\u4fdd\u6696\uff0c\u907f\u514d\u751f\u51b7\u523a\u6fc0\uff0c\u4fdd\u8bc1\u5145\u8db3\u4f11\u606f\u3002',
  1: '\u6392\u5375\u671f\u6ce8\u610f\u8eab\u4f53\u53d8\u5316\uff0c\u4fdd\u6301\u89c4\u5f8b\u4f5c\u606f\u548c\u9002\u91cf\u8fd0\u52a8\u3002',
  2: '\u6613\u5b55\u671f\u8bf7\u7ed3\u5408\u4e2a\u4eba\u8ba1\u5212\uff0c\u505a\u597d\u5907\u5b55\u6216\u907f\u5b55\u5b89\u6392\u3002',
  3: '\u5efa\u8bae\u4fdd\u6301\u89c4\u5f8b\u4f5c\u606f\uff0c\u6301\u7eed\u8bb0\u5f55\u5468\u671f\u53d8\u5316\u3002'
};
const consumeGirlHealthProfileUpdatedFlag = () => {
  try {
    const updatedAt = uni.getStorageSync(GIRL_HEALTH_PROFILE_UPDATED_STORAGE_KEY);
    if (!updatedAt) return false;
    uni.removeStorageSync(GIRL_HEALTH_PROFILE_UPDATED_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
};
const getGirlHealthProfileExistsStorageKey = (userId?: unknown) =>
  `${GIRL_HEALTH_PROFILE_EXISTS_STORAGE_KEY_PREFIX}:${String(userId || 'anonymous')}`;
const getGirlHealthProfileStorageKey = (userId?: unknown) =>
  `${GIRL_HEALTH_PROFILE_STORAGE_KEY_PREFIX}:${String(userId || 'anonymous')}`;
const getGirlHealthUserId = (userInfo?: Record<string, any> | null) =>
  userInfo?.id ||
  userInfo?.userId ||
  userInfo?.user_id ||
  userInfo?.uid ||
  userStore.userInfo?.id ||
  userStore.userInfo?.userId ||
  (userStore.userInfo as any)?.user_id ||
  (userStore.userInfo as any)?.uid;
const hasLocalGirlHealthProfileFlag = (userInfo?: Record<string, any> | null) => {
  try {
    const userId = getGirlHealthUserId(userInfo);
    return Boolean(userId && uni.getStorageSync(getGirlHealthProfileExistsStorageKey(userId)));
  } catch {
    return false;
  }
};
const readLocalGirlHealthProfile = (userInfo?: Record<string, any> | null): Record<string, any> | null => {
  try {
    const userId = getGirlHealthUserId(userInfo);
    if (!userId) return null;
    const cached = uni.getStorageSync(getGirlHealthProfileStorageKey(userId));
    if (!cached) return null;
    const profile = typeof cached === 'string' ? JSON.parse(cached) : cached;
    return profile && typeof profile === 'object' ? (profile as Record<string, any>) : null;
  } catch {
    return null;
  }
};
const normalizeGirlHealthPayload = (source: any): Record<string, any> | null => {
  if (!source || source === '') return null;
  if (Array.isArray(source)) {
    return source.length > 0 ? { list: source } : null;
  }
  if (typeof source !== 'object') return { value: source };
  const wrapped = source.data ?? source.result;
  if (wrapped && wrapped !== source) {
    return normalizeGirlHealthPayload(wrapped);
  }
  return source as Record<string, any>;
};
const getGirlHealthPayloadCandidates = (source: any, depth = 0): Array<Record<string, any>> => {
  if (!source || source === '' || depth > 4) return [];
  if (Array.isArray(source)) {
    return source.flatMap((item) => getGirlHealthPayloadCandidates(item, depth + 1));
  }
  if (typeof source !== 'object') return [];
  const payload = source as Record<string, any>;
  const candidates: Array<Record<string, any>> = [payload];
  for (const key of [
    'data',
    'payload',
    'body',
    'result',
    'profile',
    'info',
    'detail',
    'girlHealth',
    'girlHealthInfo',
    'girlHealthData',
    'femaleHealth',
    'periodInfo',
    'userGirlHealth',
    'health',
    'prediction',
    'analysis'
  ]) {
    const value = payload[key];
    if (value && value !== source) candidates.push(...getGirlHealthPayloadCandidates(value, depth + 1));
  }
  for (const key of ['list', 'rows', 'records', 'items']) {
    const value = payload[key];
    if (Array.isArray(value)) candidates.push(...getGirlHealthPayloadCandidates(value, depth + 1));
  }
  return candidates;
};
const hasGirlHealthProfilePayload = (source: any): boolean => {
  const normalizedPayload = normalizeGirlHealthPayload(source);
  const candidates = getGirlHealthPayloadCandidates(normalizedPayload || source);
  const profileValueKeys = [
    'predictedCycle',
    'cycle',
    'cycleInfo',
    'cycleDay',
    'periodCycle',
    'cycleLength',
    'averageCycle',
    'avgCycle',
    'cycleDays',
    'menstrualCycle',
    'menstruationDay',
    'periodRuntime',
    'menstrualDays',
    'periodDays',
    'menstrualLength',
    'menstruationLength',
    'periodLength',
    'lastMenstruationDate',
    'lastMenstruationStartDate',
    'lastMenstrualStartDate',
    'lastMenstrualDate',
    'lastMenstrualTime',
    'lastMenstruationTime',
    'lastMenstruationStartTime',
    'lastMenstrualDateTime',
    'lastPeriodTime',
    'lastPeriodTimePoint',
    'lastPeriodDate',
    'lastPeriodStartDate',
    'lastPeriodStartTime',
    'recentMenstruationDate',
    'menstruationStartDate',
    'menstruationStartTime',
    'periodStartDate',
    'periodStartTime',
    'periodDates',
    'menstrualDates',
    'menstruationDates',
    'records',
    'startDate',
    'birthday',
    'birthDay',
    'cycleRegularity',
    'isRuleType',
    'healthConditions',
    'otherUnhealth',
    'periodTips',
    'periodTip'
  ];
  const profileFlagKeys = ['hasProfile', 'profileExists', 'configured', 'isConfigured', 'opened', 'isOpen'];
  const profileIdentityKeys = ['id', 'girlHealthId', 'profileId'];
  return candidates.some((payload) => {
    for (const key of profileFlagKeys) {
      const value = payload[key];
      if (value === true || value === 1 || value === '1' || value === 'true') return true;
    }
    const hasValue = profileValueKeys.some((key) => {
      const value = payload[key];
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    });
    if (hasValue) return true;
    const hasIdentity = profileIdentityKeys.some((key) => {
      const value = payload[key];
      return value !== undefined && value !== null && value !== '' && value !== 0;
    });
    return hasIdentity && Boolean(payload.userId || payload.user_id || payload.createTime || payload.updateTime);
  });
};
const writeLocalGirlHealthProfile = (userInfo: Record<string, any> | null | undefined, source: any) => {
  try {
    if (!hasGirlHealthProfilePayload(source)) return;
    const userId = getGirlHealthUserId(userInfo);
    if (!userId) return;
    const candidates = getGirlHealthPayloadCandidates(source);
    const profile =
      candidates.find((payload) => Boolean(resolvePeriodProfileState(new Date(), payload))) ||
      candidates.find((payload) =>
        [
          'lastMenstruationDate',
          'lastMenstruationStartDate',
          'lastMenstrualStartDate',
          'lastMenstrualDate',
          'lastMenstrualTime',
          'lastMenstruationTime',
          'lastMenstruationStartTime',
          'lastMenstrualDateTime',
          'lastPeriodTime',
          'lastPeriodTimePoint',
          'lastPeriodStartTime',
          'periodDates',
          'menstrualDates',
          'menstruationDates',
          'records',
          'startDate'
        ].some((key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== '')
      );
    if (!profile || typeof profile !== 'object') return;
    uni.setStorageSync(getGirlHealthProfileExistsStorageKey(userId), true);
    uni.setStorageSync(getGirlHealthProfileStorageKey(userId), { ...profile, userId, user_id: userId });
  } catch {
    // 首页缓存失败不阻塞女性模块展示。
  }
};
const getGirlHealthPredictedCycle = (source: any): Record<string, any> | null => {
  const candidates = getGirlHealthPayloadCandidates(source);
  for (const payload of candidates) {
    const cycle = payload.predictedCycle || payload.cycle || payload.cycleInfo;
    if (cycle && typeof cycle === 'object') return cycle as Record<string, any>;
    const menstrual = payload.menstrual || payload.menstruation || payload.period;
    const ovulation = payload.ovulation;
    const fertility = payload.fertility || payload.fertile || payload.follicular;
    const safe = payload.safe || payload.luteal;
    if (
      [menstrual, ovulation, fertility, safe].some((segment) => segment && typeof segment === 'object')
    ) {
      return { menstrual, ovulation, fertility, safe };
    }
  }
  return null;
};
const syncHomePeriodCycle = (source: any, date: string) => {
  const candidates = getGirlHealthPayloadCandidates(source);
  for (const payload of candidates) {
    const profileState = resolvePeriodProfileState(date, payload);
    if (profileState) {
      currentPhaseIndex.value = PERIOD_PHASE_INDEX[profileState.phaseKey];
      return true;
    }
  }

  const cycle = getGirlHealthPredictedCycle(source);
  if (cycle) {
    uni.setStorageSync('menstrual', cycle.menstrual || cycle.menstruation || cycle.period || null);
    uni.setStorageSync('ovulation', cycle.ovulation || null);
    uni.setStorageSync('fertility', cycle.fertility || cycle.fertile || cycle.follicular || null);
    uni.setStorageSync('safe', cycle.safe || cycle.luteal || null);
    currentPhaseIndex.value = resolvePeriodPhaseIndex(date, cycle, 'safe');
    return true;
  }
  return false;
};
const normalizeGirlHealthAdviceText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map((item) => normalizeGirlHealthAdviceText(item)).filter(Boolean).join('\uff1b');
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  if (typeof value === 'object') {
    const source = value as Record<string, any>;
    for (const key of ['text', 'content', 'desc', 'description', 'message', 'title', 'value']) {
      const text = normalizeGirlHealthAdviceText(source[key]);
      if (text) return text;
    }
  }
  return '';
};
const getGirlHealthAdviceFromPayload = (source: Record<string, any> | null | undefined): string => {
  if (!source || typeof source !== 'object') return '';
  for (const key of GIRL_HEALTH_ADVICE_KEYS) {
    const value = source[key];
    const directText = normalizeGirlHealthAdviceText(value);
    if (directText) return directText;

    if (value && typeof value === 'object') {
      const phaseKeys = GIRL_HEALTH_PHASE_ADVICE_KEYS[currentPhaseIndex.value] || [];
      for (const phaseKey of phaseKeys) {
        const phaseText = normalizeGirlHealthAdviceText((value as Record<string, any>)[phaseKey]);
        if (phaseText) return phaseText;
      }
    }
  }
  return '';
};
const extractGirlHealthAdvice = (source: any): string => {
  const candidates = [
    source,
    source?.data,
    source?.result,
    source?.data?.data,
    source?.data?.result,
    source?.result?.data,
    source?.result?.result,
    source?.girlHealth,
    source?.health,
    source?.prediction,
    source?.analysis,
    source?.report
  ];

  for (const candidate of candidates) {
    const text = getGirlHealthAdviceFromPayload(candidate);
    if (text) return text;
  }
  return '';
};
const getGirlHealthPhaseFallbackTip = () =>
  GIRL_HEALTH_PHASE_FALLBACK_TIPS[currentPhaseIndex.value] || GIRL_HEALTH_PHASE_FALLBACK_TIPS[3];
const isPendingMetricStatus = (value: unknown) => /[\u91c7\u96c6\u4e2d\u6d4b\u91cf\u8bfb\u53d6\u8bf7\u6c42\u7b49\u5f85]/.test(String(value ?? ''));
const getRelaxStatusByScore = (score: number) => {
  if (score >= 80) return '\u5e73\u7a33\u72b6\u6001';
  if (score >= 60) return '\u7565\u6709\u538b\u529b';
  if (score > 0) return '\u538b\u529b\u504f\u9ad8';
  return '';
};
const sleepDurationMinutes = computed(() => {
  const overview = sleepOverviewObj.value as Record<string, any> | null | undefined;
  const healthData = userStore.healthData as Record<string, any> | null | undefined;
  const latestMetrics = userStore.latestMetrics as Record<string, any> | null | undefined;
  return getPlausibleHomeSleepDurationNumber(
    overview?.sleepDuration,
    overview?.sleepMinutes,
    overview?.sleepTotalMinutes,
    overview?.totalSleepMinutes,
    overview?.totalMinutes,
    overview?.asleepMinutes,
    overview?.duration,
    overview?.sleep_time,
    healthData?.sleepTotalMinutes,
    healthData?.sleep_total_minutes,
    healthData?.sleepDuration,
    healthData?.sleep_minutes,
    healthData?.sleep,
    latestMetrics?.sleepTotalMinutes,
    latestMetrics?.sleepDuration,
    latestMetrics?.sleepMinutes
  );
});
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
const activityStepNumber = computed(() =>
  getPositiveMetricNumber(motionOverviewObj.value?.step)
);
const activityCalorieRawNumber = computed(() =>
  getPositiveMetricNumber(motionOverviewObj.value?.calorie)
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
  getPositiveMetricNumber(motionOverviewObj.value?.motionTime)
);
const activityStepValue = computed(() => (activityStepNumber.value > 0 ? `${activityStepNumber.value}` : '00'));
const activityCalorieValue = computed(() => (activityCalorieNumber.value > 0 ? String(Math.round(activityCalorieNumber.value)) : '00'));
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
    if (Number.isFinite(numeric) && numeric > 0) return `${Math.round(numeric)}`;
    const text = String(value).trim();
    if (text && text !== '--' && text !== '-' && text !== '00') return text;
  }
  return '00';
};
const getAwarenessChartNumber = (value: unknown) => {
  if (value == null || value === '') return null;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};
const buildStableAwarenessChartData = (
  chartData: Point[] | undefined,
  fallbackValue: number,
  fallbackLabel = '\u5f53\u524d'
) => {
  const source = Array.isArray(chartData) ? chartData : [];
  const fallbackNumber = getAwarenessChartNumber(fallbackValue);
  if (!source.length) {
    return fallbackNumber != null
      ? { xData: [fallbackLabel], seriesData: [Math.round(fallbackNumber)] }
      : { xData: [], seriesData: [] as number[] };
  }

  const xData = source.map((item: Point) => item.time?.toString() || '00:00');
  const rawValues = source.map((item: Point) => getAwarenessChartNumber(item.value));
  const validValues = rawValues.filter((item): item is number => item != null);
  const average =
    fallbackNumber ??
    (validValues.length
      ? validValues.reduce((total, item) => total + item, 0) / validValues.length
      : null);

  if (average == null) return { xData, seriesData: [] as number[] };

  const seriesData = rawValues.map((value, index) => {
    if (value != null) return Math.round(value);

    let prev: number | null = null;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (rawValues[i] != null) {
        prev = rawValues[i];
        break;
      }
    }

    let next: number | null = null;
    for (let i = index + 1; i < rawValues.length; i += 1) {
      if (rawValues[i] != null) {
        next = rawValues[i];
        break;
      }
    }

    if (prev != null && next != null) return Math.round((prev + next) / 2);
    if (prev != null) return Math.round(prev);
    if (next != null) return Math.round(next);
    return Math.round(average);
  });

  return { xData, seriesData };
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
  const isVisibleUploadSyncing =
    userStore.uploadingStatus === 'uploading' ||
    ringStore.uploadingStatus === 'uploading';
  const isBackgroundSyncing =
    isConnected &&
    !isVisibleUploadSyncing &&
    Boolean(
      homeDataSyncing.value ||
        legacyHomeHistoryReadInFlight.value ||
        legacyHomeHistoryReadPromise ||
        legacyLocalDataStablePromise ||
        legacyLocalDataStableUploadScheduled ||
        legacyLocalDataUploadPromise ||
        homeDataRefreshingAfterSync.value
    );
  const isSyncing =
    isConnected &&
    (isVisibleUploadSyncing || isBackgroundSyncing);

  return {
    isDisconnected,
    isConnecting,
    isConnected,
    isSyncing,


    statusText: isConnecting ? '\u8fde\u63a5\u4e2d' : '',
    syncingText: isVisibleUploadSyncing ? '\u4e0a\u4f20\u4e2d' : isBackgroundSyncing ? '\u540c\u6b65\u4e2d' : '',
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
      if (
        validateAwarenessHomeSyncContext('restore-ready-precheck', {
          requireReady: true,
          allowMissingCurrent: false
        }) &&
        claimAwarenessHomeSyncSession('restore-ready')
      ) {
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
          if (
            validateAwarenessHomeSyncContext('reconnect-result-ready-precheck', {
              requireReady: true,
              allowMissingCurrent: false
            }) &&
            claimAwarenessHomeSyncSession('reconnect-result-ready')
          ) {
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
                if (
                  validateAwarenessHomeSyncContext('bluetooth-ready-already-connected-precheck', {
                    requireReady: true,
                    allowMissingCurrent: false
                  }) &&
                  claimAwarenessHomeSyncSession('bluetooth-ready-already-connected')
                ) {
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
  () => [userStore.localData, legacyHomeHistoryReadCompletedTick.value],
  async (newData) => {
    const protocol = userStore.deviceInfo?.protocol || ringStore.deviceInfo?.protocol || 'unknown';
    const isRwRing = isAwarenessRwRing();
    const activeUploadDeviceMac = getAwarenessActiveHomeSyncMac();
    const uploadDeviceMacAtStart = activeUploadDeviceMac || getAwarenessUploadDeviceMac();
    if (!isRwRing && activeUploadDeviceMac && !validateAwarenessHomeSyncContext('legacy-local-data-watch-precheck', {
      expectedMac: activeUploadDeviceMac,
      allowMissingCurrent: false
    })) {
      appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
        protocol,
        reason: 'active-sync-device-mismatch',
        activeMac: activeUploadDeviceMac,
        deviceMac: uploadDeviceMacAtStart,
        localDataLength: Array.isArray(local.value) ? local.value.length : 0,
        snapshot: getAwarenessConnectionSnapshot()
      });
      userStore.updateUploadingStatus('2');
      userStore.updateIsSending(false);
      legacyLocalDataUploadWatcherPending = false;
      return;
    }
    const payloadScopeAtStart = getAwarenessHistoryPayloadsForDevice(
      Array.isArray(userStore.receivedData) ? userStore.receivedData : [],
      uploadDeviceMacAtStart
    );
    let localData: any[] = payloadScopeAtStart.matchedPayloads;
    if (payloadScopeAtStart.skippedDeviceMismatchCount > 0) {
      appendAwarenessDiagnosticLog('legacy-local-data-payload-skip', {
        protocol,
        reason: 'device-mismatch',
        deviceMac: uploadDeviceMacAtStart,
        totalPayloadCount: payloadScopeAtStart.allPayloads.length,
        matchedPayloadCount: payloadScopeAtStart.matchedPayloads.length,
        skippedDeviceMismatchCount: payloadScopeAtStart.skippedDeviceMismatchCount,
        snapshot: getAwarenessConnectionSnapshot()
      });
    }
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

    if (!isRwRing) {
      const terminalSnapshot = getLegacyLocalDataStableSnapshot();
      const terminalSkipReason = getLegacyLocalDataStableSkipReason(terminalSnapshot);
      if (isLegacyLocalDataSilentTerminalSkipReason(terminalSkipReason)) {
        closeLegacyLocalDataTerminalSkip(terminalSnapshot);
        legacyLocalDataUploadWatcherPending = false;
        return;
      }
    }

    if (!isRwRing && isAwarenessHomeSyncInCooldown('legacy-local-data-watch')) {
      userStore.updateUploadingStatus('2');
      userStore.updateIsSending(false);
      legacyLocalDataUploadWatcherPending = false;
      return;
    }

    if (!isRwRing && legacyHomeHistoryReadInFlight.value) {
      const historyReadElapsedMs = legacyHomeHistoryReadStartedAt > 0 ? Date.now() - legacyHomeHistoryReadStartedAt : 0;
      appendAwarenessDiagnosticLog('legacy-local-data-upload-continue-during-history-read', {
        protocol,
        historyReadElapsedMs,
        softWaitMs: LEGACY_HOME_HISTORY_UPLOAD_SOFT_WAIT_MS,
        localDataCount: localData.length,
        localDataSummary: summarizeLegacyHistoryPayloadsForLog(localData as Array<Record<string, any>>),
        localDataLength: Array.isArray(local.value) ? local.value.length : 0,
        stableSnapshot: getLegacyLocalDataStableSnapshot(),
        snapshot: getAwarenessConnectionSnapshot()
      });
    }

    // if (userStore.localData.length > lastLocalDataLength) {
    //   uni.showLoading({

    //     mask: true
    //   });
    // }
    lastLocalDataLength = userStore.localData.length;

    if (!isRwRing && legacyLocalDataUploadWatcherActive) {
      const watcherActiveElapsedMs = legacyLocalDataUploadWatcherActiveAt > 0 ? Date.now() - legacyLocalDataUploadWatcherActiveAt : 0;
      const hasBlockingUploadTask = Boolean(
        legacyLocalDataUploadPromise ||
          legacyLocalDataStablePromise ||
          legacyLocalDataStableUploadScheduled
      );
      if (!hasBlockingUploadTask && watcherActiveElapsedMs >= LEGACY_LOCAL_DATA_UPLOAD_WATCHER_STALE_MS) {
        appendAwarenessDiagnosticLog('legacy-local-data-upload-active-stale-reset', {
          protocol,
          reason: 'watcher-active-without-blocking-task',
          watcherActiveElapsedMs,
          staleMs: LEGACY_LOCAL_DATA_UPLOAD_WATCHER_STALE_MS,
          localDataCount: localData.length,
          localDataLength: Array.isArray(local.value) ? local.value.length : 0,
          stableSnapshot: getLegacyLocalDataStableSnapshot(),
          snapshot: getAwarenessConnectionSnapshot()
        });
        legacyLocalDataUploadWatcherActive = false;
        legacyLocalDataUploadWatcherActiveAt = 0;
        legacyLocalDataUploadWatcherPending = false;
      } else {
        legacyLocalDataUploadWatcherPending = true;
        appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
          protocol,
          reason: 'watcher-dedup-running',
          watcherActiveElapsedMs,
          localDataCount: localData.length,
          localDataLength: Array.isArray(local.value) ? local.value.length : 0,
          hasLegacyLocalDataUploadPromise: Boolean(legacyLocalDataUploadPromise),
          hasLegacyLocalDataStablePromise: Boolean(legacyLocalDataStablePromise),
          stableWaitScheduled: legacyLocalDataStableUploadScheduled,
          hasLegacyHomeHistoryReadPromise: Boolean(legacyHomeHistoryReadPromise),
          legacyHomeHistoryReadInFlight: legacyHomeHistoryReadInFlight.value,
          snapshot: getAwarenessConnectionSnapshot()
        });
        return;
      }
    }
    if (!isRwRing) {
      legacyLocalDataUploadWatcherActive = true;
      legacyLocalDataUploadWatcherActiveAt = Date.now();
    }

    try {
      if (isRingHistoryReadComplete(localData)) {
        userStore.updateIsSending(false);
        // uni.hideLoading();

        if (!isRwRing) {
          const precheckDeviceMac = activeUploadDeviceMac || getAwarenessUploadDeviceMac();
          if (!precheckDeviceMac) {
            userStore.updateUploadingStatus('2');
            appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
              protocol,
              reason: 'missing-device-mac-before-stable-wait',
              localDataCount: localData.length,
              stableSnapshot: getLegacyLocalDataStableSnapshot(),
              snapshot: getAwarenessConnectionSnapshot()
            });
            return;
          }
          if (activeUploadDeviceMac && !validateAwarenessHomeSyncContext('legacy-local-data-before-stable-wait', {
            expectedMac: activeUploadDeviceMac,
            allowMissingCurrent: false
          })) {
            userStore.updateUploadingStatus('2');
            userStore.updateIsSending(false);
            appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
              protocol,
              reason: 'active-sync-device-mismatch-before-stable-wait',
              activeMac: activeUploadDeviceMac,
              deviceMac: precheckDeviceMac,
              localDataCount: localData.length,
              stableSnapshot: getLegacyLocalDataStableSnapshot(),
              snapshot: getAwarenessConnectionSnapshot()
            });
            return;
          }
          if (shouldSkipLegacyLocalDataStableWait('legacy-local-data-upload', protocol)) {
            userStore.updateUploadingStatus('2');
            userStore.updateIsSending(false);
            return;
          }
          if (!isLegacyLocalDataStableReadyForUpload()) {
            userStore.updateUploadingStatus('2');
            appendAwarenessDiagnosticLog('legacy-local-data-upload-pending', {
              protocol,
              reason: 'wait-stable-background',
              localDataCount: localData.length,
              localDataSummary: summarizeLegacyHistoryPayloadsForLog(localData as Array<Record<string, any>>),
              stableSnapshot: getLegacyLocalDataStableSnapshot(),
              snapshot: getAwarenessConnectionSnapshot()
            });
            scheduleLegacyLocalDataUploadAfterStableWait('legacy-local-data-upload', protocol);
            return;
          }
          legacyLocalDataStableReadyAt = 0;
          localData = getAwarenessHistoryPayloadsForDevice(
            Array.isArray(userStore.receivedData) ? userStore.receivedData : [],
            precheckDeviceMac
          ).matchedPayloads;
          if (!localData.length || !isRingHistoryReadComplete(localData)) {
            userStore.updateUploadingStatus('2');
            appendAwarenessDiagnosticLog('legacy-local-data-upload-pending', {
              protocol,
              reason: 'not-complete-after-stable-wait',
              localDataCount: localData.length,
              localDataSummary: summarizeLegacyHistoryPayloadsForLog(localData as Array<Record<string, any>>),
              stableSnapshot: getLegacyLocalDataStableSnapshot(),
              snapshot: getAwarenessConnectionSnapshot()
            });
            return;
          }
        }

        const allFilteredRecords = local.value || [];
        const deviceMac = activeUploadDeviceMac || getAwarenessUploadDeviceMac();
        if (!deviceMac) {
          userStore.updateUploadingStatus('2');
          appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
            protocol,
            isRwRing,
            reason: 'missing-device-mac',
            localDataCount: localData.length,
            rawRecordCount: allFilteredRecords.length,
            stableSnapshot: getLegacyLocalDataStableSnapshot(),
            snapshot: getAwarenessConnectionSnapshot()
          });
          return;
        }
        if (!isRwRing && activeUploadDeviceMac && !validateAwarenessHomeSyncContext('legacy-local-data-before-submit', {
          expectedMac: activeUploadDeviceMac,
          allowMissingCurrent: false
        })) {
          userStore.updateUploadingStatus('2');
          userStore.updateIsSending(false);
          appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
            protocol,
            isRwRing,
            reason: 'active-sync-device-mismatch-before-submit',
            activeMac: activeUploadDeviceMac,
            deviceMac,
            localDataCount: localData.length,
            rawRecordCount: allFilteredRecords.length,
            stableSnapshot: getLegacyLocalDataStableSnapshot(),
            snapshot: getAwarenessConnectionSnapshot()
          });
          return;
        }
        const uploadSinceTimestamp = getAwarenessHistoryUploadSinceTimestamp(isRwRing);
        const uploadBatch = buildLegacyLocalDataUploadBatch(deviceMac, uploadSinceTimestamp);
        const filteredRecords = uploadBatch.records;
        const rawFrames = uploadBatch.rawFrames;
        const rawMetricCounts = uploadBatch.rawMetricCounts;
        const builtSubmitArray = uploadBatch.builtSubmitArray;
        const uploadedRecordFilter = uploadBatch.uploadedRecordFilter;
        const submitArray = uploadBatch.submitArray;
        const submitMetricCounts = uploadBatch.submitMetricCounts;
        const rawRecordSummary = uploadBatch.rawRecordSummary;
        const submitRecordSummary = uploadBatch.submitRecordSummary;
        appendAwarenessDiagnosticLog('legacy-local-data-upload-ready', {
          protocol,
          isRwRing,
          batchSource: uploadBatch.source,
          localDataCount: localData.length,
          rawPayloadCount: uploadBatch.payloadScope.matchedPayloads.length,
          rawRecordCount: allFilteredRecords.length,
          skippedDeviceRecordCount: Math.max(0, allFilteredRecords.length - filteredRecords.length),
          filteredRecordCount: filteredRecords.length,
          rawFrameCount: rawFrames.length,
          builtSubmitCount: builtSubmitArray.length,
          submitCount: submitArray.length,
          alreadyUploadedCount: uploadedRecordFilter.alreadyUploadedRecords.length,
          uploadedRecordKeyCount: uploadedRecordFilter.uploadedRecordKeyCount,
          lastReadTimestamp: userStore.lastReadTimestamp,
          uploadSinceTimestamp,
          uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
          rawMetricCounts,
          submitMetricCounts,
          rawRecordSummary,
          submitRecordSummary,
          sample: submitArray.slice(0, 2),
          snapshot: getAwarenessConnectionSnapshot()
        });

        if (submitArray.length !== 0) {
          const uploadDedupKey = getLegacyLocalDataUploadKey(deviceMac, uploadSinceTimestamp, submitArray as Array<Record<string, any>>, submitMetricCounts);
          const now = Date.now();
          if (legacyLocalDataUploadPromise) {
            appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
              protocol,
              isRwRing,
              reason: 'dedup-running',
              submitCount: submitArray.length,
              uploadSinceTimestamp,
              uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
              submitMetricCounts,
              submitRecordSummary,
              deviceMac,
              snapshot: getAwarenessConnectionSnapshot()
            });
            return;
          }
          if (uploadDedupKey === lastLegacyLocalDataUploadKey && now - lastLegacyLocalDataUploadAt < LEGACY_LOCAL_DATA_UPLOAD_DEDUP_MS) {
            appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
              protocol,
              isRwRing,
              reason: 'dedup-recent',
              elapsedMs: now - lastLegacyLocalDataUploadAt,
              submitCount: submitArray.length,
              uploadSinceTimestamp,
              uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
              submitMetricCounts,
              submitRecordSummary,
              deviceMac,
              snapshot: getAwarenessConnectionSnapshot()
            });
            return;
          }
          const uploadSignatureSnapshot = getLegacyLocalDataStableSnapshot();
          const uploadSignatureKey = claimLegacyLocalDataUploadSignature(uploadSignatureSnapshot);
          if (!uploadSignatureKey) {
            const signatureSkipReason = getLegacyLocalDataStableSkipReason(uploadSignatureSnapshot) || 'same-signature-upload-blocked';
            appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
              protocol,
              isRwRing,
              reason: signatureSkipReason,
              submitCount: submitArray.length,
              uploadSinceTimestamp,
              uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
              uploadDedupKey,
              submitMetricCounts,
              submitRecordSummary,
              deviceMac,
              stableSnapshot: uploadSignatureSnapshot,
              snapshot: getAwarenessConnectionSnapshot()
            });
            return;
          }
          const backendBinding = await assertAwarenessBackendUploadBindingCached(deviceMac, {
            protocol,
            isRwRing,
            stage: 'legacy-local-data-upload',
            submitCount: submitArray.length,
            rawFrameCount: rawFrames.length,
            uploadSinceTimestamp,
            uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
            submitMetricCounts
          });
          if (!backendBinding.ok) {
            releaseLegacyLocalDataUploadSignature(uploadSignatureSnapshot);
            appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
              protocol,
              isRwRing,
              reason: 'backend-current-binding-invalid',
              reasonCode: backendBinding.reasonCode,
              message: backendBinding.reason,
              submitCount: submitArray.length,
              rawFrameCount: rawFrames.length,
              deviceMac,
              backendDeviceMac: backendBinding.deviceMac,
              backendDevice: summarizeAwarenessDevice(backendBinding.device as Record<string, any> | null | undefined),
              snapshot: getAwarenessConnectionSnapshot()
            });
            if (backendBinding.reasonCode === 'NO_ACTIVE_BINDING') {
              await clearFrontendRingBindingState(userStore, ringStore);
            }
            return;
          }
          const uploadSession = stagePendingUploadSession({
            uploadSessionId: createUploadSessionId(protocol || 'legacy'),
            deviceMac,
            protocol,
            bindingId: backendBinding.bindingId,
            bindingVersion: backendBinding.bindingVersion,
            dataUserId: backendBinding.dataUserId,
            dataList: submitArray as any,
            rawFrames
          });
          homeDataSyncing.value = true;
          userStore.updateUploadingStatus('1');
          appendAwarenessDiagnosticLog('legacy-local-data-upload-start', {
            protocol,
            isRwRing,
            uploadSessionId: uploadSession.uploadSessionId,
            submitCount: submitArray.length,
            uploadSinceTimestamp,
            uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
            submitMetricCounts,
            submitRecordSummary,
            rawFrameCount: rawFrames.length,
            deviceMac,
            sample: submitArray.slice(0, 2),
            snapshot: getAwarenessConnectionSnapshot()
          });
          appendAwarenessDiagnosticLog('upload-start', {
            protocol,
            isRwRing,
            stage: 'legacy-local-data-upload',
            uploadSessionId: uploadSession.uploadSessionId,
            submitCount: submitArray.length,
            uploadSinceTimestamp,
            uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
            submitMetricCounts,
            rawFrameCount: rawFrames.length,
            deviceMac,
            snapshot: getAwarenessConnectionSnapshot()
          });

          let submitResponse: unknown;
          let rawSubmitResponse: unknown;
          try {
            legacyLocalDataUploadPromise = (async () => {
              return submitData({
                deviceMac,
                dataList: submitArray,
                ...buildUploadSyncMeta(uploadSession)
              });
            })();
            submitResponse = await legacyLocalDataUploadPromise;
            if (!isSubmitDataResponseSuccessful(submitResponse)) {
              throw new Error('历史数据提交失败');
            }
            markPendingUploadDataDone(uploadSession.uploadSessionId, submitResponse);
          } catch (uploadError) {
            releaseLegacyLocalDataUploadSignature(uploadSignatureSnapshot);
            markPendingUploadDataFailed(uploadSession.uploadSessionId, uploadError);
            throw uploadError;
          } finally {
            legacyLocalDataUploadPromise = null;
          }
          if (rawFrames.length > 0) {
            rawSubmitResponse = { rawStatus: 'scheduled', uploadSessionId: uploadSession.uploadSessionId, rawFrameCount: rawFrames.length };
            appendAwarenessDiagnosticLog('upload-start', {
              protocol,
              isRwRing,
              stage: 'legacy-local-raw-upload',
              uploadSessionId: uploadSession.uploadSessionId,
              deviceMac,
              rawFrameCount: rawFrames.length,
              snapshot: getAwarenessConnectionSnapshot()
            });
            void uploadPendingRawFramesInBackground(uploadSession, (params) => submitRingHistoryRawFrames(params))
              .then((rawUploadResponse) => {
                appendAwarenessDiagnosticLog('upload-result', {
                  protocol,
                  isRwRing,
                  stage: 'legacy-local-raw-upload',
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  rawFrameCount: rawFrames.length,
                  rawSubmitResponse: summarizeSubmitDataResponse(rawUploadResponse),
                  snapshot: getAwarenessConnectionSnapshot()
                });
              })
              .catch((rawUploadError) => {
                appendAwarenessDiagnosticLog('legacy-local-raw-upload-failed', {
                  protocol,
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  rawFrameCount: rawFrames.length,
                  error: formatBleErrorMessage(rawUploadError, 'raw history upload failed'),
                  rawError: getAwarenessRawError(rawUploadError),
                  snapshot: getAwarenessConnectionSnapshot()
                });
                appendAwarenessDiagnosticLog('upload-failed', {
                  protocol,
                  isRwRing,
                  stage: 'legacy-local-raw-upload',
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  rawFrameCount: rawFrames.length,
                  error: formatBleErrorMessage(rawUploadError, 'raw history upload failed'),
                  rawError: getAwarenessRawError(rawUploadError),
                  snapshot: getAwarenessConnectionSnapshot()
                });
              });
          } else {
            rawSubmitResponse = { rawStatus: 'none', uploadSessionId: uploadSession.uploadSessionId, rawFrameCount: 0 };
          }
          const uploadedRecordKeyCount = markUploadedRingHistorySubmitRecordsForDevice(deviceMac, submitArray);
          lastLegacyLocalDataUploadKey = uploadDedupKey;
          lastLegacyLocalDataUploadAt = Date.now();
          appendAwarenessDiagnosticLog('legacy-local-data-upload-result', {
            protocol,
            isRwRing,
            uploadSessionId: uploadSession.uploadSessionId,
            submitCount: submitArray.length,
            alreadyUploadedCount: uploadedRecordFilter.alreadyUploadedRecords.length,
            uploadedRecordKeyCount,
            uploadSinceTimestamp,
            uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
            submitMetricCounts,
            submitRecordSummary,
            rawFrameCount: rawFrames.length,
            rawSubmitResponse: summarizeSubmitDataResponse(rawSubmitResponse),
            submitResponse: summarizeSubmitDataResponse(submitResponse),
            snapshot: getAwarenessConnectionSnapshot()
          });
          appendAwarenessDiagnosticLog('upload-result', {
            protocol,
            isRwRing,
            stage: 'legacy-local-data-upload',
            uploadSessionId: uploadSession.uploadSessionId,
            submitCount: submitArray.length,
            alreadyUploadedCount: uploadedRecordFilter.alreadyUploadedRecords.length,
            uploadedRecordKeyCount,
            uploadSinceTimestamp,
            uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
            submitMetricCounts,
            rawFrameCount: rawFrames.length,
            rawSubmitResponse: summarizeSubmitDataResponse(rawSubmitResponse),
            submitResponse: summarizeSubmitDataResponse(submitResponse),
            snapshot: getAwarenessConnectionSnapshot()
          });
          if (!isRwRing) {
            if (shouldKeepLegacyLocalHistoryCacheAfterUpload(submitMetricCounts, submitResponse)) {
              appendAwarenessDiagnosticLog('legacy-local-data-cache-keep', {
                protocol,
                isRwRing,
                reason: 'sleep-not-ingested',
                submitCount: submitArray.length,
                uploadSinceTimestamp,
                uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
                submitMetricCounts,
                submitRecordSummary,
                submitResponse: summarizeSubmitDataResponse(submitResponse),
                deviceMac,
                snapshot: getAwarenessConnectionSnapshot()
              });
            } else {
              clearLegacyLocalHistoryCacheAfterUpload({
                protocol,
                submitCount: submitArray.length,
                uploadSinceTimestamp,
                uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
                submitMetricCounts,
                submitRecordSummary,
                deviceMac
              });
            }
          }

          userStore.updateUploadingStatus('2');
          const submittedTimestamps = submitArray
            .map((record: any) => getRingHistoryRecordSyncUnixTime(record))
            .filter(
              (timestamp): timestamp is number =>
                Boolean(timestamp && timestamp > 0 && (!uploadSinceTimestamp || timestamp >= uploadSinceTimestamp))
            );
          let maxSubmittedTimestamp = 0;
          if (submittedTimestamps.length > 0) {
            maxSubmittedTimestamp = Math.max(...submittedTimestamps);
            updateAwarenessDeviceHistoryCheckpoint(maxSubmittedTimestamp, 'legacy-local-data-upload-complete');
          }
          completeLegacyLocalDataUploadSignature(uploadSignatureSnapshot, maxSubmittedTimestamp);
          closeLegacyLocalDataUploadSession(deviceMac, uploadDedupKey, maxSubmittedTimestamp);
          markLegacyHomeHistoryReadCompletedForDevice(deviceMac);
          legacyLocalDataUploadWatcherPending = false;
          legacyLocalDataStableReadyAt = 0;
          legacyLocalDataStableUploadScheduled = false;
          markAwarenessHomeSyncCompleted('legacy-local-data-upload-complete');

          scheduleAwarenessAfterDataProcessed('legacy-local-data-upload-complete');
          // uni.hideLoading();
        } else if (!isRwRing) {
          const allParsedSubmitRecordsAlreadyUploaded =
            builtSubmitArray.length > 0 &&
            submitArray.length === 0 &&
            uploadedRecordFilter.alreadyUploadedRecords.length >= builtSubmitArray.length;
          if (allParsedSubmitRecordsAlreadyUploaded) {
            userStore.updateUploadingStatus('2');
            appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
              protocol,
              reason: 'all-submit-records-already-uploaded',
              deviceMac,
              rawFrameCount: rawFrames.length,
              localDataCount: localData.length,
              filteredRecordCount: filteredRecords.length,
              builtSubmitCount: builtSubmitArray.length,
              submitCount: submitArray.length,
              alreadyUploadedCount: uploadedRecordFilter.alreadyUploadedRecords.length,
              uploadedRecordKeyCount: uploadedRecordFilter.uploadedRecordKeyCount,
              lastReadTimestamp: userStore.lastReadTimestamp,
              uploadSinceTimestamp,
              uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
              rawMetricCounts,
              submitMetricCounts,
              rawRecordSummary,
              submitRecordSummary,
              snapshot: getAwarenessConnectionSnapshot()
            });
            markLegacyHomeHistoryReadCompletedForDevice(deviceMac);
            markAwarenessHomeSyncCompleted('legacy-local-data-already-uploaded');
            scheduleAwarenessAfterDataProcessed('legacy-local-data-already-uploaded');
            return;
          }
          let rawSubmitResponse: unknown;
          if (deviceMac && rawFrames.length > 0) {
            const backendBinding = await assertAwarenessBackendUploadBindingCached(deviceMac, {
              protocol,
              isRwRing,
              stage: 'legacy-local-raw-upload',
              reason: 'empty-submit-array',
              rawFrameCount: rawFrames.length,
              uploadSinceTimestamp,
              uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
              rawMetricCounts,
              submitMetricCounts
            });
            if (backendBinding.ok) {
              const uploadSession = stagePendingUploadSession({
                uploadSessionId: createUploadSessionId(protocol || 'legacy_raw'),
                deviceMac,
                protocol,
                bindingId: backendBinding.bindingId,
                bindingVersion: backendBinding.bindingVersion,
                dataUserId: backendBinding.dataUserId,
                dataList: [],
                rawFrames
              });
              rawSubmitResponse = {
                rawStatus: 'scheduled',
                uploadSessionId: uploadSession.uploadSessionId,
                rawFrameCount: rawFrames.length
              };
              appendAwarenessDiagnosticLog('upload-start', {
                protocol,
                isRwRing,
                stage: 'legacy-local-raw-upload',
                reason: 'empty-submit-array',
                uploadSessionId: uploadSession.uploadSessionId,
                deviceMac,
                rawFrameCount: rawFrames.length,
                snapshot: getAwarenessConnectionSnapshot()
              });
              void uploadPendingRawFramesInBackground(uploadSession, (params) => submitRingHistoryRawFrames(params))
                .then((rawUploadResponse) => {
                  appendAwarenessDiagnosticLog('upload-result', {
                    protocol,
                    isRwRing,
                    stage: 'legacy-local-raw-upload',
                    reason: 'empty-submit-array',
                    uploadSessionId: uploadSession.uploadSessionId,
                    deviceMac,
                    rawFrameCount: rawFrames.length,
                    rawSubmitResponse: summarizeSubmitDataResponse(rawUploadResponse),
                    snapshot: getAwarenessConnectionSnapshot()
                  });
                })
                .catch((rawUploadError) => {
                  appendAwarenessDiagnosticLog('legacy-local-raw-upload-failed', {
                    protocol,
                    reason: 'empty-submit-array',
                    uploadSessionId: uploadSession.uploadSessionId,
                    deviceMac,
                    rawFrameCount: rawFrames.length,
                    error: formatBleErrorMessage(rawUploadError, 'raw history upload failed'),
                    rawError: getAwarenessRawError(rawUploadError),
                    snapshot: getAwarenessConnectionSnapshot()
                  });
                  appendAwarenessDiagnosticLog('upload-failed', {
                    protocol,
                    isRwRing,
                    stage: 'legacy-local-raw-upload',
                    reason: 'empty-submit-array',
                    uploadSessionId: uploadSession.uploadSessionId,
                    deviceMac,
                    rawFrameCount: rawFrames.length,
                    error: formatBleErrorMessage(rawUploadError, 'raw history upload failed'),
                    rawError: getAwarenessRawError(rawUploadError),
                    snapshot: getAwarenessConnectionSnapshot()
                  });
                });
            } else {
              rawSubmitResponse = {
                rawStatus: 'skipped',
                reasonCode: backendBinding.reasonCode,
                message: backendBinding.reason,
                backendDeviceMac: backendBinding.deviceMac
              };
              if (backendBinding.reasonCode === 'NO_ACTIVE_BINDING') {
                await clearFrontendRingBindingState(userStore, ringStore);
              }
            }
          }
          appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
            protocol,
            reason: 'empty-submit-array',
            deferredRefresh: homeDataSyncing.value,
            deviceMac,
            rawFrameCount: rawFrames.length,
            rawSubmitResponse: summarizeSubmitDataResponse(rawSubmitResponse),
            localDataCount: localData.length,
            filteredRecordCount: filteredRecords.length,
            lastReadTimestamp: userStore.lastReadTimestamp,
            uploadSinceTimestamp,
            uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
            rawMetricCounts,
            submitMetricCounts,
            rawRecordSummary,
            submitRecordSummary,
            snapshot: getAwarenessConnectionSnapshot()
          });
          markLegacyHomeHistoryReadCompletedForDevice(deviceMac);
          markAwarenessHomeSyncCompleted('legacy-local-data-no-submit');
          scheduleAwarenessAfterDataProcessed('legacy-local-data-no-submit');
        }
      } else {
        // userStore.updateIsSending(false);
        userStore.updateUploadingStatus('2');
        if (!isRwRing) {
          appendAwarenessDiagnosticLog('legacy-local-data-upload-pending', {
            protocol,
            localDataCount: localData.length,
            localDataSummary: summarizeLegacyHistoryPayloadsForLog(localData as Array<Record<string, any>>),
            snapshot: getAwarenessConnectionSnapshot()
          });
        }
      }
    } catch (error) {
      userStore.updateIsSending(false);
      userStore.updateUploadingStatus('0');
      appendAwarenessDiagnosticLog('legacy-local-data-upload-failed', {
        protocol,
        isRwRing,
        error: formatBleErrorMessage(error, 'legacy local data upload failed'),
        rawError: getAwarenessRawError(error),
        snapshot: getAwarenessConnectionSnapshot()
      });
      appendAwarenessDiagnosticLog('upload-failed', {
        protocol,
        isRwRing,
        stage: 'legacy-local-data-upload',
        error: formatBleErrorMessage(error, 'legacy local data upload failed'),
        rawError: getAwarenessRawError(error),
        snapshot: getAwarenessConnectionSnapshot()
      });
      uni.hideLoading();
    } finally {
      // userStore.updateIsSending(false);
      homeDataSyncing.value = false;
      if (!isRwRing) {
        legacyLocalDataUploadWatcherActive = false;
        legacyLocalDataUploadWatcherActiveAt = 0;
        if (legacyLocalDataUploadWatcherPending) {
          const pendingSnapshot = getLegacyLocalDataStableSnapshot();
          const pendingSkipReason = getLegacyLocalDataStableSkipReason(pendingSnapshot);
          legacyLocalDataUploadWatcherPending = false;
          if (isLegacyLocalDataSilentTerminalSkipReason(pendingSkipReason)) {
            closeLegacyLocalDataTerminalSkip(pendingSnapshot);
            return;
          }
          if (isLegacyLocalDataTerminalSkipReason(pendingSkipReason)) {
            appendAwarenessDiagnosticLog('legacy-local-data-upload-pending-drop', {
              protocol,
              reason: pendingSkipReason,
              stableSnapshot: pendingSnapshot,
              snapshot: getAwarenessConnectionSnapshot()
            });
            return;
          }
          setTimeout(() => {
            legacyHomeHistoryReadCompletedTick.value = Date.now();
          }, 0);
        }
      }
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
const withAwarenessSoftTimeout = <T>(key: string, timeoutMs: number, task: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`awareness request soft timeout: ${key} ${timeoutMs}ms`));
    }, timeoutMs);

    task()
      .then((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });

const getAwarenessAuxiliaryCacheKey = (key: string, date: Date) =>
  `${getAwarenessHomeUploadDeviceKey()}:${key}:${formatLocalDate(date)}`;

const getAwarenessAuxiliaryStorageKey = (key: string, date: Date) =>
  `qkeer:awareness:aux:${getAwarenessHomeSyncUserId()}:${key}:${formatLocalDate(date)}`;

const readAwarenessAuxiliaryStorageCache = <T>(key: string, date: Date, ttlMs: number): T | null => {
  try {
    const cacheKey = getAwarenessAuxiliaryStorageKey(key, date);
    const cached = uni.getStorageSync(cacheKey);
    if (!cached || typeof cached !== 'object') return null;
    const cachedAt = Number((cached as Record<string, any>).cachedAt || 0);
    if (!cachedAt || Date.now() - cachedAt > ttlMs) return null;
    return (cached as Record<string, any>).value as T;
  } catch {
    return null;
  }
};

const writeAwarenessAuxiliaryStorageCache = <T>(key: string, date: Date, value: T) => {
  try {
    uni.setStorageSync(getAwarenessAuxiliaryStorageKey(key, date), {
      cachedAt: Date.now(),
      value
    });
  } catch {
    // 缓存失败不阻塞首页渲染。
  }
};

const claimAwarenessAuxiliaryRefresh = (key: string, date: Date, ttlMs = AWARENESS_AUXILIARY_REFRESH_TTL_MS) => {
  const cacheKey = getAwarenessAuxiliaryCacheKey(key, date);
  const now = Date.now();
  const lastAt = awarenessAuxiliaryRefreshAt.get(cacheKey) || 0;
  if (lastAt && now - lastAt < ttlMs) {
    appendAwarenessDiagnosticLog('business-aux-request-cache-skip', {
      key,
      date: formatLocalDate(date),
      elapsedMs: now - lastAt,
      ttlMs,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }
  awarenessAuxiliaryRefreshAt.set(cacheKey, now);
  return true;
};

const runAwarenessAuxiliaryCached = <T>(
  key: string,
  date: Date,
  task: () => Promise<T>,
  onResult: (value: T) => void,
  ttlMs = AWARENESS_AUXILIARY_REFRESH_TTL_MS
) => {
  const cached = readAwarenessAuxiliaryStorageCache<T>(key, date, ttlMs);
  if (cached != null && cached !== '') {
    onResult(cached);
    appendAwarenessDiagnosticLog('business-aux-request-storage-hit', {
      key,
      date: formatLocalDate(date),
      ttlMs,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }
  if (!claimAwarenessAuxiliaryRefresh(key, date, ttlMs)) return;
  void requestAwarenessAuxiliary(key, date, task).then((result) => {
    if (result != null && result !== '') {
      writeAwarenessAuxiliaryStorageCache(key, date, result);
      onResult(result);
    }
  });
};

const requestAwarenessOverview = async <T>(key: string, date: Date, task: () => Promise<T>): Promise<T | null> => {
  const startedAt = Date.now();
  appendAwarenessDiagnosticLog('business-overview-request-start', {
    key,
    date: formatLocalDate(date),
    snapshot: getAwarenessConnectionSnapshot()
  });
  try {
    const result = await withAwarenessSoftTimeout(key, AWARENESS_BUSINESS_REQUEST_SOFT_TIMEOUT_MS, task);
    appendAwarenessDiagnosticLog('business-overview-request-success', {
      key,
      date: formatLocalDate(date),
      elapsedMs: Date.now() - startedAt,
      summary: summarizeAwarenessResponse(result),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return result;
  } catch (error) {
    appendAwarenessDiagnosticLog('business-overview-request-failed', {
      key,
      date: formatLocalDate(date),
      elapsedMs: Date.now() - startedAt,
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
    sleepMinutes: record.sleepMinutes,
    sleepTotalMinutes: record.sleepTotalMinutes,
    totalSleepMinutes: record.totalSleepMinutes,
    totalMinutes: record.totalMinutes,
    asleepMinutes: record.asleepMinutes,
    stressValue: record.stressValue,
    heartRate: record.heartRate,
    spo2: record.spo2,
    overallScore: record.overallScore
  };
};
const requestAwarenessAuxiliary = async <T>(key: string, date: Date, task: () => Promise<T>): Promise<T | null> => {
  const startedAt = Date.now();
  appendAwarenessDiagnosticLog('business-aux-request-start', {
    key,
    date: formatLocalDate(date),
    snapshot: getAwarenessConnectionSnapshot()
  });
  try {
    const result = await withAwarenessSoftTimeout(key, AWARENESS_AUXILIARY_REQUEST_SOFT_TIMEOUT_MS, task);
    appendAwarenessDiagnosticLog('business-aux-request-success', {
      key,
      date: formatLocalDate(date),
      elapsedMs: Date.now() - startedAt,
      summary: summarizeAwarenessResponse(result),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return result;
  } catch (error) {
    appendAwarenessDiagnosticLog('business-aux-request-failed', {
      key,
      date: formatLocalDate(date),
      elapsedMs: Date.now() - startedAt,
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
  const [res, resT] = await Promise.all([
    requestAwarenessOverview('stressDetail', currentDate, () =>
      getStressData({
        date: localDate,
        type: 'day',
        offset
      }, getAwarenessSilentRequestConfig())
    ),
    requestAwarenessOverview('stressSummary', currentDate, () =>
      getStressSummary({ date: formatLocalDate(currentDate) }, getAwarenessSilentRequestConfig())
    )
  ]);
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

type AwarenessBusinessRefreshOptions = {
  allowDuringSync?: boolean;
  trigger?: string;
  sourceTrigger?: string;
};

const isAwarenessDataSyncInProgress = () =>
  Boolean(
    homeDataSyncing.value ||
      awarenessRefreshPromise ||
      awarenessHistorySyncPromise ||
      legacyHomeHistoryReadInFlight.value ||
      legacyHomeHistoryReadPromise ||
      legacyLocalDataStablePromise ||
      legacyLocalDataUploadPromise
  );

const isAwarenessFinalBusinessRefreshTrigger = (trigger = '') =>
  /upload-complete|sync-result/.test(trigger);

const isAwarenessFinalBusinessRefreshKey = (queueKey = '') => queueKey.startsWith('final:');

const getAwarenessBusinessRefreshQueueKey = (date: string, trigger = '', sourceTrigger = '') => {
  const deviceKey = getAwarenessHomeUploadDeviceKey();
  if (isAwarenessFinalBusinessRefreshTrigger(trigger) || isAwarenessFinalBusinessRefreshTrigger(sourceTrigger)) {
    return `final:${deviceKey}:${date}`;
  }
  return `business:${deviceKey}:${date}:${trigger || 'unknown'}`;
};

const getAwarenessSelectedDateString = () => {
  if (selectedDayIndex.value === 3 && selectData.value) {
    const formattedDate = uni.$uv.timeFormat(selectData.value, 'yyyy-mm-dd');
    if (formattedDate && formattedDate !== 'NaN-NaN-NaN') return formattedDate;
  }
  const dayIndex = Number(selectedDayIndex.value) || 2;
  const selectedDate = dateList.value?.[dayIndex]?.date || new Date();
  return formatLocalDate(selectedDate);
};

const claimAwarenessPageShowRefresh = (date: string, trigger: string, force = false) => {
  const refreshKey = `${getAwarenessHomeUploadDeviceKey()}:${date}:${trigger}`;
  const now = Date.now();
  if (!force && lastAwarenessFinalRefreshAt && now - lastAwarenessFinalRefreshAt < AWARENESS_FINAL_REFRESH_DEDUP_MS) {
    appendAwarenessDiagnosticLog('business-overview-page-show-refresh-skip', {
      trigger,
      date,
      reason: 'dedup-recent-final-refresh',
      elapsedMs: now - lastAwarenessFinalRefreshAt,
      dedupMs: AWARENESS_FINAL_REFRESH_DEDUP_MS,
      refreshKey,
      lastAwarenessFinalRefreshKey,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }
  if (!force && refreshKey === lastAwarenessPageShowRefreshKey && now - lastAwarenessPageShowRefreshAt < AWARENESS_PAGE_SHOW_REFRESH_DEDUP_MS) {
    appendAwarenessDiagnosticLog('business-overview-page-show-refresh-skip', {
      trigger,
      date,
      reason: 'dedup-recent-page-show',
      elapsedMs: now - lastAwarenessPageShowRefreshAt,
      dedupMs: AWARENESS_PAGE_SHOW_REFRESH_DEDUP_MS,
      refreshKey,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }
  lastAwarenessPageShowRefreshKey = refreshKey;
  lastAwarenessPageShowRefreshAt = now;
  return true;
};

const queueAwarenessBusinessRefresh = (date: string, trigger: string, reason: string) => {
  const queueKey = getAwarenessBusinessRefreshQueueKey(date, trigger);
  if (queueKey && (queueKey === pendingAwarenessBusinessRefreshKey || queueKey === runningAwarenessBusinessRefreshKey)) {
    appendAwarenessDiagnosticLog('business-overview-refresh-queue-skip', {
      trigger,
      date,
      reason,
      queueKey,
      pendingAwarenessBusinessRefreshDate,
      pendingAwarenessBusinessRefreshTrigger,
      runningAwarenessBusinessRefreshKey,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }
  pendingAwarenessBusinessRefreshDate = date;
  pendingAwarenessBusinessRefreshTrigger = trigger;
  pendingAwarenessBusinessRefreshKey = queueKey;
  return true;
};

const runAwarenessBusinessRefreshStage = async (
  stage: string,
  date: string,
  options: AwarenessBusinessRefreshOptions,
  task: () => Promise<unknown>
) => {
  const startedAt = Date.now();
  appendAwarenessDiagnosticLog('business-overview-refresh-stage-start', {
    stage,
    trigger: options.trigger || 'unknown',
    sourceTrigger: options.sourceTrigger,
    date,
    snapshot: getAwarenessConnectionSnapshot()
  });
  try {
    await withAwarenessSoftTimeout(`stage:${stage}`, AWARENESS_BUSINESS_STAGE_SOFT_TIMEOUT_MS, task);
    appendAwarenessDiagnosticLog('business-overview-refresh-stage-result', {
      stage,
      trigger: options.trigger || 'unknown',
      sourceTrigger: options.sourceTrigger,
      date,
      elapsedMs: Date.now() - startedAt,
      snapshot: getAwarenessConnectionSnapshot()
    });
  } catch (error) {
    appendAwarenessDiagnosticLog('business-overview-refresh-stage-failed', {
      stage,
      trigger: options.trigger || 'unknown',
      sourceTrigger: options.sourceTrigger,
      date,
      elapsedMs: Date.now() - startedAt,
      error: formatBleErrorMessage(error, 'business overview refresh stage failed'),
      rawError: getAwarenessRawError(error),
      snapshot: getAwarenessConnectionSnapshot()
    });
  }
};

const scheduleAwarenessBusinessChartRefresh = (date: string, options: AwarenessBusinessRefreshOptions = {}) => {
  if (awarenessBusinessChartRefreshPromise) {
    appendAwarenessDiagnosticLog('business-overview-chart-refresh-skip', {
      trigger: options.trigger || 'unknown',
      sourceTrigger: options.sourceTrigger,
      date,
      reason: 'dedup-running',
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  awarenessBusinessChartRefreshPromise = (async () => {
    await waitForAwarenessMs(0);
    const startedAt = Date.now();
    appendAwarenessDiagnosticLog('business-overview-chart-refresh-start', {
      trigger: options.trigger || 'unknown',
      sourceTrigger: options.sourceTrigger,
      date,
      snapshot: getAwarenessConnectionSnapshot()
    });
    const results = await Promise.allSettled([
      runAwarenessBusinessRefreshStage('chart.balance', date, options, () => initBalanceChart()),
      runAwarenessBusinessRefreshStage('chart.sport', date, options, () => initSportChart()),
      runAwarenessBusinessRefreshStage('chart.vital', date, options, () => initVitalChart()),
      runAwarenessBusinessRefreshStage('chart.sleep', date, options, () => initSleepChart())
    ]);
    appendAwarenessDiagnosticLog('business-overview-chart-refresh-result', {
      trigger: options.trigger || 'unknown',
      sourceTrigger: options.sourceTrigger,
      date,
      elapsedMs: Date.now() - startedAt,
      failedCount: results.filter((item) => item.status === 'rejected').length,
      snapshot: getAwarenessConnectionSnapshot()
    });
  })().finally(() => {
    awarenessBusinessChartRefreshPromise = null;
  });
};

const runAwarenessBusinessOverviewRefresh = async (date: string, options: AwarenessBusinessRefreshOptions = {}) => {
  const startedAt = Date.now();
  const currentDate = parseLocalDate(date);
  appendAwarenessDiagnosticLog('business-overview-refresh-start', {
    trigger: options.trigger || 'unknown',
    sourceTrigger: options.sourceTrigger,
    date,
    queueKey: runningAwarenessBusinessRefreshKey,
    snapshot: getAwarenessConnectionSnapshot()
  });
  void (async () => {
    await runAwarenessBusinessRefreshStage('stressInfo', date, options, () => getStressInfo(currentDate));
    await runAwarenessBusinessRefreshStage('chart.relax', date, options, () => initRelaxChart());
  })();
  await Promise.all([
    runAwarenessBusinessRefreshStage('goalInfo', date, options, () => getHomeGoalInfoData(currentDate)),
    runAwarenessBusinessRefreshStage('balanceScore', date, options, () => getBalanceScoreData(currentDate)),
    runAwarenessBusinessRefreshStage('sleepOverview', date, options, () => getSleepOverviewData(currentDate)),
    runAwarenessBusinessRefreshStage('motionOverview', date, options, () => getMotionOverviewData(currentDate)),
    runAwarenessBusinessRefreshStage('vitalSign', date, options, () => getVitalSigns(currentDate))
  ]);
  scheduleAwarenessBusinessChartRefresh(date, options);
  appendAwarenessDiagnosticLog('business-overview-refresh-result', {
    trigger: options.trigger || 'unknown',
    sourceTrigger: options.sourceTrigger,
    date,
    queueKey: runningAwarenessBusinessRefreshKey,
    elapsedMs: Date.now() - startedAt,
    balanceScore: summarizeAwarenessResponse(balanceScoreObj.value),
    sleepOverview: summarizeAwarenessResponse(sleepOverviewObj.value),
    motionOverview: summarizeAwarenessResponse(motionOverviewObj.value),
    stressDetail: summarizeAwarenessResponse(stressDetailObj.value),
    vitalSign: summarizeAwarenessResponse(vitalSignObj.value),
    snapshot: getAwarenessConnectionSnapshot()
  });
};

const refreshAwarenessBusinessOverview = async (date: string, options: AwarenessBusinessRefreshOptions = {}) => {
  const trigger = options.trigger || 'unknown';
  if (!options.allowDuringSync && isAwarenessDataSyncInProgress()) {
    const queued = queueAwarenessBusinessRefresh(date, trigger, 'sync-in-progress');
    appendAwarenessDiagnosticLog('business-overview-refresh-deferred', {
      trigger,
      date,
      reason: 'sync-in-progress',
      queued,
      queueKey: pendingAwarenessBusinessRefreshKey,
      syncing: homeDataSyncing.value,
      legacyHomeHistoryReadInFlight: legacyHomeHistoryReadInFlight.value,
      hasAwarenessHistorySyncPromise: Boolean(awarenessHistorySyncPromise),
      hasAwarenessRefreshPromise: Boolean(awarenessRefreshPromise),
      hasLegacyLocalDataUploadPromise: Boolean(legacyLocalDataUploadPromise),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  if (awarenessBusinessRefreshPromise) {
    const queued = queueAwarenessBusinessRefresh(date, trigger, 'dedup-running');
    appendAwarenessDiagnosticLog('business-overview-refresh-skip', {
      trigger,
      date,
      reason: 'dedup-running',
      queued,
      queueKey: pendingAwarenessBusinessRefreshKey,
      allowDuringSync: options.allowDuringSync === true,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  runningAwarenessBusinessRefreshKey = getAwarenessBusinessRefreshQueueKey(date, trigger, options.sourceTrigger);
  awarenessBusinessRefreshPromise = runAwarenessBusinessOverviewRefresh(date, options);
  try {
    await awarenessBusinessRefreshPromise;
    if (isAwarenessFinalBusinessRefreshKey(runningAwarenessBusinessRefreshKey)) {
      lastAwarenessFinalRefreshKey = runningAwarenessBusinessRefreshKey;
      lastAwarenessFinalRefreshAt = Date.now();
    }
  } finally {
    awarenessBusinessRefreshPromise = null;
    const queuedDate = pendingAwarenessBusinessRefreshDate;
    const queuedTrigger = pendingAwarenessBusinessRefreshTrigger;
    const queuedKey = pendingAwarenessBusinessRefreshKey;
    const finishedRefreshKey = runningAwarenessBusinessRefreshKey;
    const shouldDropQueuedRefreshAfterFinal =
      Boolean(queuedDate) && isAwarenessFinalBusinessRefreshKey(finishedRefreshKey);
    const shouldRunQueuedRefresh =
      Boolean(queuedDate) &&
      !shouldDropQueuedRefreshAfterFinal &&
      !isAwarenessDataSyncInProgress();
    runningAwarenessBusinessRefreshKey = '';
    if (shouldRunQueuedRefresh || shouldDropQueuedRefreshAfterFinal) {
      pendingAwarenessBusinessRefreshDate = '';
      pendingAwarenessBusinessRefreshTrigger = '';
      pendingAwarenessBusinessRefreshKey = '';
    }
    if (shouldDropQueuedRefreshAfterFinal) {
      appendAwarenessDiagnosticLog('business-overview-refresh-queue-drop', {
        trigger: 'drop-after-final-refresh',
        sourceTrigger: queuedTrigger,
        date: queuedDate,
        queueKey: queuedKey,
        finishedRefreshKey,
        reason: 'final-refresh-already-ran',
        snapshot: getAwarenessConnectionSnapshot()
      });
      return;
    }
    if (shouldRunQueuedRefresh) {
      appendAwarenessDiagnosticLog('business-overview-refresh-queue-consume', {
        trigger: 'queued-after-running',
        sourceTrigger: queuedTrigger,
        date: queuedDate,
        queueKey: queuedKey,
        snapshot: getAwarenessConnectionSnapshot()
      });
      setTimeout(() => {
        void refreshAwarenessBusinessOverview(queuedDate, {
          allowDuringSync: true,
          trigger: 'queued-after-running',
          sourceTrigger: queuedTrigger
        });
      }, 0);
    }
  }
};

const refreshAwarenessAfterDataProcessed = async (reason: string, date = getSelectedDetailDate()) => {
  const now = Date.now();
  const pendingRefreshTrigger = pendingAwarenessBusinessRefreshTrigger;
  const pendingRefreshKey = pendingAwarenessBusinessRefreshKey;
  const hadPendingBusinessRefresh = Boolean(pendingAwarenessBusinessRefreshDate || pendingAwarenessBusinessRefreshKey);
  const refreshDate = pendingAwarenessBusinessRefreshDate || date;
  pendingAwarenessBusinessRefreshDate = '';
  pendingAwarenessBusinessRefreshTrigger = '';
  pendingAwarenessBusinessRefreshKey = '';
  const shouldForceProcessedRefresh =
    hadPendingBusinessRefresh || reason.includes('upload-complete') || reason.includes('sync-result');
  const finalRefreshTrigger = isAwarenessFinalBusinessRefreshTrigger(reason)
    ? reason
    : isAwarenessFinalBusinessRefreshTrigger(pendingRefreshTrigger)
      ? pendingRefreshTrigger
      : '';
  const finalRefreshKey = finalRefreshTrigger ? getAwarenessBusinessRefreshQueueKey(refreshDate, finalRefreshTrigger) : '';
  if (awarenessProcessedRefreshPromise) {
    appendAwarenessDiagnosticLog('business-processed-refresh-skip', {
      reason: 'dedup-running',
      trigger: reason,
      pendingTrigger: pendingRefreshTrigger,
      date: refreshDate,
      forced: shouldForceProcessedRefresh,
      finalRefreshKey,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return awarenessProcessedRefreshPromise;
  }
  if (
    finalRefreshKey &&
    finalRefreshKey === lastAwarenessFinalRefreshKey &&
    now - lastAwarenessFinalRefreshAt < AWARENESS_FINAL_REFRESH_DEDUP_MS
  ) {
    appendAwarenessDiagnosticLog('business-processed-refresh-skip', {
      reason: 'dedup-final-refresh',
      trigger: reason,
      pendingTrigger: pendingRefreshTrigger,
      date: refreshDate,
      elapsedMs: now - lastAwarenessFinalRefreshAt,
      finalRefreshKey,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }
  if (!shouldForceProcessedRefresh && now - lastAwarenessProcessedRefreshAt < AWARENESS_PROCESSED_REFRESH_DEDUP_MS) {
    appendAwarenessDiagnosticLog('business-processed-refresh-skip', {
      reason: 'dedup-recent',
      trigger: reason,
      pendingTrigger: pendingRefreshTrigger,
      date: refreshDate,
      elapsedMs: now - lastAwarenessProcessedRefreshAt,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }
  homeDataRefreshingAfterSync.value = true;
  awarenessProcessedRefreshPromise = (async () => {
    const startedAt = Date.now();
    appendAwarenessDiagnosticLog('business-processed-refresh-start', {
      trigger: reason,
      pendingTrigger: pendingRefreshTrigger,
      date: refreshDate,
      forced: shouldForceProcessedRefresh,
      pendingRefreshKey,
      finalRefreshKey,
      snapshot: getAwarenessConnectionSnapshot()
    });
    await refreshAwarenessBusinessOverview(refreshDate, { allowDuringSync: true, trigger: reason });
    const chartRefreshPromise = awarenessBusinessChartRefreshPromise;
    if (chartRefreshPromise) {
      appendAwarenessDiagnosticLog('business-processed-chart-refresh-detached', {
        trigger: reason,
        pendingTrigger: pendingRefreshTrigger,
        date: refreshDate,
        reason: 'do-not-block-processed-refresh',
        snapshot: getAwarenessConnectionSnapshot()
      });
    }
    lastAwarenessProcessedRefreshAt = Date.now();
    if (finalRefreshKey) {
      lastAwarenessFinalRefreshKey = finalRefreshKey;
      lastAwarenessFinalRefreshAt = lastAwarenessProcessedRefreshAt;
    }
    appendAwarenessDiagnosticLog('business-processed-refresh-result', {
      trigger: reason,
      pendingTrigger: pendingRefreshTrigger,
      date: refreshDate,
      elapsedMs: Date.now() - startedAt,
      finalRefreshKey,
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
    homeDataRefreshingAfterSync.value = false;
  }
};

const scheduleAwarenessAfterDataProcessed = (reason: string, date = getSelectedDetailDate()) => {
  setTimeout(() => {
    void refreshAwarenessAfterDataProcessed(reason, date).catch((error) => {
      appendAwarenessDiagnosticLog('business-processed-refresh-schedule-failed', {
        trigger: reason,
        date,
        error: formatBleErrorMessage(error, 'business overview refresh failed'),
        rawError: getAwarenessRawError(error),
        snapshot: getAwarenessConnectionSnapshot()
      });
    });
  }, 0);
};

const syncRwHomeDeviceTimeBeforeHistory = async (trigger: string, options: { allowLegacy?: boolean } = {}) => {
  const isRwRing = isAwarenessRwRing();
  if ((!isRwRing && !options.allowLegacy) || !hasAwarenessCommunicationReady()) return;

  const now = Date.now();
  if (now - lastAwarenessDeviceTimeSyncAt < RW_AWARENESS_DEVICE_TIME_SYNC_DEDUP_MS) {
    appendAwarenessDiagnosticLog('device-time-sync-skip', {
      reason: 'dedup-recent',
      trigger,
      isRwRing,
      allowLegacy: options.allowLegacy === true,
      elapsedMs: now - lastAwarenessDeviceTimeSyncAt,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  const timezone = -new Date().getTimezoneOffset() / 60;
  const startedAt = Date.now();
  appendAwarenessDiagnosticLog('device-time-sync-start', {
    trigger,
    isRwRing,
    allowLegacy: options.allowLegacy === true,
    timestampMs: now,
    timezone,
    snapshot: getAwarenessConnectionSnapshot()
  });

  try {
    await updateDeviceTime(now, timezone);
    lastAwarenessDeviceTimeSyncAt = Date.now();
    appendAwarenessDiagnosticLog('device-time-sync-result', {
      trigger,
      isRwRing,
      allowLegacy: options.allowLegacy === true,
      elapsedMs: Date.now() - startedAt,
      timestampMs: now,
      timezone,
      snapshot: getAwarenessConnectionSnapshot()
    });
  } catch (error) {
    appendAwarenessDiagnosticLog('device-time-sync-failed', {
      trigger,
      isRwRing,
      allowLegacy: options.allowLegacy === true,
      elapsedMs: Date.now() - startedAt,
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
  if (!claimAwarenessHomeSyncSession(reason, options)) return;

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
      const deviceTimeStartedAt = Date.now();
      await syncRwHomeDeviceTimeBeforeHistory(reason);
      const deviceTimeElapsedMs = Date.now() - deviceTimeStartedAt;
      const historyStartedAt = Date.now();
      const result = await ringBusinessBridge.syncBusinessHistoryPage({
        page: 'awareness',
        date,
        dataTypes: RW_HOME_HISTORY_DATA_TYPES,
        allowRwDeviceSync: true,
        allowBackendUpload: true,
        timeoutMs: RW_HOME_HISTORY_SYNC_TIMEOUT_MS
      });
      const historySyncElapsedMs = Date.now() - historyStartedAt;
      const records = Array.isArray((result as any)?.records) ? (result as any).records : [];
      appendAwarenessDiagnosticLog('business-sync-background-result', {
        trigger: reason,
        date,
        elapsedMs: Date.now() - startedAt,
        deviceTimeElapsedMs,
        historySyncElapsedMs,
        status: (result as any)?.status || (result ? 'success' : 'empty'),
        recordCount: records.length,
        uploaded: (result as any)?.uploaded,
        packetShape: (result as any)?.packetShape,
        sourceType: (result as any)?.sourceType,
        snapshot: getAwarenessConnectionSnapshot()
      });

      lastAwarenessHistorySyncAt = Date.now();
      appendAwarenessDiagnosticLog('business-sync-refresh-overview-deferred', {
        trigger: reason,
        date,
        recordCount: records.length,
        reason: 'refresh-once-after-sync-result',
        snapshot: getAwarenessConnectionSnapshot()
      });
      await refreshAwarenessAfterDataProcessed(`${reason}-sync-result`, date);
  } catch (error) {
    appendAwarenessDiagnosticLog('business-sync-background-failed', {
      trigger: reason,
      date,
      elapsedMs: Date.now() - startedAt,
      error: formatBleErrorMessage(error, '\u9996\u9875\u5386\u53f2\u540c\u6b65\u5931\u8d25'),
      rawError: getAwarenessRawError(error),
      snapshot: getAwarenessConnectionSnapshot()
    });
    await refreshAwarenessAfterDataProcessed(`${reason}-sync-failed`, date).catch((overviewError) => {
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
      markAwarenessHomeSyncCompleted(`${reason}-rw-sync-finished`);
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

const handleDateClick = async (index: number, options: AwarenessBusinessRefreshOptions = {}) => {
  selectedDayIndex.value = index;
  const currentDate = dateList.value[index].date;
  selectData.value = currentDate;
  await refreshAwarenessBusinessOverview(formatLocalDate(currentDate), {
    trigger: options.trigger || 'date-click',
    allowDuringSync: options.allowDuringSync
  });
};
const openTimePicker = () => {
  calendar.value.open();
};
const confirm = async (date: any, options: AwarenessBusinessRefreshOptions = {}) => {

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
  await refreshAwarenessBusinessOverview(currentDate, {
    trigger: options.trigger || 'date-confirm',
    allowDuringSync: options.allowDuringSync
  });
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
  const { xData, seriesData } = buildStableAwarenessChartData(heartRateChart, vitalHeartRateNumber.value);

  newOption.xAxis.data = xData;
  newOption.series[0].data = seriesData;

  newOption.yAxis.min = 0;
  newOption.yAxis.max = HOME_VITAL_CHART_Y_AXIS_MAX;
  newOption.yAxis.splitNumber = 6;
  return newOption;
};
const getRelaxOption = () => {
  const newOption = JSON.parse(JSON.stringify(relaxOption));
  const stressChart = Array.isArray(stressDetailObj.value?.stressChart) ? stressDetailObj.value.stressChart : [];
  const { xData, seriesData } = buildStableAwarenessChartData(stressChart, relaxStressNumber.value);

  newOption.xAxis.data = xData;
  newOption.series[0].data = seriesData;
  newOption.yAxis.min = 0;
  newOption.yAxis.max = HOME_RELAX_CHART_Y_AXIS_MAX;
  newOption.yAxis.splitNumber = 5;
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
const refreshLegacyHomeDeviceInfoInBackground = (protocol: string, hasCachedSnapshot: boolean, reason = 'legacy-home-sync') => {
  if (!validateAwarenessHomeSyncContext('legacy-home-device-info-precheck', {
    requireReady: true,
    allowMissingCurrent: false
  })) {
    appendAwarenessDiagnosticLog('legacy-home-device-info-skip', {
      protocol,
      reason,
      skipReason: 'sync-context-or-communication-not-ready',
      hasCachedSnapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  if (legacyHomeDeviceInfoRefreshPromise) {
    appendAwarenessDiagnosticLog('legacy-home-device-info-skip', {
      protocol,
      reason,
      skipReason: 'refresh-already-running',
      hasCachedSnapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  legacyHomeDeviceInfoRefreshPromise = (async () => {
    const startedAt = Date.now();
    if (!validateAwarenessHomeSyncContext('legacy-home-device-info-before-refresh', {
      requireReady: true,
      allowMissingCurrent: false
    })) {
      appendAwarenessDiagnosticLog('legacy-home-device-info-skip', {
        protocol,
        reason,
        skipReason: 'sync-context-or-communication-not-ready-before-refresh',
        hasCachedSnapshot,
        snapshot: getAwarenessConnectionSnapshot()
      });
      return;
    }
    appendAwarenessDiagnosticLog('legacy-home-device-info-start', {
      protocol,
      reason,
      hasCachedSnapshot,
      timeoutMs: getRingRefreshTimeoutMs(),
      snapshot: getAwarenessConnectionSnapshot()
    });
    const refreshResult = await refreshHealthData({
      includeDeviceTime: false,
      includeCollectPeriod: false,
      includeDeviceInfo: true,
      includeRealtimeMetrics: false,
      includeHistorySnapshot: false,
      timeoutMs: getRingRefreshTimeoutMs()
    });
    lastAwarenessRefreshAt = Date.now();
    appendAwarenessDiagnosticLog('legacy-home-device-info-result', {
      protocol,
      reason,
      elapsedMs: Date.now() - startedAt,
      skipped: false,
      result: refreshResult,
      battery: displayBatteryValue.value,
      snapshot: getAwarenessConnectionSnapshot()
    });
  })()
    .catch((error) => {
      appendAwarenessDiagnosticLog('legacy-home-device-info-failed', {
        protocol,
        reason,
        error: formatBleErrorMessage(error, 'legacy device info refresh failed'),
        rawError: getAwarenessRawError(error),
        snapshot: getAwarenessConnectionSnapshot()
      });
    })
    .finally(() => {
      legacyHomeDeviceInfoRefreshPromise = null;
    });
};
const startLegacyHomeHistoryReadInBackground = (reason: string, protocol: string, options: { force?: boolean } = {}) => {
  const historyDate = formatLocalDate(new Date());
  const historySinceTimestamp = getAwarenessHistoryReadSinceTimestamp(false);
  const historyDeviceMac = getAwarenessCheckpointDeviceMac() || getAwarenessUploadDeviceMac();
  const normalizedHistoryDeviceMac = normalizeHistoryCheckpointDeviceMac(historyDeviceMac);
  const historyReadKey = getLegacyHomeHistoryReadKey(historyDeviceMac, historyDate, historySinceTimestamp);
  const historyScopeKey = getLegacyHomeHistoryReadScopeKey(historyDeviceMac, historyDate);
  const now = Date.now();

  if (isAwarenessHomeSyncInCooldown(reason, options)) {
    return;
  }

  if (!normalizedHistoryDeviceMac) {
    appendAwarenessDiagnosticLog('legacy-home-history-read-skip', {
      protocol,
      reason,
      skipReason: 'missing-device-mac',
      historyDate,
      historySinceTimestamp,
      historySinceText: formatUnixTimestampForLog(historySinceTimestamp),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  if (!validateAwarenessHomeSyncContext('legacy-home-history-read-precheck', {
    expectedMac: normalizedHistoryDeviceMac,
    requireReady: true,
    allowMissingCurrent: false
  })) {
    releaseAwarenessHomeSyncSession('legacy-home-history-read-precheck-failed', 'failed', false);
    appendAwarenessDiagnosticLog('legacy-home-history-read-skip', {
      protocol,
      reason,
      skipReason: 'sync-context-or-communication-not-ready',
      historyDate,
      deviceMac: normalizedHistoryDeviceMac,
      historySinceTimestamp,
      historySinceText: formatUnixTimestampForLog(historySinceTimestamp),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  if (legacyHomeHistoryReadPromise || legacyHomeHistoryReadInFlight.value) {
    appendAwarenessDiagnosticLog('legacy-home-history-read-skip', {
      protocol,
      reason,
      skipReason: 'read-already-running',
      hasPromise: Boolean(legacyHomeHistoryReadPromise),
      inFlight: legacyHomeHistoryReadInFlight.value,
      historyReadKey,
      historyScopeKey,
      activeReadKey: legacyHomeHistoryReadActiveKey,
      activeScopeKey: legacyHomeHistoryReadActiveScopeKey,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  const completedAt = legacyHomeHistoryReadCompletedAt.get(historyScopeKey) || 0;
  if (!options.force && completedAt > 0 && now - completedAt < LEGACY_HOME_HISTORY_READ_SCOPE_DEDUP_MS) {
    appendAwarenessDiagnosticLog('legacy-home-history-read-skip', {
      protocol,
      reason,
      skipReason: 'recent-device-day-completed',
      historyReadKey,
      historyScopeKey,
      historyDate,
      deviceMac: normalizedHistoryDeviceMac,
      historySinceTimestamp,
      historySinceText: formatUnixTimestampForLog(historySinceTimestamp),
      elapsedSinceCompletedMs: now - completedAt,
      dedupMs: LEGACY_HOME_HISTORY_READ_SCOPE_DEDUP_MS,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  const attemptedAt = legacyHomeHistoryReadAttemptAt.get(historyReadKey) || 0;
  if (!options.force && attemptedAt > 0 && now - attemptedAt < LEGACY_HOME_HISTORY_READ_RETRY_DEDUP_MS) {
    appendAwarenessDiagnosticLog('legacy-home-history-read-skip', {
      protocol,
      reason,
      skipReason: 'recent-same-window-attempt',
      historyReadKey,
      historyScopeKey,
      historyDate,
      deviceMac: normalizedHistoryDeviceMac,
      historySinceTimestamp,
      historySinceText: formatUnixTimestampForLog(historySinceTimestamp),
      elapsedSinceAttemptMs: now - attemptedAt,
      dedupMs: LEGACY_HOME_HISTORY_READ_RETRY_DEDUP_MS,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  legacyHomeHistoryReadAttemptAt.set(historyReadKey, now);
  legacyHomeHistoryReadActiveKey = historyReadKey;
  legacyHomeHistoryReadActiveScopeKey = historyScopeKey;
  const historyReadTimeoutMs = options.force ? LEGACY_HOME_HISTORY_SYNC_TIMEOUT_MS : LEGACY_HOME_HISTORY_BACKGROUND_TIMEOUT_MS;
  legacyHomeHistoryReadPromise = (async () => {
    await waitForAwarenessMs(300);
    if (!validateAwarenessHomeSyncContext('legacy-home-history-read-before-start', {
      expectedMac: normalizedHistoryDeviceMac,
      requireReady: true,
      allowMissingCurrent: false
    })) {
      legacyHomeHistoryReadAttemptAt.delete(historyReadKey);
      releaseAwarenessHomeSyncSession('legacy-home-history-read-before-start-failed', 'failed', false);
      appendAwarenessDiagnosticLog('legacy-home-history-read-skip', {
        protocol,
        reason,
        skipReason: 'sync-context-or-communication-not-ready-before-start',
        historyDate,
        deviceMac: normalizedHistoryDeviceMac,
        historyReadKey,
        historyScopeKey,
        historySinceTimestamp,
        historySinceText: formatUnixTimestampForLog(historySinceTimestamp),
        snapshot: getAwarenessConnectionSnapshot()
      });
      return;
    }
    let legacyHistoryReadCompleted = false;
    const historyStartedAt = Date.now();
    try {
      appendAwarenessDiagnosticLog('legacy-home-history-read-background-start', {
        protocol,
        reason,
        date: historyDate,
        deviceMac: normalizedHistoryDeviceMac,
        historyReadKey,
        historyScopeKey,
        sinceTimestamp: historySinceTimestamp,
        sinceText: formatUnixTimestampForLog(historySinceTimestamp),
        timeoutMs: historyReadTimeoutMs,
        snapshot: getAwarenessConnectionSnapshot()
      });
      await syncRwHomeDeviceTimeBeforeHistory('legacy-home-history-read', { allowLegacy: true });
      legacyHomeHistoryReadInFlight.value = true;
      legacyHomeHistoryReadStartedAt = Date.now();
      appendAwarenessDiagnosticLog('legacy-home-history-read-start', {
        protocol,
        reason,
        date: historyDate,
        deviceMac: normalizedHistoryDeviceMac,
        historyReadKey,
        historyScopeKey,
        sinceTimestamp: historySinceTimestamp,
        sinceText: formatUnixTimestampForLog(historySinceTimestamp),
        timeoutMs: historyReadTimeoutMs,
        snapshot: getAwarenessConnectionSnapshot()
      });

      let records: any[] = [];
      let primaryHistoryReadError: unknown = null;
      try {
        const historyResult = await readLocalData(false, historySinceTimestamp, undefined, {
          timeoutMs: historyReadTimeoutMs,
          silentUploadStatus: true,
          skipUpload: true
        });
        records = Array.isArray((historyResult as any)?.records) ? (historyResult as any).records : [];
        appendAwarenessDiagnosticLog('legacy-home-history-read-result', {
          protocol,
          reason,
          date: historyDate,
          deviceMac: normalizedHistoryDeviceMac,
          historyReadKey,
          historyScopeKey,
          sinceTimestamp: historySinceTimestamp,
          sinceText: formatUnixTimestampForLog(historySinceTimestamp),
          elapsedMs: Date.now() - historyStartedAt,
          status: (historyResult as any)?.status,
          uploaded: (historyResult as any)?.uploaded,
          recordCount: records.length,
          recordSummary: summarizeLegacyUploadRecordsForLog(records as Array<Record<string, any>>),
          receivedCount: Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0,
          localDataLength: Array.isArray(userStore.localData) ? userStore.localData.length : 0,
          sample: records.slice(0, 2),
          snapshot: getAwarenessConnectionSnapshot()
        });
      } catch (historyReadError) {
        primaryHistoryReadError = historyReadError;
        appendAwarenessDiagnosticLog('legacy-home-history-read-failed', {
          protocol,
          reason,
          date: historyDate,
          deviceMac: normalizedHistoryDeviceMac,
          historyReadKey,
          historyScopeKey,
          sinceTimestamp: historySinceTimestamp,
          sinceText: formatUnixTimestampForLog(historySinceTimestamp),
          elapsedMs: Date.now() - historyStartedAt,
          error: formatBleErrorMessage(historyReadError, 'legacy history read failed'),
          rawError: getAwarenessRawError(historyReadError),
          receivedCount: Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0,
          localDataLength: Array.isArray(userStore.localData) ? userStore.localData.length : 0,
          snapshot: getAwarenessConnectionSnapshot()
        });
      }

      const shouldRunEmptyFallback = options.force && records.length === 0 && !primaryHistoryReadError && historySinceTimestamp <= 0;
      if (shouldRunEmptyFallback) {
        const fallbackStartedAt = Date.now();
        const fallbackReadAll = historySinceTimestamp <= 0;
        appendAwarenessDiagnosticLog('legacy-home-history-empty-fallback-start', {
          protocol,
          reason,
          date: historyDate,
          deviceMac: normalizedHistoryDeviceMac,
          historyReadKey,
          historyScopeKey,
          primarySinceTimestamp: historySinceTimestamp,
          primarySinceText: formatUnixTimestampForLog(historySinceTimestamp),
          readAll: fallbackReadAll,
          reasonDetail: primaryHistoryReadError ? 'primary-history-read-failed' : 'empty-primary-history',
          primaryError: primaryHistoryReadError ? formatBleErrorMessage(primaryHistoryReadError, 'legacy history read failed') : undefined,
          primaryRawError: primaryHistoryReadError ? getAwarenessRawError(primaryHistoryReadError) : undefined,
          timeoutMs: LEGACY_HOME_EMPTY_HISTORY_FALLBACK_TIMEOUT_MS,
          snapshot: getAwarenessConnectionSnapshot()
        });
        const fallbackResult = await readLocalData(fallbackReadAll, fallbackReadAll ? historyDate : historySinceTimestamp, undefined, {
          timeoutMs: LEGACY_HOME_EMPTY_HISTORY_FALLBACK_TIMEOUT_MS,
          silentUploadStatus: true,
          skipUpload: true
        });
        const fallbackRecords = Array.isArray((fallbackResult as any)?.records) ? (fallbackResult as any).records : [];
        appendAwarenessDiagnosticLog('legacy-home-history-empty-fallback-result', {
          protocol,
          reason,
          date: historyDate,
          deviceMac: normalizedHistoryDeviceMac,
          historyReadKey,
          historyScopeKey,
          readAll: fallbackReadAll,
          primarySinceTimestamp: historySinceTimestamp,
          primarySinceText: formatUnixTimestampForLog(historySinceTimestamp),
          elapsedMs: Date.now() - fallbackStartedAt,
          status: (fallbackResult as any)?.status,
          uploaded: (fallbackResult as any)?.uploaded,
          recordCount: fallbackRecords.length,
          recordSummary: summarizeLegacyUploadRecordsForLog(fallbackRecords as Array<Record<string, any>>),
          receivedCount: Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0,
          localDataLength: Array.isArray(userStore.localData) ? userStore.localData.length : 0,
          rawMetricCounts: countRingHistoryRecordMetrics(fallbackRecords as Array<Record<string, any>>),
          sample: fallbackRecords.slice(0, 2),
          snapshot: getAwarenessConnectionSnapshot()
        });
      } else if (records.length === 0) {
        appendAwarenessDiagnosticLog('legacy-home-history-empty-fallback-skip', {
          protocol,
          reason,
          date: historyDate,
          deviceMac: normalizedHistoryDeviceMac,
          historyReadKey,
          historyScopeKey,
          primarySinceTimestamp: historySinceTimestamp,
          primarySinceText: formatUnixTimestampForLog(historySinceTimestamp),
          skipReason: primaryHistoryReadError ? 'primary-read-failed-or-timeout' : 'incremental-read-empty',
          primaryError: primaryHistoryReadError ? formatBleErrorMessage(primaryHistoryReadError, 'legacy history read failed') : undefined,
          snapshot: getAwarenessConnectionSnapshot()
        });
      }
      legacyHistoryReadCompleted = true;
    } catch (error) {
      appendAwarenessDiagnosticLog('legacy-home-history-read-background-failed', {
        protocol,
        reason,
        deviceMac: normalizedHistoryDeviceMac,
        historyReadKey,
        historyScopeKey,
        elapsedMs: Date.now() - historyStartedAt,
        error: formatBleErrorMessage(error, 'legacy history read background failed'),
        rawError: getAwarenessRawError(error),
        snapshot: getAwarenessConnectionSnapshot()
      });
    } finally {
      appendAwarenessDiagnosticLog('legacy-home-history-read-background-finished', {
        protocol,
        reason,
        completed: legacyHistoryReadCompleted,
        deviceMac: normalizedHistoryDeviceMac,
        historyReadKey,
        historyScopeKey,
        elapsedMs: Date.now() - historyStartedAt,
        readElapsedMs: legacyHomeHistoryReadStartedAt > 0 ? Date.now() - legacyHomeHistoryReadStartedAt : 0,
        snapshot: getAwarenessConnectionSnapshot()
      });
      legacyHomeHistoryReadInFlight.value = false;
      legacyHomeHistoryReadPromise = null;
      legacyHomeHistoryReadStartedAt = 0;
      legacyHomeHistoryReadActiveKey = '';
      legacyHomeHistoryReadActiveScopeKey = '';
      if (legacyHistoryReadCompleted) {
        legacyHomeHistoryReadCompletedAt.set(historyScopeKey, Date.now());
        legacyHomeHistoryReadCompletedTick.value = Date.now();
      }
    }
  })();

  void legacyHomeHistoryReadPromise;
};
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
      started = true;
      homeDataSyncing.value = true;
      userStore.updateUploadingStatus('2');
      appendAwarenessDiagnosticLog('legacy-home-sync-start', {
        protocol,
        hasCachedSnapshot,
        snapshot: getAwarenessConnectionSnapshot()
      });
      await ensureCommunicationReady();
      if (!validateAwarenessHomeSyncContext('legacy-home-sync-ready-gate', {
        requireReady: true,
        allowMissingCurrent: false
      })) {
        releaseAwarenessHomeSyncSession('legacy-home-sync-ready-gate-failed', 'failed', false);
        return;
      }
      const shouldRefreshDeviceInfo =
        !hasCachedSnapshot ||
        (isRwRing
          ? now - lastAwarenessRefreshAt >= RW_AWARENESS_REFRESH_DEDUP_MS
          : now - lastAwarenessRefreshAt >= LEGACY_HOME_DEVICE_INFO_REFRESH_INTERVAL_MS);
      if (!isRwRing) {
        startLegacyHomeHistoryReadInBackground('legacy-home-sync-device-info-ready', protocol);
      }
      if (shouldRefreshDeviceInfo) {
        refreshLegacyHomeDeviceInfoInBackground(protocol, hasCachedSnapshot);
      } else {
        appendAwarenessDiagnosticLog('legacy-home-device-info-skip', {
          protocol,
          reason: 'legacy-home-sync',
          skipReason: 'cached-device-info',
          hasCachedSnapshot,
          elapsedSinceRefreshMs: Date.now() - lastAwarenessRefreshAt,
          snapshot: getAwarenessConnectionSnapshot()
        });
      }
      if (!shouldRefreshDeviceInfo) {
        lastAwarenessRefreshAt = Date.now();
      }
      appendAwarenessDiagnosticLog('legacy-home-sync-result', {
        protocol,
        elapsedMs: Date.now() - startedAt,
        hasCachedSnapshot,
        deviceInfoBackground: shouldRefreshDeviceInfo,
        snapshot: getAwarenessConnectionSnapshot()
      });
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
// 后台异步加载页面数据，不阻塞页面首次渲染
const refreshPageDataAndCharts = async (options: { trigger?: string; force?: boolean; allowDuringSync?: boolean } = {}) => {
  const trigger = options.trigger || 'page-show-data-load';
  const refreshDate = getAwarenessSelectedDateString();
  if (!claimAwarenessPageShowRefresh(refreshDate, trigger, options.force === true)) {
    pullDownRefresh.value = false;
    pullDownProgress.value = 0;
    return;
  }

  try {
    if (selectedDayIndex.value) {
      const dayIndex = Number(selectedDayIndex.value) ?? 2;
      selectedDayIndex.value = dayIndex;
      if (dayIndex !== 3) {
        await handleDateClick(selectedDayIndex.value, {
          allowDuringSync: options.allowDuringSync === true,
          trigger
        });
      } else {
        if (selectData.value) {
          const formattedDate = uni.$uv.timeFormat(selectData.value, 'yyyy-mm-dd');
          if (formattedDate && formattedDate !== 'NaN-NaN-NaN') {
            await confirm(
              { fulldate: formattedDate },
              {
                allowDuringSync: options.allowDuringSync === true,
                trigger
              }
            );
          }
        }
      }
    }
    pullDownProgress.value = 100;
  } finally {
    pullDownRefresh.value = false;
    pullDownProgress.value = 0;
  }
};

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
    runAwarenessAuxiliaryCached(
      'unhealthDict',
      today.value,
      () => getSystemUnhealthDict({}, getAwarenessSilentRequestConfig()),
      (systemSync) => uni.setStorageSync('unhealthDict', systemSync),
      AWARENESS_STRONG_AUXILIARY_CACHE_TTL_MS
    );
    runAwarenessAuxiliaryCached(
      'ruleTypeDict',
      today.value,
      () => getSystemRuleTypeDict({}, getAwarenessSilentRequestConfig()),
      (ruleTypeSync) => uni.setStorageSync('ruleTypeDict', ruleTypeSync),
      AWARENESS_STRONG_AUXILIARY_CACHE_TTL_MS
    );
    const userInfo = uni.getStorageSync('userInfo');
    if (userInfo.sex == 1) {
      const forceGirlHealthRefresh = consumeGirlHealthProfileUpdatedFlag();
      const localHasPeriodProfile = hasLocalGirlHealthProfileFlag(userInfo);
      const girlHealthDate = periodTodayDate.value || formatLocalDate(today.value || new Date());
      const localGirlHealthProfile = readLocalGirlHealthProfile(userInfo);
      const localProfilePhaseSynced = syncHomePeriodCycle(localGirlHealthProfile, girlHealthDate);
      if (localProfilePhaseSynced) {
        showStartGirlCard.value = false;
        showPeriodDetail.value = true;
        if (!periodTip.value) {
          periodTip.value = getGirlHealthPhaseFallbackTip();
        }
      }
      if (
        claimAwarenessAuxiliaryRefresh(
          'girlHealthBundle',
          today.value,
          forceGirlHealthRefresh ? 0 : AWARENESS_AUXILIARY_REFRESH_TTL_MS
        )
      ) {
        void (async () => {
          const healthData = await requestAwarenessAuxiliary('girlHealth', today.value, () =>
            getGirlHealth({}, getAwarenessSilentRequestConfig())
          );
          writeLocalGirlHealthProfile(userInfo, healthData);
          let hasPeriodProfile =
            localHasPeriodProfile || Boolean(localGirlHealthProfile) || hasGirlHealthProfilePayload(healthData);
          const backendProfilePhaseSynced = syncHomePeriodCycle(healthData, girlHealthDate);
          let profilePhaseSynced = backendProfilePhaseSynced || localProfilePhaseSynced;
          let detailPhaseSynced = false;
          let detailAdvice = '';

          const detailData = await requestAwarenessAuxiliary('userGirlHealthAll', today.value, () =>
            getUserGirlHealthAll({ date: girlHealthDate }, getAwarenessSilentRequestConfig())
          );
          hasPeriodProfile = hasPeriodProfile || hasGirlHealthProfilePayload(detailData);
          if (detailData != null && detailData != '') {
            detailPhaseSynced = syncHomePeriodCycle(detailData, girlHealthDate);
            profilePhaseSynced = profilePhaseSynced || detailPhaseSynced;
            detailAdvice = extractGirlHealthAdvice(detailData);
            periodTip.value = detailAdvice || getGirlHealthPhaseFallbackTip();
          }
          if (profilePhaseSynced && !detailAdvice) {
            periodTip.value = extractGirlHealthAdvice(healthData) || getGirlHealthPhaseFallbackTip();
          }
          if (profilePhaseSynced) {
            showStartGirlCard.value = false;
            showPeriodDetail.value = true;
            if (!periodTip.value) {
              periodTip.value = extractGirlHealthAdvice(healthData) || detailAdvice || getGirlHealthPhaseFallbackTip();
            }
          } else {
            showStartGirlCard.value = true;
            showPeriodDetail.value = false;
          }
          appendAwarenessDiagnosticLog('girl-health-home-module-state', {
            date: girlHealthDate,
            forced: forceGirlHealthRefresh,
            localHasPeriodProfile,
            localProfilePhaseSynced,
            backendProfilePhaseSynced,
            hasPeriodProfile,
            profilePhaseSynced,
            detailPhaseSynced,
            currentPhaseIndex: currentPhaseIndex.value,
            showStartGirlCard: showStartGirlCard.value,
            showPeriodDetail: showPeriodDetail.value
          });
        })().catch((error) => {
          appendAwarenessDiagnosticLog('girl-health-background-load-failed', {
            error: formatBleErrorMessage(error, 'girl health background load failed')
          });
        });
      }
    }


    yesterdayInfo.value = getDateInfo(yesterday.value);
    beforeYesterdayInfo.value = getDateInfo(beforeYesterday.value);
    // await connectReload();
    userStore.fetchUserInfo();
    pullDownProgress.value = 30;

    const isRwHomeRing = isAwarenessRwRing();
    const canStartHomeSync = hasAwarenessCommunicationReady();
    if (isRwHomeRing && canStartHomeSync) {
      void syncRwHomeHistoryAndRefreshOverview(getSelectedDetailDate(), 'page-show');
    } else if (!isRwHomeRing && canStartHomeSync) {
      if (claimAwarenessHomeSyncSession('legacy-page-show')) {
        appendAwarenessDiagnosticLog('legacy-home-page-show-sync-started', {
          snapshot: getAwarenessConnectionSnapshot()
        });
        void executeCommandsSequentially()
          .then(() => {
            appendAwarenessDiagnosticLog('legacy-home-page-show-sync-result', {
              reason: 'overview-refresh-deferred-to-upload-result',
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
    // 后台异步加载数据和图表，不阻塞页面首次渲染；同步中会自动排队到上传/解析完成后刷新一次。
    void refreshPageDataAndCharts({ trigger: 'page-show-data-load' });
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
      await refreshAwarenessBusinessOverview(formatLocalDate(new Date()), { trigger: 'pull-down-legacy' });
      appendAwarenessDiagnosticLog('legacy-home-pull-down-sync-result', {
        snapshot: getAwarenessConnectionSnapshot()
      });
      pullDownProgress.value = 100;
      return;
    }
    await refreshAwarenessBusinessOverview(formatLocalDate(new Date()), { trigger: 'pull-down' });
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
        @tap="openHomeDetail('sleep')"
      >
        <view class="module-header flex jc-between ai-center mb-30">
          <view class="module-icon-title flex ai-center jc-between">
            <uv-image src="/static/images/icon01.png" width="56rpx" height="56rpx" observe-lazy-load></uv-image>
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
        @tap="openHomeDetail('exercise')"
      >
        <view class="module-header flex jc-between ai-center mb-30">
          <view class="module-icon-title flex ai-center">
            <uv-image src="/static/images/icon09.png" width="56rpx" height="56rpx" observe-lazy-load></uv-image>

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
              <uv-image src="/static/images/icon08.png" width="36rpx" height="36rpx" observe-lazy-load></uv-image>
              <view class="activity-text ml-10">
                <text class="activity-value fs-36">{{ activityStepValue }}</text>
                <text class="activity-goal t-979797 fs-24">/{{ activityTargetStep }}步</text>
              </view>
            </view>
            <view class="activity-item flex ai-center mb-10">
              <uv-image src="/static/images/icon10.png" width="36rpx" height="36rpx" observe-lazy-load></uv-image>
              <view class="activity-text ml-10">
                <text class="activity-value fs-36">{{ activityCalorieValue }}</text>
                <text class="activity-goal t-979797 fs-24">/{{ activityTargetCalorie }}{{ activityCalorieUnit }}</text>
              </view>
            </view>
            <view class="activity-item flex ai-center mb-10">
              <uv-image src="/static/images/icon02.png" width="36rpx" height="36rpx" observe-lazy-load></uv-image>
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
        @tap="openHomeDetail('relax')"
      >
        <view class="module-header flex jc-between ai-center mb-30">
          <view class="module-icon-title flex ai-center">
            <uv-image src="/static/images/icon04.png" width="56rpx" height="56rpx" observe-lazy-load></uv-image>
            <view class="module-title ml-10 fs-36">
              压力
              <DetailInfo id="stress" v-model:isPopupActive="isPopupActive"></DetailInfo>
            </view>
          </view>
          <view class="module-action flex ai-center">
            <!-- <view class="module-action flex ai-center"> -->
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
        @tap="openHomeDetail('vitalSigns')"
      >
        <view class="module-header flex jc-between ai-center mb-30">
          <!-- <view class="module-header flex jc-between ai-center mb-30"> -->
          <view class="module-icon-title flex ai-center">
            <uv-image src="/static/images/icon03.png" width="56rpx" height="56rpx" observe-lazy-load></uv-image>
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
              <uv-image src="/static/images/icon06.png" width="36rpx" height="36rpx" observe-lazy-load></uv-image>
              <view class="vital-text ml-10">
                <text class="vital-value fs-36">{{ displayHeartRateValue }}</text>
                <text class="vital-unit t-979797">次/分钟</text>
              </view>
            </view>
            <view class="vital-item flex ai-center mb-10">
              <uv-image src="/static/images/icon07.png" width="36rpx" height="36rpx" observe-lazy-load></uv-image>
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
            <view class="period-btn flex ai-center" @tap.stop="openPeriodPage('/homeDetail/periodQuestionnaire/periodQuestionnaire')">
              <text class="fs-28 t-white">去开启</text>
            </view>
          </view>
          <!-- 右侧圆形图片 -->
          <view class="period-icon-wrap">
            <uv-image src="/static/images/homeDetail/girl.png" width="150rpx" height="150rpx" mode="aspectFit" observe-lazy-load></uv-image>
          </view>
        </view>
      </view>

      <!-- 生理期周期详情卡片（点击去开启后展开） -->
      <view v-if="showPeriodDetail" class="module-card period-detail-card bg-white p-40 mt-30 r-50" @tap="openPeriodPage('/homeDetail/periodDetail/periodDetail')">
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
          <text class="period-tip-text">{{ periodTip }}</text>
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

  .period-tip-text {
    margin-left: 10rpx;
    color: #667085;
    font-size: 24rpx;
    line-height: 1.6;
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
