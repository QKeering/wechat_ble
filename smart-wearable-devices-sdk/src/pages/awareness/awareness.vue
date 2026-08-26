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
  balanceScoreType,
  SyncData
} from '@/types/api/homeDetail';
import CustomSteps from '@/components/customSteps.vue';
import ProgressBar from '@/components/progressBar.vue';
import { finalizeDataSyncSummary, submitData, submitRingHistoryRawFrames, getRingHistoryCoverage } from '@/common/api/homeDetail';
import { buildRingRawHistoryFrames } from '@/api/ringDevice';
import { bind, unbind, getBindInfo } from '@/common/api/device';
import { getGoalInfo } from '@/common/api/user';
import DetailInfo from '@/components/DetailInfo.vue';
import { usePopupFixer } from '@/hooks/usePopupFixer';
import { formatBleErrorMessage } from '@/utils/bleError';
import { normalizeHealthText } from '@/utils/healthText';
import { getStressLevelNumber, getStressScoreNumber, resolveStressDisplayStatus } from '@/utils/stressDisplay';
import { clearFrontendRingBindingState, getBoundRingIdentity, hasBoundRingIdentity } from '@/utils/ringBinding';
import { hasAnyRingCommunicationReady, hasRingCommunicationReady, isRingConnectionActive, isRingConnectionConnecting } from '@/utils/ringConnectionStatus';
import { useRingBusinessHistoryPageSync } from '@/composables/useRingBusinessHistoryPageSync';
import { useUnifiedBatteryDisplay } from '@/composables/useUnifiedBatteryDisplay';
import { appendRingDiagnosticLog, RW_DIAGNOSTIC_BUILD_TAG } from '@/composables/useRwForegroundMeasurement';
import { MOTION_CALORIE_DISPLAY_UNIT, normalizeMotionCalorieKcal } from '@/utils/motionCalorie';
import { formatBatteryStatusForDisplay, getRawBatteryPercent, isBatteryChargingLike } from '@/utils/batteryDisplay';
import { readBatteryDisplayCache, writeBatteryDisplayCache } from '@/utils/batteryCache';
import { reportRealBatteryLog } from '@/utils/deviceBatteryLog';
import { setRwDiagnosticBusinessUploadActive } from '@/utils/rwDiagnosticUpload';
import { getAppForegroundSessionId } from '@/utils/appForegroundSession';
import {
  acknowledgePendingUploadBatchDeferred,
  assertBackendUploadBinding,
  buildUploadSyncMeta,
  createUploadSessionId,
  listPendingUploadSessions,
  markPendingUploadDataDoneDeferred,
  markPendingUploadDataFailedDeferred,
  stagePendingUploadSession,
  stagePendingUploadSessionDeferred,
  uploadPendingRawFramesInBackground
} from '@/utils/dataUploadCompensation';
import {
  getDeviceHistoryBackendAckCheckpoint,
  getDeviceHistoryDurableCheckpoint,
  getDeviceHistoryEmptyReadCheckpoint,
  getDeviceHistoryCheckpointMeta,
  getDeviceHistoryReadCheckpoint,
  normalizeHistoryCheckpointDeviceMac,
  setDeviceHistoryBackendAckCheckpoint,
  setDeviceHistoryBackendAckCheckpointAsync,
  setDeviceHistoryDurableCheckpoint,
  setDeviceHistoryEmptyReadCheckpoint,
  setDeviceHistoryReadCompletedAt,
  setDeviceHistoryReadCheckpoint,
} from '@/utils/deviceHistoryCheckpoint';
import {
  decideDeviceSync,
  DEVICE_SYNC_AUTO_COOLDOWN_MS,
  DEVICE_SYNC_SLEEP_OVERLAP_SECONDS
} from '@/utils/deviceSyncPlanner';
import {
  buildDeviceSyncGateSnapshot,
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
  markUploadedRingHistorySubmitRecordsForDeviceAsync
} from '@/composables/useRingHistoryUpload';
import { getLegacyBleHistoryExclusiveSnapshot, resolveRingProtocol, type RwHistoryDataName } from '@/sdk/ring-ble';
// import AiLab from './aiLab.vue'

const { isPopupActive, fixedPageStyle } = usePopupFixer();

const echarts = require('../../static/echarts.min.js');

const userStore = useUserStore();
const ringStore = useRingStore();
const unifiedBattery = useUnifiedBatteryDisplay(userStore, ringStore);
const {
  initBluetooth,
  autoConnectLastDevice,
  isDeviceConnected,
  refreshHealthData,
  readLocalData,
  cancelReadLocalData,
  deviceInfo: ringBleDeviceInfo,
  ensureCommunicationReady,
  readBattery,
  updateDeviceTime
} = useRingBLE();
const ringBusinessBridge = useRingBusinessHistoryPageSync();
const RW_HOME_HISTORY_SYNC_TIMEOUT_MS = 5000;
const LEGACY_HOME_DEVICE_INFO_TIMEOUT_MS = 3000;
const LEGACY_HOME_DEVICE_INFO_BEFORE_HISTORY_TIMEOUT_MS = 2500;
const RW_HOME_DEVICE_INFO_BEFORE_HISTORY_TIMEOUT_MS = 8000;
const LEGACY_HOME_DEVICE_INFO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const LEGACY_HOME_HISTORY_SYNC_TIMEOUT_MS = 30000;
const LEGACY_HOME_HISTORY_BACKGROUND_TIMEOUT_MS = 30000;
const LEGACY_HOME_EMPTY_HISTORY_FALLBACK_TIMEOUT_MS = 5000;
// This is the first-frame budget. Once frames arrive the adapter keeps the
// stream alive with its activity timeout, so large histories are not cut off.
const LEGACY_HOME_EMPTY_HISTORY_FULL_FALLBACK_TIMEOUT_MS = 6000;
const LEGACY_HOME_EMPTY_HISTORY_FULL_FALLBACK_SETTLE_MS = 400;
const LEGACY_HOME_HISTORY_READ_WATCHDOG_EXTRA_MS = 5000;
// 辅助业务（如女性健康）不能因为 BLE 后台同步让页面保持 1~2 秒的“未完成”状态。
// 这里只做一次极短让步；仍在同步时由请求自身缓存/超时策略处理，不阻塞用户交互。
const AWARENESS_AUXILIARY_SYNC_IDLE_INITIAL_DELAY_MS = 100;
const AWARENESS_AUXILIARY_SYNC_IDLE_POLL_MS = 100;
const AWARENESS_AUXILIARY_SYNC_IDLE_MAX_WAIT_MS = 400;
const AWARENESS_FOREGROUND_SYNC_BUDGET_MS = 12000;
// 0x36 终帧到达后给 Notify/Store 回调一个很短的落稳窗口，再只构建一次
// 后台上传快照。该等待不占用前台“同步中”状态。
const LEGACY_HOME_HISTORY_TERMINAL_UPLOAD_SETTLE_MS = 300;
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
const sleepOverviewConfirmedDate = ref('');
let sleepOverviewRequestSeq = 0;
const sleepOverviewDateCache = new Map<string, sleepOverview>();
const SLEEP_OVERVIEW_DATE_CACHE_LIMIT = 7;
const rememberSleepOverviewForDate = (date: string, overview: sleepOverview) => {
  sleepOverviewDateCache.delete(date);
  sleepOverviewDateCache.set(date, overview);
  while (sleepOverviewDateCache.size > SLEEP_OVERVIEW_DATE_CACHE_LIMIT) {
    const oldestDate = sleepOverviewDateCache.keys().next().value;
    if (!oldestDate) break;
    sleepOverviewDateCache.delete(oldestDate);
  }
};
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
let awarenessHomeSyncDispatchPromise: Promise<boolean> | null = null;
let lastAwarenessHomeSyncDispatchKey = '';
let lastAwarenessHomeSyncDispatchAt = 0;
const AWARENESS_HOME_SYNC_TRIGGER_COALESCE_MS = 3000;
let awarenessHistorySyncPromise: Promise<void> | null = null;
let legacyLocalDataUploadPromise: Promise<unknown> | null = null;
let pendingParsedUploadRetryPromise: Promise<void> | null = null;
let pendingParsedUploadRetryTimer: ReturnType<typeof setTimeout> | null = null;
let pendingParsedUploadRetryLastAt = 0;
const pendingParsedSummaryFinalizeTasks = new Map<string, Promise<void>>();
let legacyLocalDataStablePromise: Promise<void> | null = null;
let legacyLocalDataStableWaitGeneration = 0;
let legacyLocalDataStableUploadScheduled = false;
let legacyLocalDataStableReadyAt = 0;
let legacyLocalDataStableWaitStartedAt = 0;
let legacyLocalDataUploadWatcherActive = false;
let legacyLocalDataUploadWatcherActiveAt = 0;
let legacyLocalDataUploadWatcherPending = false;
let legacyLocalDataActiveHistoryDeferredLogAt = 0;
let legacyLocalDataIncompleteFlushTimer: ReturnType<typeof setTimeout> | null = null;
let legacyLocalDataIncompleteFlushKey = '';
let legacyLocalDataIncompleteFlushScheduledAt = 0;
let legacyLocalDataCompletedFastPathKey = '';
let legacyLocalDataCompletedFastPathRequestedAt = 0;
let legacyLocalDataTimeoutFlushDeviceMacNorm = '';
let legacyLocalDataTimeoutFlushKey = '';
let legacyLocalDataTimeoutFlushRequestedAt = 0;
let legacyLocalDataTimeoutFlushTrigger = '';
let legacyLocalDataHttpRetryWindow: {
  deviceMacNorm: string;
  sinceTimestamp: number;
  createdAt: number;
} | null = null;
let legacyLocalDataActiveHistoryFlushKey = '';
let legacyLocalDataActiveHistoryFlushRequestedAt = 0;
let awarenessBusinessRefreshPromise: Promise<void> | null = null;
let awarenessBusinessChartRefreshPromise: Promise<void> | null = null;
let awarenessProcessedRefreshPromise: Promise<void> | null = null;
let runningAwarenessProcessedRefreshKey = '';
let pendingAwarenessProcessedRefresh:
  | {
      reason: string;
      date: string;
      finalRefreshKey: string;
    }
  | null = null;
let awarenessPageGeneration = 0;
let awarenessSoftTimeoutSequence = 0;
type AwarenessSoftTimeoutEntry = {
  id: number;
  key: string;
  startedAt: number;
  deadlineAt: number;
  pageGeneration: number;
  pageBound: boolean;
  expire: (reason: string) => void;
};
const awarenessActiveSoftTimeouts = new Map<number, AwarenessSoftTimeoutEntry>();
let legacyHomeDeviceInfoRefreshPromise: Promise<void> | null = null;
let legacyHomeDeviceInfoRefreshPendingRetry: {
  protocol: string;
  hasCachedSnapshot: boolean;
  reason: string;
  skipReason: string;
  freshBatteryBarrierId?: number;
  batteryOnly?: boolean;
} | null = null;
let legacyHomeDeviceInfoRetryDeferredTimer: ReturnType<typeof setTimeout> | null = null;
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
let legacyHomeHistoryReadHasUploadableRecords = false;
let legacyHomeHistoryUploadDispatchKey = '';
let legacyHomeHistoryUploadDispatchAt = 0;
// Keep the history session atomic while ownership moves from BLE reading to HTTP upload.
// Without this handoff flag, page-show can start a second read in the short interval
// after the read state is reset but before the upload watcher/promise is installed.
let legacyHomeHistoryUploadHandoffPending = false;
let lastAwarenessRefreshAt = 0;
let lastAwarenessHistorySyncAt = 0;
const awarenessDeviceTimeSyncAtByIdentity = new Map<string, number>();
let lastAwarenessHomeUploadSessionKey = '';
let activeAwarenessHomeSyncClaim: DeviceSyncSessionClaim | null = null;
let lastLegacyLocalDataUploadKey = '';
let lastLegacyLocalDataUploadAt = 0;
let lastAwarenessProcessedRefreshAt = 0;
let lastAwarenessFinalRefreshKey = '';
let lastAwarenessFinalRefreshAt = 0;
let lastAwarenessBusinessRefreshDate = '';
let lastAwarenessBusinessRefreshAt = 0;
let lastAwarenessPageShowRefreshKey = '';
let lastAwarenessPageShowRefreshAt = 0;
const awarenessAuxiliaryRefreshAt = new Map<string, number>();
const awarenessStressInfoRefreshAt = new Map<string, number>();
const awarenessHomeSyncCompletedAt = new Map<string, number>();
const isLegacyLocalDataUploadWorkActive = () =>
  Boolean(
    legacyHomeHistoryUploadHandoffPending ||
      legacyLocalDataUploadPromise ||
      legacyLocalDataStablePromise ||
      legacyLocalDataStableUploadScheduled ||
      legacyLocalDataUploadWatcherActive ||
      legacyLocalDataUploadWatcherPending
  );
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
type LegacySleepCacheParkState = { firstAt: number; lastAt: number; count: number };
type LegacySleepCacheParkDecision = {
  key: string;
  keep: boolean;
  reason: string;
  count: number;
  elapsedMs: number;
  firstAt: number;
  lastAt: number;
  submittedSleepCount: number;
  responseSleepAcceptedCount?: number;
};
const legacySleepNotIngestedParkStates = new Map<string, LegacySleepCacheParkState>();
const RW_AWARENESS_REFRESH_DEDUP_MS = 8000;
const AWARENESS_HOME_SYNC_COOLDOWN_MS = DEVICE_SYNC_AUTO_COOLDOWN_MS;
const RW_AWARENESS_HISTORY_DEDUP_MS = AWARENESS_HOME_SYNC_COOLDOWN_MS;
const RW_AWARENESS_DEVICE_TIME_SYNC_DEDUP_MS = 10 * 60 * 1000;
const RW_AWARENESS_DEVICE_TIME_SYNC_STALE_MS = 6 * 60 * 60 * 1000;
// A successful calibration remains valid for the normal six-hour window. History reads
// must not force another write/read cycle every two minutes; crossing a local date still
// bypasses this window in syncRwHomeDeviceTimeBeforeHistory.
const RW_AWARENESS_DEVICE_TIME_SYNC_HISTORY_STALE_MS = RW_AWARENESS_DEVICE_TIME_SYNC_STALE_MS;
const LEGACY_LOCAL_DATA_UPLOAD_DEDUP_MS = 60 * 1000;
const LEGACY_LOCAL_SLEEP_CACHE_PARK_MAX_MS = 6 * 60 * 60 * 1000;
const LEGACY_LOCAL_SLEEP_CACHE_PARK_MAX_COUNT = 6;
const LEGACY_LOCAL_DATA_CLOSED_SESSION_TTL_MS = 30 * 60 * 1000;
const LEGACY_LOCAL_DATA_UPLOAD_SIGNATURE_TTL_MS = LEGACY_LOCAL_DATA_CLOSED_SESSION_TTL_MS;
const AWARENESS_BACKEND_BINDING_CACHE_MS = 15000;
const LEGACY_LOCAL_DATA_STABLE_WAIT_MS = 250;
const LEGACY_LOCAL_DATA_STABLE_POLL_MS = 100;
const LEGACY_LOCAL_DATA_STABLE_TIMEOUT_MS = 800;
const LEGACY_LOCAL_DATA_STABLE_READY_TTL_MS = 5000;
const LEGACY_LOCAL_DATA_STABLE_BLOCK_STALE_MS = 10000;
const LEGACY_LOCAL_DATA_UPLOAD_WATCHER_STALE_MS = 15000;
const LEGACY_HOME_HISTORY_UPLOAD_SOFT_WAIT_MS = 3000;
const LEGACY_HOME_HISTORY_UPLOAD_EARLY_FLUSH_ENABLED = true;
const LEGACY_HOME_HISTORY_UPLOAD_EARLY_FLUSH_MIN_MS = 3000;
const LEGACY_HOME_HISTORY_UPLOAD_EARLY_FLUSH_MIN_RECORDS = 30;
const LEGACY_HOME_HISTORY_ACTIVE_FLUSH_DEDUP_MS = 10000;
const LEGACY_LOCAL_DATA_TIMEOUT_FLUSH_TTL_MS = 30000;
const LEGACY_LOCAL_DATA_TIMEOUT_FLUSH_DEDUP_MS = 30000;
const LEGACY_HOME_HISTORY_UPLOAD_DISPATCH_DEDUP_MS = 30000;
// HTTP 历史上传不能无限占用首页同步会话。超时后保留原批次读取窗口，
// 仅重试 HTTP，不重新读取 BLE，也不推进 checkpoint。
const LEGACY_LOCAL_DATA_SUBMIT_TIMEOUT_MS = 15000;
const LEGACY_LOCAL_DATA_SUBMIT_WATCHDOG_MS = LEGACY_LOCAL_DATA_SUBMIT_TIMEOUT_MS + 5000;
const LEGACY_LOCAL_DATA_HTTP_RETRY_WINDOW_TTL_MS = 10 * 60 * 1000;
// 页面“同步中”由独立的 12s 体验预算收口；HTTP 泵继续在后台串行推进。
// 这里只限制一次前台提交链路的网络占用，超时后仍走 HTTP-only 补偿，不重读 BLE。
const LEGACY_LOCAL_DATA_SUBMIT_FOREGROUND_BUDGET_MS = LEGACY_LOCAL_DATA_SUBMIT_TIMEOUT_MS;
// 大批次会让单次 /app/data/sync 超过前台预算，超时后虽会转 HTTP-only 补偿，
// 但首批无法及时确认，页面仍会表现为长时间“同步中”。小批提交可让已成功数据
// 立即落库并推进 checkpoint，剩余数据再由现有补偿机制续传，不触发 BLE 重读。
const LEGACY_LOCAL_DATA_SUBMIT_BATCH_SIZE = 50;
const LEGACY_RAW_FRAME_BACKGROUND_UPLOAD_DELAY_MS = 3000;
const LEGACY_HISTORY_READ_CHECKPOINT_OVERLAP_SECONDS = DEVICE_SYNC_SLEEP_OVERLAP_SECONDS;
const LEGACY_HOME_HISTORY_LONG_RETRY_TIMEOUT_MS = 30000;
const LEGACY_HOME_HISTORY_LONG_RETRY_DELAY_MS = 800;
const LEGACY_HOME_HISTORY_LONG_RETRY_DEDUP_MS = 10 * 60 * 1000;
const LEGACY_HOME_HISTORY_PARTIAL_CONTINUE_MAX_ROUNDS = 30;
const LEGACY_HOME_HISTORY_READ_RETRY_DEDUP_MS = 5 * 60 * 1000;
const LEGACY_HOME_HISTORY_READ_SCOPE_DEDUP_MS = 5 * 60 * 1000;
const LEGACY_HOME_HISTORY_READ_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
// A disconnected/not-ready read must be allowed to retry shortly after the
// global connection owner restores the transport. Successful reads still use
// the normal five-minute dedup window above.
const LEGACY_HOME_HISTORY_READ_COMMUNICATION_FAILURE_COOLDOWN_MS = 10 * 1000;
const LEGACY_HOME_HISTORY_READ_RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
const LEGACY_HOME_CLOUD_COVERAGE_FRESH_MS = 10 * 60 * 1000;
const LEGACY_HOME_CLOUD_COVERAGE_TIMEOUT_MS = 1200;
const AWARENESS_PROCESSED_REFRESH_DEDUP_MS = 3000;
const AWARENESS_FINAL_REFRESH_DEDUP_MS = 15000;
const AWARENESS_BUSINESS_REFRESH_QUEUE_DEDUP_MS = 5000;
const AWARENESS_PAGE_SHOW_REFRESH_DEDUP_MS = 5 * 60 * 1000;
const AWARENESS_AUXILIARY_REFRESH_TTL_MS = 5 * 60 * 1000;
const AWARENESS_STRONG_AUXILIARY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const AWARENESS_GIRL_HEALTH_BACKGROUND_DELAY_MS = 3000;
const GIRL_HEALTH_PROFILE_UPDATED_STORAGE_KEY = 'qkeer_girl_health_profile_updated_at';
const POST_BINDING_REFRESH_STORAGE_KEY = 'qkeer_post_binding_refresh_at';
const POST_BINDING_REFRESH_MAX_AGE_MS = 2 * 60 * 1000;
const GIRL_HEALTH_PROFILE_EXISTS_STORAGE_KEY_PREFIX = 'qkeer_girl_health_profile_exists';
const GIRL_HEALTH_PROFILE_STORAGE_KEY_PREFIX = 'qkeer_girl_health_profile';
const AWARENESS_BUSINESS_REQUEST_SOFT_TIMEOUT_MS = 8000;
const AWARENESS_STRESS_REQUEST_SOFT_TIMEOUT_MS = 6000;
const AWARENESS_STRESS_INFO_REFRESH_TTL_MS = 60 * 1000;
const AWARENESS_AUXILIARY_REQUEST_SOFT_TIMEOUT_MS = 5000;
const AWARENESS_BUSINESS_STAGE_SOFT_TIMEOUT_MS = 10000;
const LEGACY_HOME_LONG_RETRY_SUPPRESS_AFTER_FLUSH_MS = 60 * 1000;
const LEGACY_LOCAL_DATA_TERMINAL_SKIP_REASONS = new Set([
  'checkpoint-covered',
  'all-submit-records-already-uploaded',
  'upload-session-closed',
  'same-signature-uploaded',
  'all-payloads-device-mismatch',
  'missing-device-mac'
]);
const LEGACY_LOCAL_DATA_SILENT_TERMINAL_SKIP_REASONS = new Set([
  'upload-session-closed',
  'same-signature-uploaded'
]);
const LEGACY_LOCAL_DATA_SKIP_WITHOUT_HISTORY_COMPLETE_REASONS = new Set([
  'checkpoint-covered',
  'all-payloads-device-mismatch',
  'missing-device-mac'
]);
const LEGACY_DEFAULT_SLEEP_WINDOW_START_HOUR = 21;
const legacyHomeHistoryReadAttemptAt = new Map<string, number>();
const legacyHomeHistoryReadCompletedAt = new Map<string, number>();
const legacyHomeHistoryReadFetchedAt = new Map<string, number>();
const legacyHomeHistoryReadFailedAt = new Map<string, number>();
const legacyHomeHistoryReadFailedReason = new Map<string, string>();
// A failed read with no usable frame is latched to the physical connection
// generation that produced it. Page-show/ready callbacks in the same BLE
// connection must not restart 0x36; only a real reconnect may try again.
const legacyHomeHistoryReadFailedGeneration = new Map<string, number>();
let awarenessPhysicalConnectionGeneration = 1;
const legacyHomeHistoryLongRetryAttemptAt = new Map<string, number>();
const legacyHomeHistoryPartialContinueAttempts = new Map<string, number>();
const legacyHomeHistoryReadTerminalByDevice = new Map<
  string,
  {
    completed: boolean;
    parsedComplete: boolean;
    status: string;
    recordCount: number;
    maxTimestamp: number;
    updatedAt: number;
    reason: string;
  }
>();
const legacyHomeHistoryReadRecordsByDevice = new Map<
  string,
  {
    records: Array<Record<string, any>>;
    maxTimestamp: number;
    updatedAt: number;
    reason: string;
  }
>();
type LegacyHomeCloudCoverageSnapshot = {
  deviceMac: string;
  date: string;
  recordCount: number;
  latestTimestamp: number;
  coverageStatus: string;
  shouldSkipBle: boolean;
  updatedAt: number;
};
const legacyHomeCloudCoverageByScope = new Map<string, LegacyHomeCloudCoverageSnapshot>();
let legacyHomeHistoryPartialContinuationPending = false;
const buildParsedDataUploadSyncMeta = (session: any) => {
  const meta = { ...(buildUploadSyncMeta(session) as Record<string, any>) };
  // /app/data/sync 只提交解析后的 dataList。原始帧由 rawHistory/enqueue 单独补偿入库；
  // 两边都带 rawFrames 会放大请求体，导致前端等待很久甚至没有 submit result。
  delete meta.rawFrames;
  // This client always calls /data/sync/summary/finalize after every parsed
  // batch has been acknowledged. Ask /data/sync not to launch a competing
  // background summary for the final batch.
  meta.deferSummaryFinalize = true;
  meta.uploadStatus = {
    ...(meta.uploadStatus || {}),
    deferSummaryFinalize: true
  };
  return meta;
};
const buildParsedDataUploadBatchSyncMeta = (
  session: any,
  batchIndex: number,
  batchCount: number
) => {
  const meta = buildParsedDataUploadSyncMeta(session);
  const isFinalBatch = batchCount > 0 && batchIndex === batchCount - 1;
  if (isFinalBatch) return meta;

  // A durable upload session can contain multiple HTTP batches. Intermediate
  // batches are not a complete device history window: declaring them complete
  // makes the backend recalculate summaries and exposes transient sleep data.
  meta.deviceReadDone = false;
  meta.historyCompleted = false;
  meta.partialUpload = true;
  meta.coverageStatus = 'partial';
  meta.canDeleteDeviceBlocks = false;
  meta.uploadStatus = {
    ...(meta.uploadStatus || {}),
    deviceReadDone: false,
    historyCompleted: false,
    partialUpload: true,
    coverageStatus: 'partial'
  };
  return meta;
};
const chunkLegacySubmitData = <T,>(items: T[], size: number): T[][] => {
  const chunkSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};
const hashUploadBatchContent = (items: unknown[]) => {
  const source = JSON.stringify(items);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const buildUploadBatchId = (uploadSessionId: string, deviceMac: string, batchIndex: number, batch: SyncData[]) => {
  const timestamps = batch.map((item) => getRingHistoryRecordUnixTime(item) || 0).filter(Boolean);
  const fromTimestamp = timestamps.length ? Math.min(...timestamps) : 0;
  const toTimestamp = timestamps.length ? Math.max(...timestamps) : 0;
  const normalizedDeviceMac = normalizeDeviceSyncMac(deviceMac) || 'unknown';
  return `${normalizedDeviceMac}:${uploadSessionId}:${batchIndex + 1}:${fromTimestamp}-${toTimestamp}:${hashUploadBatchContent(batch)}`;
};
let legacyUploadPostAckBookkeepingChain: Promise<void> = Promise.resolve();
const scheduleLegacyUploadPostAckBookkeeping = (
  uploadSessionId: string,
  deviceMac: string,
  protocol: string,
  batchIndex: number,
  batchCount: number,
  batch: SyncData[],
  acceptedThrough: number
) => {
  const scheduledAt = Date.now();
  const task = legacyUploadPostAckBookkeepingChain
    .catch(() => undefined)
    .then(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const startedAt = Date.now();
      try {
        const uploadedRecordKeyCount = await markUploadedRingHistorySubmitRecordsForDeviceAsync(deviceMac, batch);
        if (acceptedThrough > 0) {
          await setDeviceHistoryBackendAckCheckpointAsync(deviceMac, protocol || 'legacy', acceptedThrough);
        }
        appendAwarenessDiagnosticLog('upload-http-batch-post-ack-bookkeeping-result', {
          uploadSessionId,
          deviceMac,
          protocol,
          batchIndex,
          batchCount,
          batchSize: batch.length,
          acceptedThrough,
          uploadedRecordKeyCount,
          schedulingDelayMs: startedAt - scheduledAt,
          elapsedMs: Date.now() - startedAt
        });
        return uploadedRecordKeyCount;
      } catch (error) {
        appendAwarenessDiagnosticLog('upload-http-batch-post-ack-bookkeeping-failed', {
          uploadSessionId,
          deviceMac,
          protocol,
          batchIndex,
          batchCount,
          batchSize: batch.length,
          acceptedThrough,
          schedulingDelayMs: startedAt - scheduledAt,
          elapsedMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error || '')
        });
        return 0;
      }
    });
  legacyUploadPostAckBookkeepingChain = task.then(() => undefined).catch(() => undefined);
  return task;
};
const hasAwarenessCommunicationReady = () =>
  hasAnyRingCommunicationReady(ringBleDeviceInfo.value, userStore.deviceInfo, ringStore.deviceInfo);
// Persisted store snapshots may survive a page/process restart. Only the active
// SDK runtime proves that this page can write commands and receive Notify data.
const hasAwarenessRuntimeCommunicationReady = () =>
  hasRingCommunicationReady(ringBleDeviceInfo.value);
const awarenessPageActive = ref(false);
const awarenessRuntimeConnectionPending = ref(false);
const awarenessCommunicationReadySignal = computed(() => hasAwarenessRuntimeCommunicationReady());
let awarenessInitialOverviewGate: Promise<void> = Promise.resolve();
let releaseAwarenessInitialOverviewGate: (() => void) | null = null;
let awarenessInitialOverviewGateSeq = 0;
const beginAwarenessInitialOverviewGate = (trigger: string) => {
  releaseAwarenessInitialOverviewGate?.();
  const seq = ++awarenessInitialOverviewGateSeq;
  awarenessInitialOverviewGate = new Promise<void>((resolve) => {
    releaseAwarenessInitialOverviewGate = () => {
      if (seq !== awarenessInitialOverviewGateSeq) return;
      releaseAwarenessInitialOverviewGate = null;
      resolve();
      appendAwarenessDiagnosticLog('initial-overview-gate-released', {
        trigger,
        seq,
        snapshot: getAwarenessConnectionSnapshot()
      });
    };
  });
  appendAwarenessDiagnosticLog('initial-overview-gate-start', {
    trigger,
    seq,
    snapshot: getAwarenessConnectionSnapshot()
  });
  return { seq, promise: awarenessInitialOverviewGate };
};
const waitForAwarenessInitialOverview = async (trigger: string) => {
  const startedAt = Date.now();
  await awarenessInitialOverviewGate;
  appendAwarenessDiagnosticLog('history-wait-initial-overview-result', {
    trigger,
    elapsedMs: Date.now() - startedAt,
    snapshot: getAwarenessConnectionSnapshot()
  });
};
const isAwarenessRwRing = () =>
  resolveRingProtocol(userStore.deviceInfo as any) === 'rw' ||
  resolveRingProtocol(ringStore.deviceInfo as any) === 'rw';
const isAwarenessL19HistoryDevice = () => {
  const sources = [
    userStore.deviceInfo,
    ringStore.deviceInfo,
    ringStore.boundDevice
  ] as Array<Record<string, any> | null | undefined>;
  return sources.some((source) => {
    if (!source) return false;
    return [source.name, source.deviceName, source.model, source.modelKey, source.productName]
      .map((value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .some((value) => value.includes('QKEERINGL19') || value.includes('QKL19'));
  });
};
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
  getAwarenessDeviceCanonicalMacFromSource(ringBleDeviceInfo.value as Record<string, any>) ||
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
  runtimeReady: hasAwarenessRuntimeCommunicationReady(),
  runtimeConnectionPending: awarenessRuntimeConnectionPending.value,
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
const getAwarenessDeviceTimeSyncIdentity = () => {
  const canonicalMac = normalizeHistoryCheckpointDeviceMac(getAwarenessCanonicalDeviceMac());
  if (canonicalMac) return canonicalMac;
  const snapshot = getAwarenessConnectionSnapshot();
  return String(
    snapshot.storeDevice.canonicalDeviceMac ||
      snapshot.userDevice.canonicalDeviceMac ||
      snapshot.storeDevice.deviceId ||
      snapshot.userDevice.deviceId ||
      'unknown-device'
  );
};
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
const rememberLegacyLocalDataHttpRetryWindow = (deviceMac: string, sinceTimestamp: number) => {
  const deviceMacNorm = normalizeHistoryCheckpointDeviceMac(deviceMac);
  if (!deviceMacNorm) return;
  legacyLocalDataHttpRetryWindow = {
    deviceMacNorm,
    sinceTimestamp: Math.max(0, Math.floor(Number(sinceTimestamp) || 0)),
    createdAt: Date.now()
  };
};
const getLegacyLocalDataHttpRetrySinceTimestamp = (deviceMac: string, fallbackTimestamp: number) => {
  const retryWindow = legacyLocalDataHttpRetryWindow;
  if (!retryWindow) return fallbackTimestamp;
  const deviceMacNorm = normalizeHistoryCheckpointDeviceMac(deviceMac);
  const expired = Date.now() - retryWindow.createdAt > LEGACY_LOCAL_DATA_HTTP_RETRY_WINDOW_TTL_MS;
  if (expired || !deviceMacNorm || retryWindow.deviceMacNorm !== deviceMacNorm) {
    legacyLocalDataHttpRetryWindow = null;
    return fallbackTimestamp;
  }
  return retryWindow.sinceTimestamp;
};
const clearLegacyLocalDataHttpRetryWindow = (deviceMac: string) => {
  const retryWindow = legacyLocalDataHttpRetryWindow;
  if (!retryWindow) return;
  const deviceMacNorm = normalizeHistoryCheckpointDeviceMac(deviceMac);
  if (!deviceMacNorm || retryWindow.deviceMacNorm === deviceMacNorm) {
    legacyLocalDataHttpRetryWindow = null;
  }
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
  const girlHealthBundleKey = `${getAwarenessHomeUploadDeviceKey()}:girlHealthBundle:${formatLocalDate(new Date())}`;
  awarenessAuxiliaryRefreshAt.delete(girlHealthBundleKey);
  appendAwarenessDiagnosticLog('business-aux-cache-invalidated', {
    key: 'girlHealthBundle',
    trigger,
    cacheKey: girlHealthBundleKey
  });
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
const finishAwarenessHomeSyncWithoutHistoryCooldown = (trigger: string) => {
  appendAwarenessDiagnosticLog('home-sync-finished-without-history-cooldown', {
    trigger,
    reason: 'upload-ack-or-non-ble-terminal-must-not-mark-history-read-complete',
    snapshot: getAwarenessConnectionSnapshot()
  });
  releaseAwarenessHomeSyncSession(trigger, 'finished', false);
};
const completeAwarenessVisibleSyncAfterPartialHistory = (
  trigger: string,
  protocol: string,
  details: Record<string, unknown> = {}
) => {
  userStore.updateUploadingStatus('1');
  userStore.updateIsSending(true);
  homeDataSyncing.value = true;
  legacyHomeHistoryPartialContinuationPending = true;
  const fallbackSinceTimestamp = Number(
    (details?.fallbackSinceTimestamp as number | undefined) ||
      (details?.checkpointTimestampAfterUpload as number | undefined) ||
      0
  );
  const uploadFlushScheduled = requestOrScheduleLegacyLocalDataIncompleteFlush(trigger, protocol);
  const historyContinuationScheduled = scheduleLegacyHomeHistoryLongRetryAfterPartialUpload(trigger, protocol, {
    reason: trigger,
    deviceMac: String(details?.deviceMac || getAwarenessUploadDeviceMac() || ''),
    fallbackSinceTimestamp
  });
  appendAwarenessDiagnosticLog('legacy-home-history-partial-continuation-scheduled', {
    protocol,
    trigger,
    reason: 'partial-history-requires-continuation',
    uploadFlushScheduled,
    historyContinuationScheduled,
    fallbackSinceTimestamp,
    fallbackSinceText: formatUnixTimestampForLog(fallbackSinceTimestamp),
    ...details,
    snapshot: getAwarenessConnectionSnapshot()
  });
  setTimeout(() => {
    legacyHomeHistoryReadCompletedTick.value = Date.now();
  }, 120);
};
const claimAwarenessHomeSyncSession = (trigger: string, options: { force?: boolean } = {}) => {
  if (isAwarenessHomeSyncInCooldown(trigger, options)) {
    return false;
  }
  const uploadSessionKey = getAwarenessHomeUploadSessionKey();
  if (!options.force && lastAwarenessHomeUploadSessionKey === uploadSessionKey) {
    appendAwarenessDiagnosticLog('home-sync-session-skipped', {
      reason: activeAwarenessHomeSyncClaim
        ? 'same-app-foreground-session-running'
        : 'same-app-foreground-session-completed',
      trigger,
      uploadSessionKey,
      active: Boolean(activeAwarenessHomeSyncClaim),
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
    getAwarenessDeviceCanonicalMacFromSource(ringBleDeviceInfo.value as Record<string, any>) ||
      getAwarenessDeviceCanonicalMacFromSource(ringStore.deviceInfo as Record<string, any>) ||
      getAwarenessDeviceCanonicalMacFromSource(userStore.deviceInfo as Record<string, any>)
  );
const getAwarenessCurrentContextMac = () => getAwarenessLiveDeviceContextMac();
const getAwarenessHomeSyncContextState = (expected?: string) => {
  const activeMac = getAwarenessActiveHomeSyncMac();
  const expectedMac = normalizeDeviceSyncMac(expected || activeMac || getAwarenessHomeUploadDeviceKey());
  const currentMac = getAwarenessCurrentContextMac();
  return {
    activeMac,
    expectedMac,
    currentMac,
    mismatch: Boolean(expectedMac && currentMac && expectedMac !== currentMac)
  };
};
const validateAwarenessHomeSyncContext = (
  reason: string,
  options: {
    expectedMac?: string;
    requireActive?: boolean;
    requireReady?: boolean;
    allowMissingCurrent?: boolean;
  } = {}
) => {
  const { activeMac, expectedMac, currentMac, mismatch } = getAwarenessHomeSyncContextState(options.expectedMac);

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

  if (mismatch) {
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
const getAwarenessReadCheckpointTimestamp = () => {
  const deviceMac = getAwarenessCheckpointDeviceMac();
  const protocol = getAwarenessCheckpointProtocol();
  const timestamp = getDeviceHistoryReadCheckpoint(deviceMac, protocol);
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : 0;
};
const getAwarenessDurableCheckpointTimestamp = () => {
  const deviceMac = getAwarenessCheckpointDeviceMac();
  const protocol = getAwarenessCheckpointProtocol();
  const timestamp = getDeviceHistoryDurableCheckpoint(deviceMac, protocol);
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : 0;
};
const getAwarenessBackendAckCheckpointTimestamp = () => {
  const deviceMac = getAwarenessCheckpointDeviceMac();
  const protocol = getAwarenessCheckpointProtocol();
  const timestamp = getDeviceHistoryBackendAckCheckpoint(deviceMac, protocol);
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : 0;
};
const getAwarenessLastReadTimestamp = getAwarenessDurableCheckpointTimestamp;
const getAwarenessLastEmptyReadTimestamp = () => {
  const deviceMac = getAwarenessCheckpointDeviceMac();
  const protocol = getAwarenessCheckpointProtocol();
  const timestamp = getDeviceHistoryEmptyReadCheckpoint(deviceMac, protocol);
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
  // A payload can contain one stale nested record after reconnect/store merging.
  // Validate the payload envelope here and filter nested records individually
  // below, otherwise one stale record drops the whole valid BLE batch.
  return true;
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
const updateAwarenessDeviceHistoryCheckpointStage = (
  stage: 'read' | 'durable' | 'backend-ack',
  timestamp: number,
  reason: string
) => {
  const deviceMac = getAwarenessCheckpointDeviceMac();
  const protocol = getAwarenessCheckpointProtocol();
  const setter = stage === 'read'
    ? setDeviceHistoryReadCheckpoint
    : stage === 'durable'
      ? setDeviceHistoryDurableCheckpoint
      : setDeviceHistoryBackendAckCheckpoint;
  const savedTimestamp = setter(deviceMac, protocol, timestamp);
  if (savedTimestamp > 0) {
    appendAwarenessDiagnosticLog('device-history-checkpoint-stage-updated', {
      stage,
      reason,
      protocol,
      deviceMac,
      timestamp: savedTimestamp,
      timeText: formatUnixTimestampForLog(savedTimestamp),
      snapshot: getAwarenessConnectionSnapshot()
    });
  } else {
    appendAwarenessDiagnosticLog('device-history-checkpoint-stage-skip', {
      stage,
      reason,
      protocol,
      deviceMac,
      timestamp,
      timeText: formatUnixTimestampForLog(timestamp),
      message: 'missing-device-mac-or-invalid-timestamp',
      snapshot: getAwarenessConnectionSnapshot()
    });
  }
  if (savedTimestamp > 0) {
    userStore.updateLastReadTimestamp(
      Math.max(getAwarenessReadCheckpointTimestamp(), getAwarenessDurableCheckpointTimestamp())
    );
  }
};
const updateAwarenessDeviceHistoryReadCheckpoint = (timestamp: number, reason: string) =>
  updateAwarenessDeviceHistoryCheckpointStage('read', timestamp, reason);
const updateAwarenessDeviceHistoryDurableCheckpoint = (timestamp: number, reason: string) =>
  updateAwarenessDeviceHistoryCheckpointStage('durable', timestamp, reason);
const updateAwarenessDeviceHistoryBackendAckCheckpoint = (timestamp: number, reason: string) =>
  updateAwarenessDeviceHistoryCheckpointStage('backend-ack', timestamp, reason);
const updateAwarenessDeviceHistoryEmptyReadCheckpoint = (
  timestamp: number,
  reason: string,
  options: { deviceMac?: string; protocol?: string } = {}
) => {
  const deviceMac = options.deviceMac || getAwarenessCheckpointDeviceMac();
  const protocol = options.protocol || getAwarenessCheckpointProtocol();
  const savedTimestamp = setDeviceHistoryEmptyReadCheckpoint(deviceMac, protocol, timestamp);
  if (savedTimestamp > 0) {
    appendAwarenessDiagnosticLog('device-history-empty-read-checkpoint-updated', {
      reason,
      protocol,
      deviceMac,
      timestamp: savedTimestamp,
      timeText: formatUnixTimestampForLog(savedTimestamp),
      snapshot: getAwarenessConnectionSnapshot()
    });
  } else {
    appendAwarenessDiagnosticLog('device-history-empty-read-checkpoint-skip', {
      reason,
      protocol,
      deviceMac,
      timestamp,
      timeText: formatUnixTimestampForLog(timestamp),
      message: 'missing-device-mac-invalid-timestamp-or-covered-by-success-checkpoint',
      snapshot: getAwarenessConnectionSnapshot()
    });
  }
};
const getAwarenessHistoryProcessingSinceTimestamp = (isRwRing: boolean) => {
  const durableTimestamp = getAwarenessDurableCheckpointTimestamp();
  const backendAckTimestamp = getAwarenessBackendAckCheckpointTimestamp();
  // Read, build and dedupe must start from one device-level cursor. A durable
  // pending upload is already owned by the compensation queue, so a later BLE
  // session must not rebuild the same older history while waiting for its ACK.
  const processedCursor = Math.max(durableTimestamp, backendAckTimestamp);
  if (processedCursor > 0) {
    if (isRwRing) return processedCursor;
    // Keep only a tiny boundary overlap for records sharing the cursor second;
    // the uploaded-key ledger removes these few records before HTTP submission.
    return Math.max(0, processedCursor - LEGACY_HISTORY_READ_CHECKPOINT_OVERLAP_SECONDS);
  }
  if (isRwRing) return 0;
  return Math.max(0, getLegacyDefaultSleepWindowStartUnixTimestamp(new Date()));
};
const getAwarenessHistoryUploadSinceTimestamp = getAwarenessHistoryProcessingSinceTimestamp;
const getAwarenessHistoryReadSinceTimestamp = (isRwRing: boolean) => {
  const readTimestamp = getAwarenessReadCheckpointTimestamp();
  if (readTimestamp > 0) {
    if (isRwRing) return readTimestamp;
    return Math.max(0, readTimestamp - LEGACY_HISTORY_READ_CHECKPOINT_OVERLAP_SECONDS);
  }
  if (isRwRing) return 0;
  return Math.max(0, getLegacyDefaultSleepWindowStartUnixTimestamp(new Date()));
};
const getLegacyHomeHistoryReadScopeKey = (deviceMac: string, date: string) =>
  `${normalizeHistoryCheckpointDeviceMac(deviceMac) || 'unknown-device'}:${date}`;
const getLegacyHomeHistoryReadKey = (deviceMac: string, date: string, sinceTimestamp: number) =>
  `${getLegacyHomeHistoryReadScopeKey(deviceMac, date)}:${sinceTimestamp}`;
const clearLegacyHomeHistoryReadFailureKeys = (historyReadKey = '', historyScopeKey = '') => {
  if (historyReadKey) {
    legacyHomeHistoryReadFailedAt.delete(historyReadKey);
    legacyHomeHistoryReadFailedReason.delete(historyReadKey);
    legacyHomeHistoryReadFailedGeneration.delete(historyReadKey);
    // A recovered communication channel must be allowed to retry immediately.
    // Keeping the attempt timestamp here made the following retry hit the
    // five-minute `recent-same-window-attempt` gate even though the failure
    // marker had just been cleared.
    legacyHomeHistoryReadAttemptAt.delete(historyReadKey);
  }
  if (historyScopeKey) {
    legacyHomeHistoryReadFailedAt.delete(historyScopeKey);
    legacyHomeHistoryReadFailedReason.delete(historyScopeKey);
    legacyHomeHistoryReadFailedGeneration.delete(historyScopeKey);
    legacyHomeHistoryReadAttemptAt.delete(historyScopeKey);
  }
};
const getLegacyHomeCommunicationFailureCooldown = (deviceMac: string) => {
  const normalizedDeviceMac = normalizeHistoryCheckpointDeviceMac(deviceMac);
  const keyPrefix = normalizedDeviceMac ? `${normalizedDeviceMac}:` : '';
  let failedAt = 0;
  if (keyPrefix) {
    for (const [key, value] of legacyHomeHistoryReadFailedAt.entries()) {
      if (
        key.startsWith(keyPrefix) &&
        legacyHomeHistoryReadFailedReason.get(key) === 'communication-not-ready'
      ) {
        failedAt = Math.max(failedAt, Number(value || 0));
      }
    }
  }
  const remainingMs = Math.max(
    0,
    LEGACY_HOME_HISTORY_READ_COMMUNICATION_FAILURE_COOLDOWN_MS - (Date.now() - failedAt)
  );
  return {
    active: failedAt > 0 && remainingMs > 0,
    failedAt,
    remainingMs,
    deviceMac: normalizedDeviceMac
  };
};
const shouldBypassLegacyHomeHistoryRecentReadGate = (
  reason = '',
  options: { force?: boolean; longRetry?: boolean } = {}
) =>
  Boolean(options.force) ||
  Boolean(options.longRetry) ||
  /manual|pull|debug|repair/i.test(`${reason || ''}`);
const getLegacyHomeEmptyReadCheckpointTimestamp = (sinceTimestamp: number) =>
  Math.max(0, sinceTimestamp || 0);
const getLegacyHomeHistoryDateStartTimestamp = (date: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!match) return 0;
  const [, year, month, day] = match;
  return Math.floor(new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0).getTime() / 1000);
};
const getLegacyHomeHistorySleepWindowStartTimestamp = (date: string) => {
  const dateStartTimestamp = getLegacyHomeHistoryDateStartTimestamp(date);
  if (dateStartTimestamp <= 0) return 0;
  return Math.max(0, dateStartTimestamp - (24 - LEGACY_DEFAULT_SLEEP_WINDOW_START_HOUR) * 3600);
};
const getLegacyHomeCloudCoverageScopeKey = (deviceMac: string, date: string) =>
  `${normalizeHistoryCheckpointDeviceMac(deviceMac) || 'unknown-device'}:${date || 'unknown-date'}`;
const rememberLegacyHomeCloudCoverageSnapshot = (
  deviceMac: string,
  date: string,
  details: Omit<LegacyHomeCloudCoverageSnapshot, 'deviceMac' | 'date' | 'updatedAt'>
) => {
  const normalizedDeviceMac = normalizeHistoryCheckpointDeviceMac(deviceMac);
  if (!normalizedDeviceMac || !date) return;
  legacyHomeCloudCoverageByScope.set(getLegacyHomeCloudCoverageScopeKey(normalizedDeviceMac, date), {
    deviceMac: normalizedDeviceMac,
    date,
    ...details,
    updatedAt: Date.now()
  });
};
const getLegacyHomeCloudCoverageSnapshot = (deviceMac: string, date: string) =>
  legacyHomeCloudCoverageByScope.get(getLegacyHomeCloudCoverageScopeKey(deviceMac, date)) || null;
const hasLegacyHomeHistoryReachedDate = (maxReachedTimestamp: number, date: string) => {
  const dateStartTimestamp = getLegacyHomeHistoryDateStartTimestamp(date);
  return Boolean(maxReachedTimestamp > 0 && dateStartTimestamp > 0 && maxReachedTimestamp >= dateStartTimestamp);
};
const pruneLegacyHomeHistoryReadResultCache = () => {
  const now = Date.now();
  legacyHomeHistoryReadTerminalByDevice.forEach((value, key) => {
    if (!value?.updatedAt || now - value.updatedAt > LEGACY_HOME_HISTORY_READ_RESULT_CACHE_TTL_MS) {
      legacyHomeHistoryReadTerminalByDevice.delete(key);
    }
  });
  legacyHomeHistoryReadRecordsByDevice.forEach((value, key) => {
    if (!value?.updatedAt || now - value.updatedAt > LEGACY_HOME_HISTORY_READ_RESULT_CACHE_TTL_MS) {
      legacyHomeHistoryReadRecordsByDevice.delete(key);
    }
  });
};
const rememberLegacyHomeHistoryReadResult = (
  deviceMac: string,
  details: {
    completed: boolean;
    parsedComplete: boolean;
    status?: string;
    records?: Array<Record<string, any>>;
    recordCount?: number;
    maxTimestamp?: number;
    reason?: string;
  }
) => {
  const deviceMacNorm = normalizeHistoryCheckpointDeviceMac(deviceMac);
  if (!deviceMacNorm) return;
  pruneLegacyHomeHistoryReadResultCache();
  const now = Date.now();
  const records = Array.isArray(details.records) ? details.records : [];
  legacyHomeHistoryReadTerminalByDevice.set(deviceMacNorm, {
    completed: details.completed === true,
    parsedComplete: details.parsedComplete === true,
    status: String(details.status || ''),
    recordCount: Number(details.recordCount ?? records.length ?? 0) || 0,
    maxTimestamp: Number(details.maxTimestamp || 0) || 0,
    updatedAt: now,
    reason: String(details.reason || '')
  });
  if (records.length > 0) {
    legacyHomeHistoryReadRecordsByDevice.set(deviceMacNorm, {
      records: records as Array<Record<string, any>>,
      maxTimestamp: Number(details.maxTimestamp || 0) || 0,
      updatedAt: now,
      reason: String(details.reason || '')
    });
  }
};
const getLegacyHomeHistoryReadTerminalForDevice = (deviceMac: string) => {
  const deviceMacNorm = normalizeHistoryCheckpointDeviceMac(deviceMac);
  if (!deviceMacNorm) return null;
  pruneLegacyHomeHistoryReadResultCache();
  return legacyHomeHistoryReadTerminalByDevice.get(deviceMacNorm) || null;
};
const isLegacyHomeHistoryReadTerminalComplete = (
  terminal?: { completed?: boolean; parsedComplete?: boolean } | null
) => Boolean(terminal?.completed === true && terminal?.parsedComplete === true);
const getLegacyHomeHistoryReadRecordsForDevice = (deviceMac: string) => {
  const deviceMacNorm = normalizeHistoryCheckpointDeviceMac(deviceMac);
  if (!deviceMacNorm) return [] as Array<Record<string, any>>;
  pruneLegacyHomeHistoryReadResultCache();
  return legacyHomeHistoryReadRecordsByDevice.get(deviceMacNorm)?.records || [];
};
const markLegacyHomeHistoryReadCompletedForDevice = (
  deviceMac: string,
  date = formatLocalDate(new Date()),
  maxReachedTimestamp = 0,
  reason = ''
) => {
  const scopeKey = getLegacyHomeHistoryReadScopeKey(deviceMac, date);
  if (scopeKey.startsWith('unknown-device')) return false;
  const dateStartTimestamp = getLegacyHomeHistoryDateStartTimestamp(date);
  if (!hasLegacyHomeHistoryReachedDate(maxReachedTimestamp, date)) {
    appendAwarenessDiagnosticLog('legacy-home-history-read-completed-skip', {
      reason,
      deviceMac,
      historyDate: date,
      historyScopeKey: scopeKey,
      maxReachedTimestamp,
      maxReachedText: formatUnixTimestampForLog(maxReachedTimestamp),
      historyDateStartTimestamp: dateStartTimestamp,
      historyDateStartText: formatUnixTimestampForLog(dateStartTimestamp),
      skipReason: 'max-history-time-before-history-date',
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }
  legacyHomeHistoryReadCompletedAt.set(scopeKey, Date.now());
  legacyHomeHistoryPartialContinueAttempts.delete(scopeKey);
  appendAwarenessDiagnosticLog('legacy-home-history-read-completed-marked', {
    reason,
    deviceMac,
    historyDate: date,
    historyScopeKey: scopeKey,
    maxReachedTimestamp,
    maxReachedText: formatUnixTimestampForLog(maxReachedTimestamp),
    historyDateStartTimestamp: dateStartTimestamp,
    historyDateStartText: formatUnixTimestampForLog(dateStartTimestamp),
    snapshot: getAwarenessConnectionSnapshot()
  });
  return true;
};

const markLegacyHomeHistoryReadFetchedForWindow = (params: {
  historyReadKey: string;
  historyScopeKey: string;
  deviceMac: string;
  date: string;
  maxReachedTimestamp: number;
  recordCount: number;
  reason: string;
}) => {
  const {
    historyReadKey,
    historyScopeKey,
    deviceMac,
    date,
    maxReachedTimestamp,
    recordCount,
    reason
  } = params;
  if (!historyReadKey || !historyScopeKey || historyScopeKey.startsWith('unknown-device')) {
    return false;
  }
  if (recordCount <= 0 || !hasLegacyHomeHistoryReachedDate(maxReachedTimestamp, date)) {
    return false;
  }
  const now = Date.now();
  legacyHomeHistoryReadFetchedAt.set(historyReadKey, now);
  legacyHomeHistoryReadFetchedAt.set(historyScopeKey, now);
  appendAwarenessDiagnosticLog('legacy-home-history-read-fetched-marked', {
    reason,
    deviceMac,
    historyDate: date,
    historyReadKey,
    historyScopeKey,
    recordCount,
    maxReachedTimestamp,
    maxReachedText: formatUnixTimestampForLog(maxReachedTimestamp),
    snapshot: getAwarenessConnectionSnapshot()
  });
  return true;
};

const pullDownRefresh = ref(false);
const pullDownProgress = ref(0);
const homeDataSyncing = ref(false);
const homeSyncRunningInBackground = ref(false);
const homeDataRefreshingAfterSync = ref(false);
// 历史终帧后电量必须重新向设备读取一次。这个栅栏只控制顶部状态展示，
// 不恢复 isSending，不会阻塞首页、健康、我的或详情页交互。
const homeFreshBatteryReadingAfterSync = ref(false);
let homeFreshBatteryBarrierSequence = 0;
let homeFreshBatteryBarrierTimer: ReturnType<typeof setTimeout> | null = null;
const LEGACY_HOME_FRESH_BATTERY_BARRIER_TIMEOUT_MS = LEGACY_HOME_DEVICE_INFO_TIMEOUT_MS + 600;
const finishLegacyHomeFreshBatteryBarrier = (barrierId: number, trigger: string) => {
  if (!barrierId || barrierId !== homeFreshBatteryBarrierSequence) return;
  if (homeFreshBatteryBarrierTimer) {
    clearTimeout(homeFreshBatteryBarrierTimer);
    homeFreshBatteryBarrierTimer = null;
  }
  const wasPending = homeFreshBatteryReadingAfterSync.value;
  homeFreshBatteryReadingAfterSync.value = false;
  if (wasPending) {
    appendAwarenessDiagnosticLog('legacy-home-fresh-battery-barrier-finished', {
      barrierId,
      trigger,
      battery: displayBatteryValue.value,
      snapshot: getAwarenessConnectionSnapshot()
    });
    scheduleAwarenessVisibleSyncReconcile(`fresh-battery-finished:${trigger}`);
  }
};
const beginLegacyHomeFreshBatteryBarrier = (protocol: string, reason: string) => {
  homeFreshBatteryBarrierSequence += 1;
  const barrierId = homeFreshBatteryBarrierSequence;
  if (homeFreshBatteryBarrierTimer) {
    clearTimeout(homeFreshBatteryBarrierTimer);
  }
  homeFreshBatteryReadingAfterSync.value = true;
  homeFreshBatteryBarrierTimer = setTimeout(() => {
    homeFreshBatteryBarrierTimer = null;
    finishLegacyHomeFreshBatteryBarrier(barrierId, 'timeout');
  }, LEGACY_HOME_FRESH_BATTERY_BARRIER_TIMEOUT_MS);
  appendAwarenessDiagnosticLog('legacy-home-fresh-battery-barrier-started', {
    protocol,
    reason,
    barrierId,
    timeoutMs: LEGACY_HOME_FRESH_BATTERY_BARRIER_TIMEOUT_MS,
    batteryBefore: displayBatteryValue.value,
    snapshot: getAwarenessConnectionSnapshot()
  });
  return barrierId;
};
let homeSyncForegroundBudgetTimer: ReturnType<typeof setTimeout> | null = null;
let homeSyncForegroundDeadlineAt = 0;
const releaseAwarenessForegroundInteractionBudget = (trigger: string) => {
  if (!homeDataSyncing.value || homeSyncRunningInBackground.value) return;
  homeSyncRunningInBackground.value = true;
  // The end-to-end sync remains visible, but it must never keep navigation,
  // cards or detail pages in a foreground sending/locked state.
  userStore.updateIsSending(false);
  if (userStore.uploadingStatus === 'uploading') {
    userStore.updateUploadingStatus('2');
  }
  appendAwarenessDiagnosticLog('home-sync-foreground-budget-released', {
    trigger,
    budgetMs: AWARENESS_FOREGROUND_SYNC_BUDGET_MS,
    deadlineAt: homeSyncForegroundDeadlineAt,
    overdueMs: homeSyncForegroundDeadlineAt > 0 ? Math.max(0, Date.now() - homeSyncForegroundDeadlineAt) : 0,
    deviceMac: getAwarenessCanonicalDeviceMac(),
    snapshot: getAwarenessConnectionSnapshot()
  });
};
const armAwarenessForegroundInteractionBudget = (trigger: string) => {
  if (homeSyncForegroundBudgetTimer) {
    clearTimeout(homeSyncForegroundBudgetTimer);
    homeSyncForegroundBudgetTimer = null;
  }
  if (!homeDataSyncing.value || homeSyncRunningInBackground.value || homeSyncForegroundDeadlineAt <= 0) return;
  const remainingMs = homeSyncForegroundDeadlineAt - Date.now();
  if (remainingMs <= 0) {
    releaseAwarenessForegroundInteractionBudget(`${trigger}:deadline-reached`);
    return;
  }
  homeSyncForegroundBudgetTimer = setTimeout(() => {
    homeSyncForegroundBudgetTimer = null;
    releaseAwarenessForegroundInteractionBudget(`${trigger}:timer`);
  }, remainingMs);
};
watch(homeDataSyncing, (syncing) => {
  if (homeSyncForegroundBudgetTimer) {
    clearTimeout(homeSyncForegroundBudgetTimer);
    homeSyncForegroundBudgetTimer = null;
  }
  if (!syncing) {
    homeSyncRunningInBackground.value = false;
    homeSyncForegroundDeadlineAt = 0;
    return;
  }
  homeSyncRunningInBackground.value = false;
  homeSyncForegroundDeadlineAt = Date.now() + AWARENESS_FOREGROUND_SYNC_BUDGET_MS;
  armAwarenessForegroundInteractionBudget('home-sync-start');
});
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
const awarenessNavigationInFlightTargets = new Set<string>();
const claimAwarenessNavigationTarget = (key: string) => {
  if (awarenessNavigationInFlightTargets.has(key)) {
    return false;
  }
  awarenessNavigationInFlightTargets.add(key);
  return true;
};
const releaseAwarenessNavigationTarget = (key: string) => {
  awarenessNavigationInFlightTargets.delete(key);
};
const resetAwarenessNavigationState = (reason: string) => {
  const previousTargets = [...awarenessNavigationInFlightTargets];
  awarenessNavigationInFlightTargets.clear();
  if (previousTargets.length > 0) {
    appendAwarenessDiagnosticLog('home-detail-navigation-reset', {
      reason,
      previousTargets
    });
  }
};
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
const getAwarenessHistoryRecordUploadWindowTimestamp = (record: Record<string, any>) =>
  getRingHistoryRecordSyncUnixTime(record as any) || getRingHistoryRecordUnixTime(record as any) || 0;
const filterAwarenessHistoryRecordsForUploadWindow = (records: Array<Record<string, any>> = [], uploadSinceTimestamp = 0) => {
  const sinceTimestamp = Number(uploadSinceTimestamp);
  if (!Number.isFinite(sinceTimestamp) || sinceTimestamp <= 0) return records || [];
  return (records || []).filter((record) => {
    if (!record || typeof record !== 'object') return false;
    const timestamp = getAwarenessHistoryRecordUploadWindowTimestamp(record);
    return timestamp > 0 && timestamp >= sinceTimestamp;
  });
};
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
const summarizeAwarenessReceivedDataTailForLog = (limit = 8) => {
  const received = Array.isArray(userStore.receivedData) ? userStore.receivedData : [];
  return received.slice(Math.max(0, received.length - limit)).map((item: any) => {
    const raw = Array.isArray(item?.raw)
      ? item.raw
      : Array.isArray(item?.data)
        ? item.data
        : Array.isArray(item?.bytes)
          ? item.bytes
          : [];
    const records = Array.isArray(item?.records) ? item.records : [];
    return {
      type: item?.type,
      protocol: item?.protocol,
      cmd: item?.cmd,
      subcmd: item?.subcmd,
      status: item?.status,
      dataType: item?.dataType,
      frameId: item?.frameId,
      recordCount: records.length,
      rawLength: raw.length,
      rawHead: raw.slice(0, 12),
      timestamp: item?.timestamp,
      time: item?.time || item?.recordTime || item?.startTime
    };
  });
};

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
      if (deviceMac && hasAwarenessPayloadDeviceIdentity(record) && !isAwarenessPayloadSourceForDevice(record, deviceMac)) return;
      records.push(enrichAwarenessHistoryRecordForUpload(record, payload as Record<string, any>, parsed, deviceMac, extra));
    });
  }

  return dedupeAwarenessHistoryRecordsForUpload(records).filter(
    (record) => !deviceMac || !hasAwarenessPayloadDeviceIdentity(record) || isAwarenessPayloadSourceForDevice(record, deviceMac)
  );
};

const buildLegacyLocalDataRawFramesForCompensation = (payloads: any[], deviceMac: string, uploadSinceTimestamp = 0) => {
  const keyedFrames = new Map<string, ReturnType<typeof buildRingRawHistoryFrames>[number]>();
  let skippedDeviceMismatchCount = 0;
  let preservedStaleRecordCount = 0;
  let preservedUnknownTimeRecordCount = 0;
  let preservedPayloadCount = 0;
  for (const payload of payloads || []) {
    if (!payload || typeof payload !== 'object') continue;
    if (deviceMac && !isAwarenessHistoryPayloadForDevice(payload as Record<string, any>, deviceMac)) {
      skippedDeviceMismatchCount += 1;
      continue;
    }
    const parsed = payload.parsed && typeof payload.parsed === 'object' ? payload.parsed : payload;
    const records = Array.isArray(payload.records) ? (payload.records as Array<Record<string, any>>) : [];
    const deviceRecords = deviceMac ? filterAwarenessHistoryRecordsForDevice(records, deviceMac) : records;
    skippedDeviceMismatchCount += Math.max(0, records.length - deviceRecords.length);
    // Raw evidence is staged before any backendAck/checkpoint filtering. The
    // parsed business upload below still owns type-aware filtering and dedup,
    // while these frames remain available for repair/compensation.
    if (uploadSinceTimestamp > 0) {
      const unknownTimeCount = deviceRecords.filter((record) => !getAwarenessHistoryRecordUploadWindowTimestamp(record)).length;
      const uploadWindowRecords = filterAwarenessHistoryRecordsForUploadWindow(deviceRecords, uploadSinceTimestamp);
      const staleCount = Math.max(0, deviceRecords.length - uploadWindowRecords.length - unknownTimeCount);
      preservedUnknownTimeRecordCount += unknownTimeCount;
      preservedStaleRecordCount += staleCount;
      if (staleCount > 0 || unknownTimeCount > 0) preservedPayloadCount += 1;
    }
    const frames = buildRingRawHistoryFrames(deviceRecords, parsed, deviceMac);
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
  if (preservedPayloadCount > 0 || preservedStaleRecordCount > 0 || preservedUnknownTimeRecordCount > 0) {
    appendAwarenessDiagnosticLog('legacy-local-raw-frame-compensation-preserved', {
      reason: 'stage-before-upload-filter',
      deviceMac,
      uploadSinceTimestamp,
      uploadSinceTime: formatUnixTimestampForLog(uploadSinceTimestamp),
      preservedPayloadCount,
      preservedStaleRecordCount,
      preservedUnknownTimeRecordCount,
      totalPayloadCount: payloads?.length || 0,
      rawFrameCount: keyedFrames.size,
      snapshot: getAwarenessConnectionSnapshot()
    });
  }
  return Array.from(keyedFrames.values());
};

const createLegacyLocalDataUploadBatch = (deviceMac: string, uploadSinceTimestamp: number) => {
  const payloadScope = getAwarenessCurrentHistoryPayloadsForUpload();
  const payloadRecords = buildAwarenessHistoryRecordsFromPayloadsForUpload(payloadScope.matchedPayloads, deviceMac);
  const historyReadRecords = getLegacyHomeHistoryReadRecordsForDevice(deviceMac);
  const allCachedRecords = Array.isArray(local.value) ? (local.value as Array<Record<string, any>>) : [];
  const cachedRecords = filterAwarenessHistoryRecordsForDevice(
    allCachedRecords,
    deviceMac
  );
  const skippedCachedDeviceMismatchCount = Math.max(0, allCachedRecords.length - cachedRecords.length);
  const mergedRecords = dedupeAwarenessHistoryRecordsForUpload([...cachedRecords, ...payloadRecords, ...historyReadRecords]).filter(
    (record) => !deviceMac || !hasAwarenessPayloadDeviceIdentity(record) || isAwarenessPayloadSourceForDevice(record, deviceMac)
  );
  // Do not apply the generic window before buildRingHistorySubmitRecords.
  // That builder owns the type-aware sleep/vital backfill windows; filtering
  // here first silently discarded valid overlap records required for repair.
  const records = mergedRecords;
  const genericWindowRecords = filterAwarenessHistoryRecordsForUploadWindow(mergedRecords, uploadSinceTimestamp);
  const preservedOverlapRecordCount = Math.max(0, mergedRecords.length - genericWindowRecords.length);
  if (preservedOverlapRecordCount > 0) {
    appendAwarenessDiagnosticLog('legacy-local-data-window-overlap-preserved', {
      reason: 'idempotent-upload-instead-of-time-window-skip',
      deviceMac,
      uploadSinceTimestamp,
      uploadSinceTime: formatUnixTimestampForLog(uploadSinceTimestamp),
      preservedOverlapRecordCount,
      beforeRecordCount: mergedRecords.length,
      afterRecordCount: genericWindowRecords.length,
      beforeSummary: summarizeLegacyUploadRecordsForLog(mergedRecords as Array<Record<string, any>>),
      afterSummary: summarizeLegacyUploadRecordsForLog(genericWindowRecords as Array<Record<string, any>>),
      sourceCounts: {
        payloadRecordCount: payloadRecords.length,
        cachedRecordCount: cachedRecords.length,
        historyReadRecordCount: historyReadRecords.length
      },
      snapshot: getAwarenessConnectionSnapshot()
    });
  }
  const rawFrames = buildLegacyLocalDataRawFramesForCompensation(payloadScope.matchedPayloads, deviceMac, uploadSinceTimestamp);
  const rawMetricCounts = countRingHistoryRecordMetrics(records as Array<Record<string, any>>);
  // Do not use backendAck as a destructive record filter. A historical ACK
  // can legitimately sit after a locally durable gap (old client timeout,
  // interrupted migration, or repaired sleep overlap). Keep every parseable
  // record here; the per-device uploaded-key filter removes known successes,
  // while backend batchId/raw unique constraints make retransmission safe.
  const builtSubmitArray = buildRingHistorySubmitRecords(records, 0);
  const uploadedRecordFilter = filterUploadedRingHistorySubmitRecordsForDevice(deviceMac, builtSubmitArray);
  const submitArray = uploadedRecordFilter.submitRecords;
  const submitMetricCounts = countRingHistoryRecordMetrics(submitArray as Array<Record<string, any>>);

  return {
    payloadScope,
    source:
      payloadRecords.length > 0 && cachedRecords.length > 0
        ? 'merged-payload-local-cache'
        : payloadRecords.length > 0
          ? 'matched-payloads'
          : historyReadRecords.length > 0
            ? 'history-read-result'
            : 'local-cache',
    payloadRecordCount: payloadRecords.length,
    allCachedRecordCount: allCachedRecords.length,
    cachedRecordCount: cachedRecords.length,
    skippedCachedDeviceMismatchCount,
    historyReadRecordCount: historyReadRecords.length,
    mergedRecordCount: mergedRecords.length,
    preservedOverlapRecordCount,
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

const buildLegacyLocalDataStableSnapshot = () => {
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
  const historyReadTerminal = deviceMac ? getLegacyHomeHistoryReadTerminalForDevice(deviceMac) : null;
  const historyReadExplicitlyIncomplete = historyReadTerminal?.reason === 'l19-short-result-incomplete';
  const completed =
    !historyReadExplicitlyIncomplete &&
    (
      isRingHistoryReadComplete(matchedPayloads as Array<Record<string, any>>) ||
      isLegacyHomeHistoryReadTerminalComplete(historyReadTerminal)
    );
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
    historyReadTerminal,
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

type LegacyLocalDataUploadBatch = ReturnType<typeof createLegacyLocalDataUploadBatch>;
type LegacyLocalDataUploadBatchCacheEntry = {
  expiresAt: number;
  value: LegacyLocalDataUploadBatch;
};
const legacyLocalDataUploadBatchCache = new Map<string, LegacyLocalDataUploadBatchCacheEntry>();
// A completed legacy history read can pass through terminal/stable/upload
// checks several times before the HTTP upload starts.  Building the same
// normalize/dedupe batch costs multiple seconds on a real mini-program phone.
// The cache key already contains the payload sizes and terminal generation,
// and the cache is explicitly cleared when the upload claims the batch.  The
// upload cursor can advance while the same terminal snapshot is handed from
// the watcher to the uploader, so it must not split one completed read into
// several expensive normalize/dedupe builds.
// Keep a terminal immutable snapshot long enough for a busy/weak device to
// enter the HTTP pipeline. The cache is still explicitly cleared when that
// upload session finishes or the snapshot identity changes.
const LEGACY_LOCAL_DATA_UPLOAD_BATCH_CACHE_MS = 2 * 60 * 1000;
const clearLegacyLocalDataUploadBatchCache = () => {
  legacyLocalDataUploadBatchCache.clear();
};
const getLegacyLocalDataUploadBatchCacheKey = (deviceMac: string, uploadSinceTimestamp: number) => {
  const normalizedDeviceMac = normalizeHistoryCheckpointDeviceMac(deviceMac);
  const receivedDataLength = Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0;
  const localDataLength = Array.isArray(local.value) ? local.value.length : 0;
  const historyReadTerminal = getLegacyHomeHistoryReadTerminalForDevice(deviceMac) as Record<string, any> | null;
  // 终帧确认后，receivedData + terminal generation 才是本轮上传快照的稳定身份。
  // localData 会在解析回调中继续补齐，completedTick/checkpoint 也会更新；把这些
  // 变化放进 key 会让同一轮 130/155 条数据重复归并、排序和去重 3~4 次。
  if (isLegacyHomeHistoryReadTerminalComplete(historyReadTerminal)) {
    return [
      normalizedDeviceMac || deviceMac || 'unknown-device',
      'terminal-complete',
      Number(historyReadTerminal?.updatedAt || historyReadTerminal?.completedAt || 0),
      Number(historyReadTerminal?.recordCount || 0),
      Number(historyReadTerminal?.maxTimestamp || 0)
    ].join('|');
  }
  return [
    normalizedDeviceMac || deviceMac || 'unknown-device',
    uploadSinceTimestamp || 0,
    receivedDataLength,
    localDataLength,
    legacyHomeHistoryReadCompletedTick.value || 0,
    Number(historyReadTerminal?.updatedAt || historyReadTerminal?.completedAt || 0),
    Number(historyReadTerminal?.recordCount || 0),
    getAwarenessLastReadTimestamp() || 0
  ].join('|');
};
const buildLegacyLocalDataUploadBatch = (deviceMac: string, uploadSinceTimestamp: number): LegacyLocalDataUploadBatch => {
  const now = Date.now();
  const cacheKey = getLegacyLocalDataUploadBatchCacheKey(deviceMac, uploadSinceTimestamp);
  legacyLocalDataUploadBatchCache.forEach((entry, key) => {
    if (entry.expiresAt <= now) legacyLocalDataUploadBatchCache.delete(key);
  });
  const cached = legacyLocalDataUploadBatchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const buildStartedAt = Date.now();
  const value = createLegacyLocalDataUploadBatch(deviceMac, uploadSinceTimestamp);
  const elapsedMs = Date.now() - buildStartedAt;
  legacyLocalDataUploadBatchCache.set(cacheKey, {
    expiresAt: Date.now() + LEGACY_LOCAL_DATA_UPLOAD_BATCH_CACHE_MS,
    value
  });
  // Only a few foreground sessions can exist, but keep a hard bound so a
  // device-switch stress test cannot retain large normalized snapshots.
  while (legacyLocalDataUploadBatchCache.size > 4) {
    const oldestKey = legacyLocalDataUploadBatchCache.keys().next().value;
    if (!oldestKey) break;
    legacyLocalDataUploadBatchCache.delete(oldestKey);
  }
  if (elapsedMs >= 100) {
    appendAwarenessDiagnosticLog('legacy-local-data-upload-batch-build-slow', {
      deviceMac,
      elapsedMs,
      payloadRecordCount: value.payloadRecordCount,
      cachedRecordCount: value.cachedRecordCount,
      historyReadRecordCount: value.historyReadRecordCount,
      mergedRecordCount: value.mergedRecordCount,
      submitCount: value.submitArray.length,
      rawFrameCount: value.rawFrames.length
    });
  }
  return value;
};
type LegacyLocalDataStableSnapshot = ReturnType<typeof buildLegacyLocalDataStableSnapshot>;
let legacyLocalDataStableSnapshotCache: { expiresAt: number; value: LegacyLocalDataStableSnapshot } | null = null;
let legacyLocalDataTerminalSkipMemo: { key: string; value: LegacyLocalDataStableSnapshot } | null = null;
const LEGACY_LOCAL_DATA_STABLE_SNAPSHOT_CACHE_MS = 350;
const getLegacyLocalDataTerminalSkipMemoKey = () => {
  const deviceMac = getAwarenessActiveHomeSyncMac() || getAwarenessUploadDeviceMac();
  const deviceMacNorm = normalizeHistoryCheckpointDeviceMac(deviceMac);
  if (
    !deviceMacNorm ||
    legacyHomeHistoryReadInFlight.value ||
    legacyHomeHistoryReadPromise ||
    Boolean(legacyHomeHistoryReadActiveScopeKey)
  ) return '';
  const historyReadTerminal = getLegacyHomeHistoryReadTerminalForDevice(deviceMac) as Record<string, any> | null;
  if (!isLegacyHomeHistoryReadTerminalComplete(historyReadTerminal)) return '';
  const checkpointTimestamp = getAwarenessLastReadTimestamp();
  const terminalMaxTimestamp = Number(historyReadTerminal?.maxTimestamp || 0);
  if (checkpointTimestamp <= 0 || terminalMaxTimestamp <= 0 || checkpointTimestamp < terminalMaxTimestamp) return '';
  return [
    deviceMacNorm,
    Number(historyReadTerminal?.updatedAt || 0),
    Number(historyReadTerminal?.recordCount || 0),
    terminalMaxTimestamp,
    checkpointTimestamp
  ].join('|');
};
const getLegacyLocalDataStableSnapshot = (): LegacyLocalDataStableSnapshot => {
  const now = Date.now();
  if (legacyLocalDataStableSnapshotCache && legacyLocalDataStableSnapshotCache.expiresAt > now) {
    return legacyLocalDataStableSnapshotCache.value;
  }
  // Once a completed terminal is already covered by the durable checkpoint,
  // watcher/close-session callbacks must reuse that decision. Rebuilding the
  // same cached history records can cost several seconds and used to happen
  // dozens of times on B7 before the terminal skip finally closed the cycle.
  const terminalSkipMemoKey = getLegacyLocalDataTerminalSkipMemoKey();
  if (terminalSkipMemoKey && legacyLocalDataTerminalSkipMemo?.key === terminalSkipMemoKey) {
    return legacyLocalDataTerminalSkipMemo.value;
  }
  const value = buildLegacyLocalDataStableSnapshot();
  legacyLocalDataStableSnapshotCache = {
    expiresAt: now + LEGACY_LOCAL_DATA_STABLE_SNAPSHOT_CACHE_MS,
    value
  };
  if (terminalSkipMemoKey && value.completed && value.checkpointCovered) {
    legacyLocalDataTerminalSkipMemo = {
      key: terminalSkipMemoKey,
      value
    };
  }
  return value;
};
const getLegacyLocalDataSnapshotMaxTimestamp = (snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>) => {
  const timestamps = [
    snapshot?.rawRange?.maxTimestamp,
    snapshot?.builtSubmitRange?.maxTimestamp,
    snapshot?.submitRange?.maxTimestamp
  ]
    .map((timestamp) => Number(timestamp || 0))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  return timestamps.length > 0 ? Math.max(...timestamps) : 0;
};
const advanceLegacyLocalDataReadCheckpointFromSnapshot = (
  snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>,
  reason: string
) => {
  const maxTimestamp = getLegacyLocalDataSnapshotMaxTimestamp(snapshot);
  if (maxTimestamp <= 0) return 0;
  updateAwarenessDeviceHistoryReadCheckpoint(maxTimestamp, reason);
  return maxTimestamp;
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
  return `${getAwarenessHomeSyncUserId()}|${snapshot.deviceMacNorm}|${snapshot.signature}`;
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
  // 历史读取是流式返回：第一帧可能早于 checkpoint，但后续帧仍可能包含新增有效数据。
  // 因此 checkpoint/已上传去重只能在设备明确返回“历史读取完成”后作为终止条件。
  if (snapshot.completed && snapshot.recordCount > 0 && snapshot.checkpointCovered) return 'checkpoint-covered';
  if (snapshot.completed && snapshot.builtSubmitCount > 0 && snapshot.submitCount === 0) {
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
const getClosedLegacyLocalDataUploadSessionForCurrentForeground = () => {
  pruneClosedLegacyLocalDataUploadSessions();
  const deviceMacNorm = normalizeHistoryCheckpointDeviceMac(getAwarenessCanonicalDeviceMac());
  if (!deviceMacNorm) return null;
  const closed = closedLegacyLocalDataUploadSessions.get(deviceMacNorm);
  if (!closed || closed.uploadSessionKey !== getAwarenessHomeUploadSessionKey()) return null;
  return closed;
};
const closeLegacyLocalDataTerminalSkip = (snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>, reason = '') => {
  clearLegacyLocalDataTimeoutFlush();
  const terminalMaxTimestamp = getLegacyLocalDataSnapshotMaxTimestamp(snapshot);
  const terminalUploadedUntil = Math.max(Number(snapshot.checkpointTimestamp || 0), terminalMaxTimestamp);
  closeLegacyLocalDataUploadSession(
    snapshot.deviceMac,
    snapshot.uploadDedupKey,
    terminalUploadedUntil
  );
  // A terminal watcher may observe a stable-but-partial snapshot after an upload
  // has already been acknowledged.  Upload completion is not BLE history-read
  // completion: only a snapshot carrying the explicit 0x36 completion marker is
  // allowed to advance the read cursor or start the history cooldown.
  const completedByTerminalSkip = Boolean(
    snapshot.deviceMac &&
      snapshot.completed === true &&
      !LEGACY_LOCAL_DATA_SKIP_WITHOUT_HISTORY_COMPLETE_REASONS.has(reason)
  );
  if (completedByTerminalSkip) {
    if (terminalMaxTimestamp > 0) {
      updateAwarenessDeviceHistoryReadCheckpoint(terminalMaxTimestamp, `legacy-local-data-terminal-skip:${reason}`);
      appendAwarenessDiagnosticLog('legacy-local-data-terminal-skip-checkpoint-advanced', {
        reason,
        checkpointTimestamp: terminalMaxTimestamp,
        checkpointText: formatUnixTimestampForLog(terminalMaxTimestamp),
        stableSnapshot: snapshot,
        snapshot: getAwarenessConnectionSnapshot()
      });
    }
    appendAwarenessDiagnosticLog('legacy-local-data-terminal-skip-history-cooldown-unchanged', {
      reason,
      deviceMac: snapshot.deviceMac,
      terminalMaxTimestamp,
      snapshot: getAwarenessConnectionSnapshot()
    });
  }
  legacyLocalDataStableReadyAt = 0;
  legacyLocalDataStableUploadScheduled = false;
  legacyLocalDataUploadWatcherActive = false;
  legacyLocalDataUploadWatcherActiveAt = 0;
  legacyLocalDataUploadWatcherPending = false;
  userStore.updateUploadingStatus('2');
  userStore.updateIsSending(false);
  scheduleAwarenessVisibleSyncReconcile(`legacy-local-data-terminal-skip:${reason || 'unknown'}`);
  if (completedByTerminalSkip) {
    finishAwarenessHomeSyncWithoutHistoryCooldown('legacy-local-data-terminal-skip');
  } else {
    releaseAwarenessHomeSyncSession(`legacy-local-data-terminal-skip:${reason || 'unknown'}`, 'failed', false);
  }
};
const resetLegacyLocalDataUploadWatcherState = (trigger: string, protocol = '', details: Record<string, unknown> = {}) => {
  clearLegacyLocalDataTimeoutFlush();
  legacyLocalDataStableWaitGeneration += 1;
  legacyLocalDataStablePromise = null;
  legacyLocalDataStableReadyAt = 0;
  legacyLocalDataStableUploadScheduled = false;
  legacyLocalDataStableWaitStartedAt = 0;
  legacyLocalDataUploadWatcherActive = false;
  legacyLocalDataUploadWatcherActiveAt = 0;
  legacyLocalDataUploadWatcherPending = false;
  appendAwarenessDiagnosticLog('legacy-local-data-upload-watcher-reset', {
    protocol,
    trigger,
    ...details,
    stableSnapshot: getLegacyLocalDataStableSnapshot(),
    snapshot: getAwarenessConnectionSnapshot()
  });
};
const shouldDeferLegacyLocalDataTerminalSkip = (
  snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>,
  reason = ''
) => {
  if (!reason || !snapshot.deviceMacNorm) return false;
  // checkpoint-covered 只能说明当前已解析帧不需要上传，不能说明设备本轮历史数据已经全部返回。
  // 6E 实测中第一帧低于 checkpoint 后仍会连续返回后续有效帧；过早关闭会直接丢数据。
  if (
    reason === 'checkpoint-covered' &&
    (legacyHomeHistoryReadInFlight.value ||
      legacyHomeHistoryReadPromise ||
      (legacyHomeHistoryReadActiveScopeKey && legacyHomeHistoryReadActiveScopeKey.startsWith(`${snapshot.deviceMacNorm}:`)))
  ) {
    return true;
  }
  // 其他静默终止原因是签名/会话级去重，仍可直接关闭，避免重复上传。
  if (isLegacyLocalDataSilentTerminalSkipReason(reason)) return false;
  if (legacyHomeHistoryReadInFlight.value || legacyHomeHistoryReadPromise) return true;
  if (legacyHomeHistoryReadActiveScopeKey && legacyHomeHistoryReadActiveScopeKey.startsWith(`${snapshot.deviceMacNorm}:`)) {
    return true;
  }
  return false;
};
const tryCloseLegacyLocalDataTerminalSkip = (
  snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>,
  reason: string,
  trigger: string,
  protocol = ''
) => {
  if (!isLegacyLocalDataTerminalSkipReason(reason)) return false;
  if (shouldDeferLegacyLocalDataTerminalSkip(snapshot, reason)) {
    appendAwarenessDiagnosticLog('legacy-local-data-terminal-skip-deferred', {
      protocol,
      trigger,
      reason,
      stableSnapshot: snapshot,
      legacyHomeHistoryReadInFlight: legacyHomeHistoryReadInFlight.value,
      hasLegacyHomeHistoryReadPromise: Boolean(legacyHomeHistoryReadPromise),
      legacyHomeHistoryReadActiveKey,
      legacyHomeHistoryReadActiveScopeKey,
      historyReadElapsedMs: legacyHomeHistoryReadStartedAt > 0 ? Date.now() - legacyHomeHistoryReadStartedAt : 0,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }
  const alreadyClosed = snapshot.deviceMacNorm
    ? closedLegacyLocalDataUploadSessions.get(snapshot.deviceMacNorm)
    : null;
  if (
    alreadyClosed &&
    alreadyClosed.uploadSessionKey === getAwarenessHomeUploadSessionKey() &&
    alreadyClosed.uploadDedupKey === snapshot.uploadDedupKey &&
    Date.now() - alreadyClosed.completedAt <= LEGACY_LOCAL_DATA_CLOSED_SESSION_TTL_MS
  ) {
    // Watcher, page-show and upload-finally can observe the same immutable
    // terminal snapshot. The first close owns all state transitions; later
    // observations are successful no-ops instead of another close/log storm.
    return true;
  }
  appendAwarenessDiagnosticLog('legacy-local-data-terminal-skip-close', {
    protocol,
    trigger,
    reason,
    stableSnapshot: snapshot,
    snapshot: getAwarenessConnectionSnapshot()
  });
  closeLegacyLocalDataTerminalSkip(snapshot, reason);
  return true;
};
const shouldSkipLegacyLocalDataStableWait = (trigger: string, protocol: string) => {
  const stableSnapshot = getLegacyLocalDataStableSnapshot();
  const reason = getLegacyLocalDataStableSkipReason(stableSnapshot);
  if (!reason) return false;
  if (isLegacyLocalDataTerminalSkipReason(reason)) {
    if (!tryCloseLegacyLocalDataTerminalSkip(stableSnapshot, reason, trigger, protocol)) {
      return false;
    }
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

  const stableWaitGeneration = legacyLocalDataStableWaitGeneration;
  const stableWaitPromise = (async () => {
    const startedAt = Date.now();
    legacyLocalDataStableWaitStartedAt = startedAt;
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
      if (stableWaitGeneration !== legacyLocalDataStableWaitGeneration) {
        appendAwarenessDiagnosticLog('legacy-local-data-stable-wait-cancelled', {
          protocol,
          trigger,
          stableWaitGeneration,
          activeGeneration: legacyLocalDataStableWaitGeneration,
          elapsedMs: Date.now() - startedAt,
          snapshot: getAwarenessConnectionSnapshot()
        });
        return;
      }
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
    if (hasLegacyLocalDataUploadableSnapshot(timedOutSnapshot)) {
      legacyLocalDataStableReadyAt = Date.now();
      legacyLocalDataUploadWatcherPending = true;
      appendAwarenessDiagnosticLog('legacy-local-data-stable-wait-timeout-flush', {
        protocol,
        trigger,
        reason: 'timeout-with-uploadable-snapshot',
        elapsedMs: Date.now() - startedAt,
        stableSnapshot: timedOutSnapshot,
        snapshot: getAwarenessConnectionSnapshot()
      });
    }
  })().finally(() => {
    if (stableWaitGeneration !== legacyLocalDataStableWaitGeneration) return;
    legacyLocalDataStablePromise = null;
    legacyLocalDataStableWaitStartedAt = 0;
  });
  legacyLocalDataStablePromise = stableWaitPromise;

  return stableWaitPromise;
};
const isLegacyLocalDataStableReadyForUpload = () =>
  Boolean(legacyLocalDataStableReadyAt && Date.now() - legacyLocalDataStableReadyAt <= LEGACY_LOCAL_DATA_STABLE_READY_TTL_MS);

const getLegacyLocalDataIncompleteFlushKey = (snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>) =>
  [
    snapshot.deviceMacNorm || 'unknown-device',
    snapshot.signature || 'unknown-signature',
    snapshot.recordCount,
    snapshot.builtSubmitCount,
    snapshot.submitCount,
    snapshot.rawFrameCount,
    snapshot.uploadDedupKey || ''
  ].join('|');

const clearLegacyLocalDataIncompleteFlushTimer = () => {
  if (!legacyLocalDataIncompleteFlushTimer) return;
  clearTimeout(legacyLocalDataIncompleteFlushTimer);
  legacyLocalDataIncompleteFlushTimer = null;
  legacyLocalDataIncompleteFlushKey = '';
  legacyLocalDataIncompleteFlushScheduledAt = 0;
};

const clearLegacyHomeDeviceInfoRetryDeferredTimer = () => {
  if (!legacyHomeDeviceInfoRetryDeferredTimer) return;
  clearTimeout(legacyHomeDeviceInfoRetryDeferredTimer);
  legacyHomeDeviceInfoRetryDeferredTimer = null;
};

const clearLegacyLocalDataTimeoutFlush = () => {
  clearLegacyLocalDataIncompleteFlushTimer();
  legacyLocalDataTimeoutFlushDeviceMacNorm = '';
  legacyLocalDataTimeoutFlushKey = '';
  legacyLocalDataTimeoutFlushRequestedAt = 0;
  legacyLocalDataTimeoutFlushTrigger = '';
  legacyLocalDataActiveHistoryFlushKey = '';
  legacyLocalDataActiveHistoryFlushRequestedAt = 0;
  legacyLocalDataCompletedFastPathKey = '';
  legacyLocalDataCompletedFastPathRequestedAt = 0;
};

const hasLegacyLocalDataUploadableSnapshot = (snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>) =>
  Boolean(snapshot && (snapshot.recordCount > 0 || snapshot.builtSubmitCount > 0 || snapshot.rawFrameCount > 0));

const getLegacyLocalDataUploadableCount = (snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>) =>
  Math.max(
    Number(snapshot?.recordCount || 0),
    Number(snapshot?.builtSubmitCount || 0),
    Number(snapshot?.rawFrameCount || 0)
  );

const shouldFlushLegacyLocalDataDuringHistoryRead = (
  snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>,
  historyReadElapsedMs: number
) =>
  LEGACY_HOME_HISTORY_UPLOAD_EARLY_FLUSH_ENABLED &&
  hasLegacyLocalDataUploadableSnapshot(snapshot) &&
  historyReadElapsedMs >= LEGACY_HOME_HISTORY_UPLOAD_EARLY_FLUSH_MIN_MS &&
  getLegacyLocalDataUploadableCount(snapshot) >= LEGACY_HOME_HISTORY_UPLOAD_EARLY_FLUSH_MIN_RECORDS;

const requestLegacyLocalDataActiveHistoryFlush = (
  trigger: string,
  protocol: string,
  snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>,
  historyReadElapsedMs: number
) => {
  // Never freeze/upload a moving snapshot. A legacy history read can emit
  // health records first and sleep records near the tail; flushing here used
  // to submit only the first slice and made the current sleep disappear.
  if (legacyHomeHistoryReadInFlight.value || legacyHomeHistoryReadPromise) {
    legacyLocalDataUploadWatcherPending = true;
    appendAwarenessDiagnosticLog('legacy-local-data-active-history-flush-blocked', {
      protocol,
      trigger,
      reason: 'history-read-active-require-terminal-snapshot',
      historyReadElapsedMs,
      uploadableCount: getLegacyLocalDataUploadableCount(snapshot),
      stableSnapshot: snapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return true;
  }
  const flushKey = getLegacyLocalDataIncompleteFlushKey(snapshot);
  const now = Date.now();
  if (
    legacyLocalDataActiveHistoryFlushKey === flushKey &&
    legacyLocalDataActiveHistoryFlushRequestedAt > 0 &&
    now - legacyLocalDataActiveHistoryFlushRequestedAt < LEGACY_HOME_HISTORY_ACTIVE_FLUSH_DEDUP_MS
  ) {
    appendAwarenessDiagnosticLog('legacy-local-data-incomplete-flush-active-history-skip', {
      protocol,
      trigger,
      reason: 'same-active-history-flush-recently-requested',
      historyReadElapsedMs,
      activeFlushDedupMs: LEGACY_HOME_HISTORY_ACTIVE_FLUSH_DEDUP_MS,
      uploadableCount: getLegacyLocalDataUploadableCount(snapshot),
      stableSnapshot: snapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return true;
  }

  legacyLocalDataActiveHistoryFlushKey = flushKey;
  legacyLocalDataActiveHistoryFlushRequestedAt = now;
  appendAwarenessDiagnosticLog('legacy-local-data-incomplete-flush-allowed-during-history-read', {
    protocol,
    trigger,
    reason: 'history-read-active-large-stable-snapshot',
    historyReadElapsedMs,
    minElapsedMs: LEGACY_HOME_HISTORY_UPLOAD_EARLY_FLUSH_MIN_MS,
    minRecords: LEGACY_HOME_HISTORY_UPLOAD_EARLY_FLUSH_MIN_RECORDS,
    uploadableCount: getLegacyLocalDataUploadableCount(snapshot),
    stableSnapshot: snapshot,
    snapshot: getAwarenessConnectionSnapshot()
  });
  return requestLegacyLocalDataTimeoutFlush(`${trigger}:history-read-active-large-snapshot`, protocol, snapshot);
};

const isLegacyLocalDataTimeoutFlushAllowed = (snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot>) => {
  if (!legacyLocalDataTimeoutFlushDeviceMacNorm || !snapshot.deviceMacNorm) return false;
  if (snapshot.deviceMacNorm !== legacyLocalDataTimeoutFlushDeviceMacNorm) return false;
  if (!legacyLocalDataTimeoutFlushRequestedAt) return false;
  if (Date.now() - legacyLocalDataTimeoutFlushRequestedAt > LEGACY_LOCAL_DATA_TIMEOUT_FLUSH_TTL_MS) return false;
  return hasLegacyLocalDataUploadableSnapshot(snapshot);
};

const requestLegacyLocalDataTimeoutFlush = (
  trigger: string,
  protocol: string,
  snapshot: ReturnType<typeof getLegacyLocalDataStableSnapshot> = getLegacyLocalDataStableSnapshot()
) => {
  if (legacyHomeHistoryReadInFlight.value || legacyHomeHistoryReadPromise) {
    legacyLocalDataUploadWatcherPending = true;
    appendAwarenessDiagnosticLog('legacy-local-data-timeout-flush-deferred-during-history-read', {
      protocol,
      trigger,
      reason: 'history-read-active-require-terminal-snapshot',
      stableSnapshot: snapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return true;
  }
  if (!snapshot.deviceMacNorm || !hasLegacyLocalDataUploadableSnapshot(snapshot)) {
    appendAwarenessDiagnosticLog('legacy-local-data-timeout-flush-skip', {
      protocol,
      trigger,
      reason: !snapshot.deviceMacNorm ? 'missing-device-mac' : 'empty-snapshot',
      stableSnapshot: snapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }

  const flushKey = getLegacyLocalDataIncompleteFlushKey(snapshot);
  const now = Date.now();
  if (
    legacyLocalDataTimeoutFlushKey === flushKey &&
    legacyLocalDataTimeoutFlushRequestedAt > 0 &&
    now - legacyLocalDataTimeoutFlushRequestedAt < LEGACY_LOCAL_DATA_TIMEOUT_FLUSH_DEDUP_MS
  ) {
    appendAwarenessDiagnosticLog('legacy-local-data-timeout-flush-skip', {
      protocol,
      trigger,
      reason: 'same-snapshot-timeout-flush-recently-requested',
      elapsedMs: now - legacyLocalDataTimeoutFlushRequestedAt,
      dedupMs: LEGACY_LOCAL_DATA_TIMEOUT_FLUSH_DEDUP_MS,
      stableSnapshot: snapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return true;
  }

  legacyLocalDataTimeoutFlushDeviceMacNorm = snapshot.deviceMacNorm;
  legacyLocalDataTimeoutFlushKey = flushKey;
  legacyLocalDataTimeoutFlushRequestedAt = now;
  legacyLocalDataTimeoutFlushTrigger = trigger;
  legacyLocalDataStablePromise = null;
  legacyLocalDataStableUploadScheduled = false;
  legacyLocalDataStableWaitStartedAt = 0;
  legacyLocalDataStableReadyAt = now;
  legacyLocalDataUploadWatcherActive = false;
  legacyLocalDataUploadWatcherActiveAt = 0;
  legacyLocalDataUploadWatcherPending = false;
  appendAwarenessDiagnosticLog('legacy-local-data-timeout-flush-requested', {
    protocol,
    trigger,
    deviceMac: snapshot.deviceMac,
    deviceMacNorm: snapshot.deviceMacNorm,
    timeoutFlushTtlMs: LEGACY_LOCAL_DATA_TIMEOUT_FLUSH_TTL_MS,
    stableSnapshot: snapshot,
    snapshot: getAwarenessConnectionSnapshot()
  });
  legacyHomeHistoryReadCompletedTick.value = Date.now();
  return true;
};

const scheduleLegacyLocalDataIncompleteFlush = (trigger: string, protocol: string) => {
  const snapshot = getLegacyLocalDataStableSnapshot();
  if (!hasLegacyLocalDataUploadableSnapshot(snapshot)) return;
  const flushKey = getLegacyLocalDataIncompleteFlushKey(snapshot);
  if (legacyLocalDataIncompleteFlushTimer && legacyLocalDataIncompleteFlushKey === flushKey) {
    appendAwarenessDiagnosticLog('legacy-local-data-incomplete-flush-schedule-skip', {
      protocol,
      trigger,
      reason: 'same-snapshot-timer-running',
      elapsedMs: legacyLocalDataIncompleteFlushScheduledAt > 0 ? Date.now() - legacyLocalDataIncompleteFlushScheduledAt : 0,
      waitMs: LEGACY_HOME_HISTORY_UPLOAD_SOFT_WAIT_MS,
      stableSnapshot: snapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }
  clearLegacyLocalDataIncompleteFlushTimer();
  legacyLocalDataIncompleteFlushKey = flushKey;
  legacyLocalDataIncompleteFlushScheduledAt = Date.now();
  appendAwarenessDiagnosticLog('legacy-local-data-incomplete-flush-scheduled', {
    protocol,
    trigger,
    waitMs: LEGACY_HOME_HISTORY_UPLOAD_SOFT_WAIT_MS,
    stableSnapshot: snapshot,
    snapshot: getAwarenessConnectionSnapshot()
  });
  legacyLocalDataIncompleteFlushTimer = setTimeout(() => {
    legacyLocalDataIncompleteFlushTimer = null;
    legacyLocalDataIncompleteFlushKey = '';
    legacyLocalDataIncompleteFlushScheduledAt = 0;
    const latestSnapshot = getLegacyLocalDataStableSnapshot();
    const historyReadActive = Boolean(legacyHomeHistoryReadInFlight.value || legacyHomeHistoryReadPromise);
    const historyReadElapsedMs = legacyHomeHistoryReadStartedAt > 0 ? Date.now() - legacyHomeHistoryReadStartedAt : 0;
    const uploadableCount = getLegacyLocalDataUploadableCount(latestSnapshot);
    appendAwarenessDiagnosticLog('legacy-local-data-incomplete-flush-timer-fired', {
      protocol,
      trigger,
      waitMs: LEGACY_HOME_HISTORY_UPLOAD_SOFT_WAIT_MS,
      initialSnapshot: snapshot,
      historyReadActive,
      historyReadElapsedMs,
      uploadableCount,
      stableSnapshot: latestSnapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    if (historyReadActive) {
      appendAwarenessDiagnosticLog('legacy-local-data-incomplete-flush-timer-deferred-during-history-read', {
        protocol,
        trigger,
        reason: 'history-read-active-defer-until-terminal',
        historyReadElapsedMs,
        uploadableCount,
        initialSnapshot: snapshot,
        stableSnapshot: latestSnapshot,
        snapshot: getAwarenessConnectionSnapshot()
      });
      scheduleLegacyLocalDataIncompleteFlush(`${trigger}:history-read-active`, protocol);
      return;
    }
    requestLegacyLocalDataTimeoutFlush(`${trigger}:incomplete-idle`, protocol, latestSnapshot);
  }, LEGACY_HOME_HISTORY_UPLOAD_SOFT_WAIT_MS);
};

const requestOrScheduleLegacyLocalDataIncompleteFlush = (trigger: string, protocol: string) => {
  const snapshot = getLegacyLocalDataStableSnapshot();
  if (!hasLegacyLocalDataUploadableSnapshot(snapshot)) return false;
  if (snapshot.completed === true) {
    const flushKey = getLegacyLocalDataIncompleteFlushKey(snapshot);
    const now = Date.now();
    if (
      legacyLocalDataCompletedFastPathKey === flushKey &&
      legacyLocalDataCompletedFastPathRequestedAt > 0 &&
      now - legacyLocalDataCompletedFastPathRequestedAt < LEGACY_LOCAL_DATA_TIMEOUT_FLUSH_DEDUP_MS
    ) {
      appendAwarenessDiagnosticLog('legacy-local-data-incomplete-flush-fast-path-skip', {
        protocol,
        trigger,
        reason: 'same-completed-snapshot-recently-dispatched',
        elapsedMs: now - legacyLocalDataCompletedFastPathRequestedAt,
        dedupMs: LEGACY_LOCAL_DATA_TIMEOUT_FLUSH_DEDUP_MS,
        stableSnapshot: snapshot,
        snapshot: getAwarenessConnectionSnapshot()
      });
      return true;
    }
    legacyLocalDataCompletedFastPathKey = flushKey;
    legacyLocalDataCompletedFastPathRequestedAt = now;
    legacyLocalDataStableReadyAt = Date.now();
    legacyLocalDataStableUploadScheduled = false;
    // A completed terminal snapshot is immutable and ready for HTTP. Provisional
    // watcher ownership left by earlier Notify callbacks must not force it
    // through the 10s/15s stale-owner recovery path.
    const hasBlockingUploadTask = Boolean(legacyLocalDataUploadPromise || legacyLocalDataStablePromise);
    if (!hasBlockingUploadTask) {
      legacyLocalDataUploadWatcherActive = false;
      legacyLocalDataUploadWatcherActiveAt = 0;
      legacyLocalDataUploadWatcherPending = false;
    }
    // A completed history read still has to cross the HTTP upload boundary.
    // Keep a pending edge when the watcher is already running so its finally
    // block replays this terminal snapshot instead of silently dropping it.
    legacyLocalDataUploadWatcherPending = legacyLocalDataUploadWatcherActive;
    legacyLocalDataStableWaitStartedAt = 0;
    appendAwarenessDiagnosticLog('legacy-local-data-incomplete-flush-fast-path', {
      protocol,
      trigger,
      reason: 'history-completed-uploadable-snapshot',
      stableSnapshot: snapshot,
      releasedProvisionalWatcher: !hasBlockingUploadTask,
      snapshot: getAwarenessConnectionSnapshot()
    });
    setTimeout(() => {
      legacyHomeHistoryReadCompletedTick.value = Date.now();
    }, 0);
    return true;
  }
  const historyReadElapsedMs = legacyHomeHistoryReadStartedAt > 0 ? Date.now() - legacyHomeHistoryReadStartedAt : 0;
  const historyReadActive = Boolean(legacyHomeHistoryReadInFlight.value || legacyHomeHistoryReadPromise);
  const uploadableCount = getLegacyLocalDataUploadableCount(snapshot);
  if (historyReadActive) {
    appendAwarenessDiagnosticLog('legacy-local-data-incomplete-flush-deferred-during-history-read', {
      protocol,
      trigger,
      reason: 'history-read-active-defer-until-terminal',
      historyReadElapsedMs,
      uploadableCount,
      stableSnapshot: snapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    scheduleLegacyLocalDataIncompleteFlush(`${trigger}:history-read-active`, protocol);
    return true;
  }
  scheduleLegacyLocalDataIncompleteFlush(trigger, protocol);
  return true;
};

const scheduleLegacyLocalDataUploadAfterStableWait = (trigger: string, protocol: string) => {
  if (shouldSkipLegacyLocalDataStableWait(trigger, protocol)) {
    userStore.updateUploadingStatus('2');
    userStore.updateIsSending(false);
    return;
  }
  const currentStableSnapshot = getLegacyLocalDataStableSnapshot();
  if (currentStableSnapshot.completed === true && hasLegacyLocalDataUploadableSnapshot(currentStableSnapshot)) {
    legacyLocalDataStableReadyAt = Date.now();
    legacyLocalDataStableUploadScheduled = false;
    legacyLocalDataUploadWatcherPending = legacyLocalDataUploadWatcherActive;
    legacyLocalDataStableWaitStartedAt = 0;
    appendAwarenessDiagnosticLog('legacy-local-data-stable-wait-completed-fast-path', {
      protocol,
      trigger,
      reason: 'history-completed-uploadable-snapshot',
      stableSnapshot: currentStableSnapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    setTimeout(() => {
      legacyHomeHistoryReadCompletedTick.value = Date.now();
    }, 0);
    return;
  }
  if (legacyLocalDataStableUploadScheduled || legacyLocalDataStablePromise) {
    const stableWaitElapsedMs = legacyLocalDataStableWaitStartedAt > 0 ? Date.now() - legacyLocalDataStableWaitStartedAt : 0;
    const stableSnapshot = getLegacyLocalDataStableSnapshot();
    if (stableWaitElapsedMs >= LEGACY_LOCAL_DATA_STABLE_BLOCK_STALE_MS && hasLegacyLocalDataUploadableSnapshot(stableSnapshot)) {
      appendAwarenessDiagnosticLog('legacy-local-data-stable-wait-stale-flush', {
        protocol,
        trigger,
        stableWaitElapsedMs,
        staleMs: LEGACY_LOCAL_DATA_STABLE_BLOCK_STALE_MS,
        stableSnapshot,
        snapshot: getAwarenessConnectionSnapshot()
      });
      legacyLocalDataStablePromise = null;
      legacyLocalDataStableUploadScheduled = false;
      legacyLocalDataStableWaitStartedAt = 0;
      requestLegacyLocalDataTimeoutFlush(`${trigger}:stable-wait-stale`, protocol, stableSnapshot);
      return;
    }
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
      if (shouldSkipLegacyLocalDataStableWait(`${trigger}:stable-ready`, protocol)) {
        userStore.updateUploadingStatus('2');
        userStore.updateIsSending(false);
        return;
      }
      legacyLocalDataStableReadyAt = Date.now();
      legacyLocalDataStableUploadScheduled = false;
      legacyLocalDataUploadWatcherPending = false;
      setTimeout(() => {
        legacyHomeHistoryReadCompletedTick.value = Date.now();
      }, 0);
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
      const pendingSnapshot = getLegacyLocalDataStableSnapshot();
      const shouldFlushPending =
        legacyLocalDataUploadWatcherPending &&
        hasLegacyLocalDataUploadableSnapshot(pendingSnapshot) &&
        !isLegacyLocalDataTerminalSkipReason(getLegacyLocalDataStableSkipReason(pendingSnapshot));
      legacyLocalDataStableUploadScheduled = false;
      if (shouldFlushPending) {
        legacyLocalDataStableReadyAt = Date.now();
        legacyLocalDataUploadWatcherPending = false;
        appendAwarenessDiagnosticLog('legacy-local-data-stable-wait-finally-flush', {
          protocol,
          trigger,
          reason: 'pending-uploadable-snapshot',
          stableSnapshot: pendingSnapshot,
          snapshot: getAwarenessConnectionSnapshot()
        });
        setTimeout(() => {
          legacyHomeHistoryReadCompletedTick.value = Date.now();
        }, 0);
      }
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
    'sleepRawCount',
    'sleepStateCount',
    'healthSleepStateCount',
    'sleepAcceptedCount',
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
  let payload = response as Record<string, any>;
  // submitData returns the business payload directly, while the common HTTP
  // client used by summary/finalize can preserve one or two response wrappers.
  // Unwrap only object-shaped `data` envelopes and cap the depth defensively.
  for (let depth = 0; depth < 3; depth += 1) {
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) break;
    payload = payload.data as Record<string, any>;
  }
  return payload;
};
const getSubmitDataResponseNumber = (response: unknown, field: string) => {
  const payload = getSubmitDataResponsePayload(response);
  const value = payload?.[field] ?? (response && typeof response === 'object' ? (response as Record<string, any>)[field] : undefined);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};
const getSubmitDataResponseSleepAcceptedCount = (response: unknown) => {
  const acceptedCount = getSubmitDataResponseNumber(response, 'sleepAcceptedCount');
  if (typeof acceptedCount === 'number') {
    return acceptedCount;
  }
  const candidates = [
    getSubmitDataResponseNumber(response, 'sleepRawCount'),
    getSubmitDataResponseNumber(response, 'sleepStateCount'),
    getSubmitDataResponseNumber(response, 'healthSleepStateCount'),
    getSubmitDataResponseNumber(response, 'sleepCount')
  ].filter((value): value is number => typeof value === 'number');
  return candidates.length > 0 ? Math.max(...candidates) : undefined;
};
const isSubmitDataResponseSuccessful = (response: unknown) => {
  const payload = getSubmitDataResponsePayload(response);
  if (!payload) return true;
  if (payload.success === false) return false;
  const code = Number(payload.code);
  return !Number.isFinite(code) || code === 0 || code === 200;
};
const PENDING_PARSED_UPLOAD_RETRY_DELAY_MS = 1500;
const PENDING_PARSED_UPLOAD_RETRY_THROTTLE_MS = 30000;
const PENDING_PARSED_UPLOAD_RETRY_TIMEOUT_MS = 15000;
const PENDING_PARSED_SUMMARY_FINALIZE_RETRY_DELAYS_MS = [0, 1200, 2500, 5000] as const;

const schedulePendingParsedSummaryFinalize = (
  reason: string,
  session: Record<string, any>,
  summaryDates: string[]
) => {
  const deviceMac = String(session.deviceMac || '').trim();
  const uploadSessionId = String(session.uploadSessionId || '').trim();
  const dates = [...new Set(summaryDates.map((value) => String(value || '').trim().slice(0, 10)))]
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (!deviceMac || !uploadSessionId || dates.length === 0) {
    appendAwarenessDiagnosticLog('pending-parsed-upload-summary-finalize-skip', {
      reason,
      uploadSessionId,
      deviceMac,
      summaryDates: dates,
      skipReason: !deviceMac ? 'missing-device-mac' : !uploadSessionId ? 'missing-upload-session-id' : 'missing-summary-dates'
    });
    return;
  }

  const taskKey = `${normalizeDeviceSyncMac(deviceMac)}:${uploadSessionId}`;
  if (pendingParsedSummaryFinalizeTasks.has(taskKey)) {
    appendAwarenessDiagnosticLog('pending-parsed-upload-summary-finalize-reuse', {
      reason,
      uploadSessionId,
      deviceMac,
      summaryDates: dates,
      taskKey
    });
    return;
  }

  const task = (async () => {
    for (let attempt = 0; attempt < PENDING_PARSED_SUMMARY_FINALIZE_RETRY_DELAYS_MS.length; attempt += 1) {
      const retryDelayMs = PENDING_PARSED_SUMMARY_FINALIZE_RETRY_DELAYS_MS[attempt];
      if (retryDelayMs > 0) await waitForAwarenessMs(retryDelayMs);
      const startedAt = Date.now();
      try {
        appendAwarenessDiagnosticLog('pending-parsed-upload-summary-finalize-start', {
          reason,
          uploadSessionId,
          deviceMac,
          summaryDates: dates,
          attempt: attempt + 1,
          retryDelayMs
        });
        const response = await finalizeDataSyncSummary(
          { deviceMac, uploadSessionId, dates },
          { timeout: 12000, custom: { toast: false, catch: true } }
        );
        const summaryReady = isSummaryFinalizeResponseReady(response);
        appendAwarenessDiagnosticLog('pending-parsed-upload-summary-finalize-result', {
          reason,
          uploadSessionId,
          deviceMac,
          summaryDates: dates,
          attempt: attempt + 1,
          elapsedMs: Date.now() - startedAt,
          summaryReady
        });
        if (!summaryReady) continue;

        const retrySessionMac = normalizeDeviceSyncMac(deviceMac);
        const visibleDeviceMac = normalizeDeviceSyncMac(
          getAwarenessActiveHomeSyncMac() || getAwarenessCanonicalDeviceMac() || ''
        );
        if (retrySessionMac && retrySessionMac === visibleDeviceMac) {
          // This is the sole data-visible edge for a compensated upload.  The
          // upload and summary work stay detached from the foreground sync
          // state; the final refresh remains deduplicated by device/date.
          scheduleAwarenessAfterDataProcessed('pending-parsed-upload-retry-upload-complete-summary-ready');
        } else {
          appendAwarenessDiagnosticLog('pending-parsed-upload-summary-refresh-skipped', {
            reason,
            uploadSessionId,
            retrySessionMac,
            visibleDeviceMac,
            summaryDates: dates
          });
        }
        return;
      } catch (error) {
        appendAwarenessDiagnosticLog('pending-parsed-upload-summary-finalize-failed', {
          reason,
          uploadSessionId,
          deviceMac,
          summaryDates: dates,
          attempt: attempt + 1,
          elapsedMs: Date.now() - startedAt,
          error: formatAwarenessUploadRequestError(error)
        });
      }
    }

    appendAwarenessDiagnosticLog('pending-parsed-upload-summary-finalize-deferred', {
      reason,
      uploadSessionId,
      deviceMac,
      summaryDates: dates,
      attemptCount: PENDING_PARSED_SUMMARY_FINALIZE_RETRY_DELAYS_MS.length,
      behavior: 'keep-last-complete-overview'
    });
  })().finally(() => {
    pendingParsedSummaryFinalizeTasks.delete(taskKey);
  });
  pendingParsedSummaryFinalizeTasks.set(taskKey, task);
};

const runPendingParsedUploadRetry = async (reason: string) => {
  if (pendingParsedUploadRetryPromise) return pendingParsedUploadRetryPromise;
  if (legacyLocalDataUploadPromise) {
    schedulePendingParsedUploadRetry(`${reason}:active-upload`, PENDING_PARSED_UPLOAD_RETRY_DELAY_MS);
    return;
  }
  const now = Date.now();
  // A foreground-budget handoff is the continuation of the current upload,
  // not a new retry source. It must not be swallowed by a previous global
  // throttle timestamp. For ordinary triggers, preserve throttling but always
  // re-arm the timer at the exact eligible time instead of returning forever.
  const bypassRetryThrottle =
    reason.includes('foreground-budget-background-continue') ||
    reason.includes('http-failed-auto-retry') ||
    reason.includes('http-retry');
  const throttleRemainingMs = Math.max(
    0,
    PENDING_PARSED_UPLOAD_RETRY_THROTTLE_MS - (now - pendingParsedUploadRetryLastAt)
  );
  if (!bypassRetryThrottle && throttleRemainingMs > 0) {
    appendAwarenessDiagnosticLog('pending-parsed-upload-retry-throttled', {
      reason,
      throttleRemainingMs,
      retryThrottleMs: PENDING_PARSED_UPLOAD_RETRY_THROTTLE_MS
    });
    schedulePendingParsedUploadRetry(`${reason}:throttle-wait`, throttleRemainingMs + 50);
    return;
  }
  pendingParsedUploadRetryLastAt = now;
  pendingParsedUploadRetryPromise = (async () => {
    const currentUserId = getAwarenessHomeSyncUserId();
    const allSessions = listPendingUploadSessions<Record<string, any>>({ includeDeferred: true }).filter((session) => {
      const sessionUserId = String(session.dataUserId ?? session.userId ?? '');
      return !sessionUserId || currentUserId === 'anonymous' || sessionUserId === currentUserId;
    });
    const now = Date.now();
    const sessions = allSessions.filter((session) => Number(session.nextDataRetryAt || 0) <= now);
    if (sessions.length === 0 && allSessions.length > 0) {
      const nextRetryAt = Math.min(...allSessions.map((session) => Number(session.nextDataRetryAt || now)));
      const remainingMs = Math.max(0, nextRetryAt - now);
      appendAwarenessDiagnosticLog('pending-parsed-upload-retry-deferred', {
        reason,
        deferredSessionCount: allSessions.length,
        nextRetryAt,
        remainingMs
      });
      schedulePendingParsedUploadRetry(`${reason}:next-retry-at`, remainingMs + 50);
      return;
    }
    if (sessions.length === 0) return;
    appendAwarenessDiagnosticLog('pending-parsed-upload-retry-start', {
      reason,
      sessionCount: sessions.length
    });
    for (const session of sessions) {
      const acceptedBookkeepingRecords: SyncData[] = [];
      const uploadSummaryDates = new Set<string>();
      let acceptedBookkeepingBatchCount = 0;
      let latestBackendAckTimestamp = 0;
      try {
        const totalRecordCount = session.dataList.length;
        const fallbackSummaryDates = getSubmitDataRecordTouchedDates(
          session.dataList as Array<Record<string, any>>
        );
        const batches = chunkLegacySubmitData(session.dataList as SyncData[], LEGACY_LOCAL_DATA_SUBMIT_BATCH_SIZE);
        let acceptedRecordCount = 0;
        let latestAckPersistence: Promise<unknown> = Promise.resolve();
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          const batch = batches[batchIndex];
          const batchId = buildUploadBatchId(session.uploadSessionId, session.deviceMac, batchIndex, batch);
          const syncMeta = buildParsedDataUploadBatchSyncMeta(session, batchIndex, batches.length);
          const batchStartedAt = Date.now();
          let batchRequestTask: { abort?: () => void } | null = null;
          const response = await withAwarenessSoftTimeout(
            `pending-parsed-upload-retry:${batchIndex + 1}/${batches.length}`,
            PENDING_PARSED_UPLOAD_RETRY_TIMEOUT_MS + 1000,
            () => submitData(
              {
                deviceMac: session.deviceMac,
                batchId,
                dataList: batch,
                ...syncMeta
              },
              {
                timeout: PENDING_PARSED_UPLOAD_RETRY_TIMEOUT_MS,
                custom: { toast: false, catch: true },
                onTiming: (phase: string, detail: Record<string, unknown> = {}) => {
                  appendAwarenessDiagnosticLog('pending-parsed-upload-retry-request-timing', {
                    reason,
                    uploadSessionId: session.uploadSessionId,
                    deviceMac: session.deviceMac,
                    batchIndex: batchIndex + 1,
                    batchCount: batches.length,
                    phase,
                    batchElapsedMs: Date.now() - batchStartedAt,
                    requestTiming: detail,
                    hasRequestTask: !!batchRequestTask
                  });
                },
                getTask: (task: { abort?: () => void } | null) => {
                  batchRequestTask = task;
                }
              }
            ),
            () => {
              appendAwarenessDiagnosticLog('pending-parsed-upload-retry-soft-timeout', {
                reason,
                uploadSessionId: session.uploadSessionId,
                deviceMac: session.deviceMac,
                batchIndex: batchIndex + 1,
                batchCount: batches.length,
                elapsedMs: Date.now() - batchStartedAt,
                timeoutMs: PENDING_PARSED_UPLOAD_RETRY_TIMEOUT_MS + 1000,
                hasRequestTask: !!batchRequestTask,
                willAbort: true
              });
              try {
                batchRequestTask?.abort?.();
              } catch {
                // Pending data remains durable and resumes on the next eligible edge.
              }
            }
          );
          appendAwarenessDiagnosticLog('pending-parsed-upload-retry-batch-callback-enter', {
            reason,
            uploadSessionId: session.uploadSessionId,
            deviceMac: session.deviceMac,
            batchIndex: batchIndex + 1,
            batchCount: batches.length,
            batchElapsedMs: Date.now() - batchStartedAt
          });
          if (!isSubmitDataResponseSuccessful(response)) {
            throw new Error('pending parsed upload rejected by backend');
          }
          getSubmitDataResponseTouchedDates(response).forEach((date) => uploadSummaryDates.add(date));
          const ackParseStartedAt = Date.now();
          const batchAck = requireSubmitDataBatchAck(response, batchId, batch.length);
          const ackResult = acknowledgePendingUploadBatchDeferred(session, batchAck.acceptedCount, response);
          latestAckPersistence = ackResult.persistence;
          acceptedBookkeepingRecords.push(...batch);
          acceptedBookkeepingBatchCount += 1;
          acceptedRecordCount += batchAck.acceptedCount;
          latestBackendAckTimestamp = Math.max(latestBackendAckTimestamp, batchAck.acceptedThrough);
          appendAwarenessDiagnosticLog('pending-parsed-upload-retry-batch-result', {
            reason,
            uploadSessionId: session.uploadSessionId,
            deviceMac: session.deviceMac,
            batchIndex: batchIndex + 1,
            batchCount: batches.length,
            batchId,
            batchSize: batch.length,
            acceptedRecordCount,
            remainingRecordCount: Math.max(0, totalRecordCount - acceptedRecordCount),
            backendAckTimestamp: batchAck.acceptedThrough,
            ackAndDispatchElapsedMs: Date.now() - ackParseStartedAt
          });
        }
        if (uploadSummaryDates.size === 0 && fallbackSummaryDates.length > 0) {
          fallbackSummaryDates.forEach((date) => uploadSummaryDates.add(date));
          appendAwarenessDiagnosticLog('pending-parsed-upload-summary-dates-fallback', {
            reason,
            uploadSessionId: session.uploadSessionId,
            deviceMac: session.deviceMac,
            summaryDates: fallbackSummaryDates,
            recordCount: totalRecordCount
          });
        }
        const finalizationStartedAt = Date.now();
        await latestAckPersistence;
        const persistenceResult = await markPendingUploadDataDoneDeferred(session, {
          code: 200,
          backgroundRetry: true,
          batchCount: batches.length
        });
        if (acceptedBookkeepingRecords.length > 0) {
          void scheduleLegacyUploadPostAckBookkeeping(
            session.uploadSessionId,
            session.deviceMac,
            session.protocol || 'legacy',
            acceptedBookkeepingBatchCount,
            batches.length,
            acceptedBookkeepingRecords,
            latestBackendAckTimestamp
          );
        }
        appendAwarenessDiagnosticLog('pending-parsed-upload-retry-finalization-result', {
          reason,
          uploadSessionId: session.uploadSessionId,
          deviceMac: session.deviceMac,
          batchCount: batches.length,
          persistenceResult,
          elapsedMs: Date.now() - finalizationStartedAt
        });
        appendAwarenessDiagnosticLog('pending-parsed-upload-retry-result', {
          reason,
          uploadSessionId: session.uploadSessionId,
          deviceMac: session.deviceMac,
          recordCount: totalRecordCount,
          batchCount: batches.length,
          backendAckTimestamp: latestBackendAckTimestamp
        });
        const retrySessionMac = normalizeDeviceSyncMac(session.deviceMac || '');
        const visibleDeviceMac = normalizeDeviceSyncMac(
          getAwarenessActiveHomeSyncMac() || getAwarenessCanonicalDeviceMac() || ''
        );
        const retryTargetsVisibleDevice = Boolean(
          retrySessionMac && visibleDeviceMac && retrySessionMac === visibleDeviceMac
        );
        if (retryTargetsVisibleDevice) {
          if (activeAwarenessHomeSyncClaim || homeDataSyncing.value) {
            finishAwarenessHomeSyncWithoutHistoryCooldown('pending-parsed-upload-retry-upload-complete');
          }
        } else {
          appendAwarenessDiagnosticLog('pending-parsed-upload-retry-refresh-skipped', {
            reason,
            uploadSessionId: session.uploadSessionId,
            retrySessionMac,
            visibleDeviceMac
          });
        }
        // Every completed compensation upload must confirm its backend summary,
        // even if the user has already switched devices/pages. The helper only
        // refreshes home when this is still the visible device and summaryReady
        // is true; until then the last complete overview remains untouched.
        schedulePendingParsedSummaryFinalize(reason, session, [...uploadSummaryDates]);
      } catch (error) {
        if (acceptedBookkeepingRecords.length > 0) {
          void scheduleLegacyUploadPostAckBookkeeping(
            session.uploadSessionId,
            session.deviceMac,
            session.protocol || 'legacy',
            acceptedBookkeepingBatchCount,
            acceptedBookkeepingBatchCount,
            acceptedBookkeepingRecords,
            latestBackendAckTimestamp
          );
        }
        const failurePersistence = markPendingUploadDataFailedDeferred(session, error);
        appendAwarenessDiagnosticLog('pending-parsed-upload-retry-failed', {
          reason,
          uploadSessionId: session.uploadSessionId,
          deviceMac: session.deviceMac,
          error: error instanceof Error ? error.message : String(error || 'unknown error')
        });
        void failurePersistence.finally(() => {
          schedulePendingParsedUploadRetry(`${reason}:http-failed-auto-retry`, PENDING_PARSED_UPLOAD_RETRY_DELAY_MS);
        });
      }
    }
  })().finally(() => {
    pendingParsedUploadRetryPromise = null;
    scheduleAwarenessVisibleSyncReconcile(`pending-parsed-upload-retry-finished:${reason}`);
  });
  return pendingParsedUploadRetryPromise;
};
function schedulePendingParsedUploadRetry(reason: string, delayMs = PENDING_PARSED_UPLOAD_RETRY_DELAY_MS) {
  if (pendingParsedUploadRetryTimer) return;
  if (activeAwarenessHomeSyncClaim || homeDataSyncing.value) {
    // HTTP-only compensation is a background concern. It must never extend or
    // resurrect the foreground BLE "syncing" state after the history session
    // has released the page.
    homeSyncRunningInBackground.value = true;
    userStore.updateIsSending(false);
  }
  pendingParsedUploadRetryTimer = setTimeout(() => {
    pendingParsedUploadRetryTimer = null;
    void runPendingParsedUploadRetry(reason);
  }, delayMs);
}
const getLegacySleepNotIngestedParkKey = (deviceMac?: string, uploadSinceTimestamp?: number) => {
  const normalizedMac = normalizeDeviceSyncMac(deviceMac || '') || 'unknown';
  const since = Number(uploadSinceTimestamp || 0);
  return `${normalizedMac}:${Number.isFinite(since) && since > 0 ? since : 0}`;
};
const resetLegacySleepNotIngestedParkState = (key?: string) => {
  if (!key) return;
  legacySleepNotIngestedParkStates.delete(key);
};
const getLegacyLocalHistoryCacheParkDecisionAfterUpload = (
  submitMetricCounts: Record<string, number>,
  response: unknown,
  options: { key: string; nowMs?: number }
): LegacySleepCacheParkDecision => {
  const submittedSleepCount = Number(submitMetricCounts.sleep || 0);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const baseDecision = {
    key: options.key,
    count: 0,
    elapsedMs: 0,
    firstAt: nowMs,
    lastAt: nowMs,
    submittedSleepCount
  };
  if (submittedSleepCount <= 0) {
    return { ...baseDecision, keep: false, reason: 'no-sleep-record' };
  }
  const responseSleepAcceptedCount = getSubmitDataResponseSleepAcceptedCount(response);
  if (responseSleepAcceptedCount !== 0) {
    return {
      ...baseDecision,
      keep: false,
      reason: responseSleepAcceptedCount === undefined ? 'sleep-accepted-count-unknown' : 'sleep-accepted',
      responseSleepAcceptedCount
    };
  }

  const previous = legacySleepNotIngestedParkStates.get(options.key);
  const firstAt = previous?.firstAt || nowMs;
  const count = (previous?.count || 0) + 1;
  const elapsedMs = nowMs - firstAt;
  const keep = count <= LEGACY_LOCAL_SLEEP_CACHE_PARK_MAX_COUNT && elapsedMs <= LEGACY_LOCAL_SLEEP_CACHE_PARK_MAX_MS;
  legacySleepNotIngestedParkStates.set(options.key, { firstAt, lastAt: nowMs, count });
  return {
    key: options.key,
    keep,
    reason: keep ? 'sleep-not-ingested' : 'sleep-not-ingested-max-park-exceeded',
    count,
    elapsedMs,
    firstAt,
    lastAt: nowMs,
    submittedSleepCount,
    responseSleepAcceptedCount
  };
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
  const tapReceivedAt = Date.now();
  const route = homeDetailRoutes[key];
  const query = `selectedDayIndex=${selectedDayIndex.value}&selectedDate=${encodeURIComponent(getSelectedDetailDate())}`;
  const url = `${route}?${query}`;
  const navigationTarget = `home-detail:${url}`;
  appendAwarenessDiagnosticLog('home-detail-tap-received', {
    key,
    url,
    sameTargetInFlight: awarenessNavigationInFlightTargets.has(navigationTarget)
  });
  if (!claimAwarenessNavigationTarget(navigationTarget)) {
    appendAwarenessDiagnosticLog('home-detail-navigate-skip', {
      key,
      url,
      reason: 'same-target-navigation-in-flight'
    });
    return;
  }
  const startedAt = tapReceivedAt;
  const duplicateRetryDelays = [180, 420, 800];
  const dispatchNavigation = (attempt: number) => {
    let success = false;
    let failError = '';
    appendAwarenessDiagnosticLog('home-detail-navigate-start', { key, url, attempt });
    uni.navigateTo({
      url,
      success: () => {
        success = true;
        appendAwarenessDiagnosticLog('home-detail-navigate-success', {
          key,
          attempt,
          elapsedMs: Date.now() - startedAt
        });
      },
      fail: (error) => {
        failError = String((error as any)?.errMsg || error || '');
      },
      complete: (result) => {
        const resultText = String((result as any)?.errMsg || failError || '');
        appendAwarenessDiagnosticLog('home-detail-navigate-complete', {
          key,
          attempt,
          elapsedMs: Date.now() - startedAt,
          result: resultText
        });
        if (success || /navigateTo:ok/i.test(resultText)) {
          releaseAwarenessNavigationTarget(navigationTarget);
          return;
        }
        const duplicateIgnored = /duplicate navigation ignored/i.test(resultText);
        const retryDelayMs = duplicateRetryDelays[attempt];
        if (duplicateIgnored && retryDelayMs != null) {
          appendAwarenessDiagnosticLog('home-detail-navigate-retry-scheduled', {
            key,
            url,
            attempt,
            nextAttempt: attempt + 1,
            retryDelayMs,
            elapsedMs: Date.now() - startedAt
          });
          setTimeout(() => dispatchNavigation(attempt + 1), retryDelayMs);
          return;
        }
        releaseAwarenessNavigationTarget(navigationTarget);
        appendAwarenessDiagnosticLog('home-detail-navigate-fail', {
          key,
          attempt,
          elapsedMs: Date.now() - startedAt,
          error: resultText || 'navigateTo failed'
        });
        uni.showToast({ title: '页面加载失败，请稍后重试', icon: 'none' });
      }
    });
  };
  dispatchNavigation(0);
};
const getSubmitDataResponseTouchedDates = (response: unknown) => {
  const payload = getSubmitDataResponsePayload(response);
  const values = payload?.touchedDates ?? payload?.summaryDates;
  if (!Array.isArray(values)) return [] as string[];
  return values
    .map((value) => String(value || '').trim().slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
};
const getSubmitDataRecordTouchedDates = (records: Array<Record<string, any>> = []) => {
  const dates = new Set<string>();
  records.forEach((record) => {
    const timestamp = Number(getRingHistoryRecordSyncUnixTime(record));
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const date = new Date(timestamp * 1000);
    if (!Number.isFinite(date.getTime())) return;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dates.add(`${year}-${month}-${day}`);
  });
  return [...dates];
};
const isSummaryFinalizeResponseReady = (response: unknown) => {
  const payload = getSubmitDataResponsePayload(response);
  return payload?.summaryReady === true;
};
const openPeriodPage = (url: string) => {
  const targetUrl = String(url || '').trim();
  if (!targetUrl) return;
  const navigationTarget = `period:${targetUrl}`;
  if (!claimAwarenessNavigationTarget(navigationTarget)) {
    appendAwarenessDiagnosticLog('period-navigate-skip', {
      url: targetUrl,
      reason: 'same-target-navigation-in-flight'
    });
    return;
  }
  const startedAt = Date.now();
  appendAwarenessDiagnosticLog('period-navigate-start', { url: targetUrl });
  uni.navigateTo({
      url: targetUrl,
      success: () => {
        releaseAwarenessNavigationTarget(navigationTarget);
        appendAwarenessDiagnosticLog('period-navigate-success', {
          url: targetUrl,
          elapsedMs: Date.now() - startedAt
        });
      },
      fail: (error) => {
        releaseAwarenessNavigationTarget(navigationTarget);
        appendAwarenessDiagnosticLog('period-navigate-fail', {
          url: targetUrl,
          elapsedMs: Date.now() - startedAt,
          error: String((error as any)?.errMsg || error || '')
        });
        uni.showToast({ title: '页面加载失败，请稍后重试', icon: 'none' });
      },
      complete: () => {
        releaseAwarenessNavigationTarget(navigationTarget);
      }
    });
};
const getSubmitDataResponseBoolean = (response: unknown, field: string) => {
  const payload = getSubmitDataResponsePayload(response);
  const value = payload?.[field] ?? (response && typeof response === 'object' ? (response as Record<string, any>)[field] : undefined);
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return undefined;
};
const requireSubmitDataBatchAck = (response: unknown, expectedBatchId: string, expectedCount: number) => {
  const payload = getSubmitDataResponsePayload(response);
  const responseBatchId = String(payload?.batchId || '').trim();
  const acceptedCount = getSubmitDataResponseNumber(response, 'acceptedCount');
  const acceptedThrough = getSubmitDataResponseNumber(response, 'acceptedThrough');
  const hasGap = getSubmitDataResponseBoolean(response, 'hasGap');
  if (
    responseBatchId !== expectedBatchId ||
    acceptedCount !== expectedCount ||
    !acceptedThrough ||
    hasGap !== false
  ) {
    throw new Error(`data sync batch ack invalid: ${responseBatchId || 'missing'} ${acceptedCount ?? 'missing'}/${expectedCount}`);
  }
  return { acceptedCount, acceptedThrough, hasGap };
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
const sleepDurationMinutes = computed(() => {
  const overview = sleepOverviewObj.value as Record<string, any> | null | undefined;
  if (
    !overview ||
    !sleepOverviewConfirmedDate.value ||
    sleepOverviewConfirmedDate.value !== getAwarenessSelectedDateString()
  ) {
    return 0;
  }
  return getPlausibleHomeSleepDurationNumber(
    overview?.sleepDuration,
    overview?.sleepMinutes,
    overview?.sleepTotalMinutes,
    overview?.totalSleepMinutes,
    overview?.totalMinutes,
    overview?.asleepMinutes,
    overview?.duration,
    overview?.sleep_time
  );
});
const sleepScoreNumber = computed(() =>
  sleepOverviewConfirmedDate.value === getAwarenessSelectedDateString()
    ? getPositiveMetricNumber(sleepOverviewObj.value?.sleepScore)
    : 0
);
const sleepQualityText = computed(() => {
  const quality = sleepScoreNumber.value;
  if (!quality || quality < 0 || quality > 100) return '--';

  if (quality >= 0 && quality <= 20) return '\u8f83\u5dee';
  if (quality >= 21 && quality <= 40) return '\u5f85\u6539\u5584';
  if (quality >= 41 && quality <= 60) return '\u4e2d\u7b49';
  if (quality >= 61 && quality <= 80) return '\u826f\u597d';
  if (quality >= 81 && quality <= 100) return '\u4f18\u79c0';

  return '--';
});
const relaxStressNumber = computed(() =>
  getStressScoreNumber(
    stressDetailObj.value?.avgStressValue,
    stressSummaryObj.value?.todayStressScore,
    stressSummaryObj.value?.weekAvgStressScore,
    balanceScoreObj.value?.relaxScore,
    userStore.healthData?.stress,
    userStore.healthData?.stressIndex,
    userStore.latestMetrics?.stress,
    stressDetailObj.value?.stressValue
  )
);
const relaxStressLevel = computed(() =>
  getStressLevelNumber(
    stressDetailObj.value?.stressValue,
    stressDetailObj.value?.stressLevel,
    (stressSummaryObj.value as any)?.stressValue,
    (stressSummaryObj.value as any)?.stressLevel,
    userStore.healthData?.stressStatus,
    userStore.latestMetrics?.stressStatus
  )
);
const relaxStressValue = computed(() => (relaxStressNumber.value > 0 ? `${relaxStressNumber.value}` : '00'));
const relaxHasRealStressDetail = computed(() => {
  const detail = stressDetailObj.value as stressDetail | undefined;
  const chart = Array.isArray(detail?.stressChart) ? detail.stressChart : [];
  return chart.length > 0 || getStressScoreNumber(detail?.avgStressValue, detail?.stressValue) > 0;
});
const relaxLocalHeartRateProxyMeta = computed(() => {
  const bpm = getStressScoreNumber(vitalSignObj.value?.heartRateAvg, vitalSignObj.value?.heartRate);
  if (relaxHasRealStressDetail.value || bpm <= 0) return undefined;
  const statusText = bpm >= 90 ? '波动较大' : bpm >= 78 ? '略有波动' : '平稳';
  return {
    displayMode: 'proxy' as const,
    hrvSource: 'local_daily_heart_rate_pressure_proxy',
    proxyQuality: 20,
    statusText,
    tips: '基于平均心率趋势估算，仅供参考'
  };
});
const relaxStressProxyMeta = computed(() => {
  const detailMeta = stressDetailObj.value?.hrvDisplay;
  if (detailMeta?.displayMode === 'proxy') return detailMeta;
  const vitalMeta = (vitalSignObj.value as any)?.hrvDisplay;
  if (!relaxHasRealStressDetail.value && vitalMeta?.displayMode === 'proxy') return vitalMeta;
  return relaxLocalHeartRateProxyMeta.value || detailMeta || vitalMeta;
});
const relaxStressDisplayMode = computed(() => {
  const detail = stressDetailObj.value as stressDetail | undefined;
  if (relaxHasRealStressDetail.value) return 'real';
  if (detail?.pressureDisplayMode === 'proxy' || relaxStressProxyMeta.value?.displayMode === 'proxy') return 'proxy';
  if (detail?.pressureDisplayMode === 'empty' || relaxStressProxyMeta.value?.displayMode === 'empty') return 'empty';
  return detail?.pressureDisplayMode || relaxStressProxyMeta.value?.displayMode || 'real';
});
const relaxStressIsProxy = computed(() => relaxStressDisplayMode.value === 'proxy');
const relaxStressIsEmpty = computed(() => relaxStressDisplayMode.value === 'empty');
const relaxStressFallbackTip = computed(() => {
  return '';
});
const relaxStressStatus = computed(() => {
  if (relaxStressIsProxy.value) {
    const status =
      stressDetailObj.value?.pressureStatusText || relaxStressProxyMeta.value?.statusText || '平稳';
    if (status === '波动较大') return '压力偏高';
    if (status === '略有波动') return '正常状态';
    return '放松状态';
  }
  if (relaxStressIsEmpty.value) return '暂无压力趋势';
  return resolveStressDisplayStatus({
    detail: stressDetailObj.value,
    summary: stressSummaryObj.value,
    fallbackStatus: userStore.healthData?.stressStatus || userStore.latestMetrics?.stressStatus,
    score: relaxStressNumber.value,
    level: relaxStressLevel.value,
    fallbackText: '\u5e73\u7a33\u72b6\u6001'
  });
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
        ) || 300
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
  getHomeGoalNumber(['step', 'stepTarget', 'targetStep', 'stepsTarget'], motionOverviewObj.value?.targetStep) || 8000
);
const activityTargetCalorie = computed(() =>
  getHomeGoalNumber(['calorie', 'calorieTarget', 'targetCalorie', 'caloriesTarget', 'targetCalories'], motionOverviewObj.value?.targetCalorie) || 300
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
  return unifiedBattery.displayText.value || '';
});
const hasAwarenessBatteryDisplayValue = () => {
  const value = String(displayBatteryValue.value || '').trim();
  return Boolean(value && value !== '-' && value !== '--' && value !== '00');
};
const getAwarenessBatteryLogMac = () =>
  getBoundRingIdentity(ringBleDeviceInfo.value as Record<string, any> | null | undefined) ||
  getBoundRingIdentity(ringStore.deviceInfo as Record<string, any> | null | undefined) ||
  getBoundRingIdentity(userStore.deviceInfo as Record<string, any> | null | undefined) ||
  userStore.normalMac ||
  userStore.iosMacId ||
  '';
const getAwarenessRawBatteryValue = () =>
  unifiedBattery.rawValue.value;
const getAwarenessRawBatteryStatusValue = () =>
  unifiedBattery.status.value;
const hasAwarenessFreshBatteryDisplayValue = () => {
  const rawBattery = getAwarenessRawBatteryValue();
  const rawStatus = getAwarenessRawBatteryStatusValue();
  return getRawBatteryPercent(rawBattery) != null || isBatteryChargingLike(rawBattery, rawStatus);
};
function getAwarenessBatteryCacheRecord() {
  return readBatteryDisplayCache(getAwarenessHomeSyncUserId(), getAwarenessBatteryLogMac());
}
watch(
  () => {
    const rawBattery = getRawBatteryPercent(getAwarenessRawBatteryValue());
    const mac = getAwarenessBatteryLogMac();
    const userId = getAwarenessHomeSyncUserId();
    return rawBattery == null ? '' : `${userId}|${mac}|${Math.round(rawBattery)}`;
  },
  (signature) => {
    if (!signature) return;
    writeBatteryDisplayCache({
      userId: getAwarenessHomeSyncUserId(),
      mac: getAwarenessBatteryLogMac(),
      battery: getAwarenessRawBatteryValue(),
      status: getAwarenessRawBatteryStatusValue(),
      source: 'awareness-latest-battery'
    });
    void reportRealBatteryLog({
      userId: getAwarenessHomeSyncUserId(),
      mac: getAwarenessBatteryLogMac(),
      battery: getAwarenessRawBatteryValue(),
      source: 'awareness-latest-battery'
    });
  }
);
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
const AWARENESS_CONNECTED_STATUS_DWELL_MS = 350;
const awarenessConnectedStatusSettled = ref(false);
let awarenessConnectedStatusTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => hasAwarenessRuntimeCommunicationReady() && isAwarenessPageConnected(),
  (connected) => {
    if (awarenessConnectedStatusTimer) {
      clearTimeout(awarenessConnectedStatusTimer);
      awarenessConnectedStatusTimer = null;
    }
    if (!connected) {
      awarenessConnectedStatusSettled.value = false;
      return;
    }
    // BLE ready 与历史同步通常只差几十毫秒。保留一个很短的展示窗口，
    // 让用户能明确看到“已连接”后再进入“同步中”，但不延迟真实同步任务。
    awarenessConnectedStatusSettled.value = false;
    awarenessConnectedStatusTimer = setTimeout(() => {
      awarenessConnectedStatusTimer = null;
      awarenessConnectedStatusSettled.value = true;
    }, AWARENESS_CONNECTED_STATUS_DWELL_MS);
  },
  { immediate: true }
);
const bluetoothStatus = computed(() => {
  const runtimeReady = hasAwarenessRuntimeCommunicationReady();
  const hasStoredReadyClaim =
    !runtimeReady &&
    Boolean(
      userStore.isConnected === true ||
        ringStore.isConnected === true ||
        userStore.reconnectStatus === 'success' ||
        String(userStore.reconnectStatus || '') === '2' ||
        ringStore.reconnectStatus === 'success' ||
        String(ringStore.reconnectStatus || '') === '2'
    );
  const isConnecting =
    awarenessRuntimeConnectionPending.value ||
    hasStoredReadyClaim ||
    isRingConnectionConnecting({
      ready: runtimeReady,
      connected: runtimeReady && (userStore.isConnected === true || ringStore.isConnected === true),
      reconnectStatus: userStore.reconnectStatus || ringStore.reconnectStatus,
      isReconnecting: userStore.isReconnecting === true || ringStore.isReconnecting === true
    });
  const isConnected = runtimeReady && !isConnecting && isAwarenessPageConnected();
  const isDisconnected = !isConnecting && !isConnected;
  // 顶部表达用户看到的整条结果链路，而不是单独的 BLE 读取阶段。
  // 历史读取结束后，上传、汇总与概览渲染仍在后台进行；页面可以正常操作，
  // 但状态仍保持“同步中”，直到新数据已经渲染。固定为：
  // 未连接 -> 连接中 -> 已连接 -> 同步中 -> 电量 + 新数据。
  const isSyncing =
    isConnected &&
    awarenessConnectedStatusSettled.value &&
    Boolean(
      homeDataSyncing.value ||
        legacyHomeHistoryReadInFlight.value ||
        legacyHomeHistoryReadPromise ||
        homeDataRefreshingAfterSync.value ||
        homeFreshBatteryReadingAfterSync.value
    );

  return {
    isDisconnected,
    isConnecting,
    isConnected,
    isSyncing,


    statusText: isConnecting ? '\u8fde\u63a5\u4e2d' : '',
    syncingText: isSyncing ? '\u540c\u6b65\u4e2d' : '',
    // Runtime ready is already a real connection.  Until the deferred device
    // info task returns the battery, keep an explicit connected state instead
    // of rendering an empty label between refresh and battery.
    batteryText: isConnected ? displayBatteryValue.value || '\u5df2\u8fde\u63a5' : '',


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
  if (hasAwarenessRuntimeCommunicationReady()) {
    userStore.updateIsConnected(true);
    userStore.updateReconnectingStatus('2');
    appendAwarenessDiagnosticLog('restore-skip-already-ready', {
      snapshot: getAwarenessConnectionSnapshot()
    });
    return true;
  }
  awarenessRuntimeConnectionPending.value = true;
  try {
    userStore.updateUploadingStatus('0');
    userStore.updateReconnectingStatus('1');
    const restored = await autoConnectLastDevice();
    if (!restored) {
      userStore.updateIsConnected(false);
      userStore.updateReconnectingStatus('0');
      appendAwarenessDiagnosticLog('restore-result', {
        restored: false,
        ready: hasAwarenessRuntimeCommunicationReady(),
        snapshot: getAwarenessConnectionSnapshot()
      });
      return false;
    }
    if (!hasAwarenessRuntimeCommunicationReady()) {
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
        })
      ) {
        dispatchAwarenessHomeSyncWhenReady('restore-ready');
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
  } finally {
    awarenessRuntimeConnectionPending.value = false;
  }
}

watch(
  () => userStore.reconnectResult,
  async (newValue, oldValue) => {
    if (newValue === true) {
      let runtimeReady = hasAwarenessRuntimeCommunicationReady();
      if (!runtimeReady && hasAwarenessCommunicationReady()) {
        appendAwarenessDiagnosticLog('reconnect-result-runtime-restore-start', {
          snapshot: getAwarenessConnectionSnapshot()
        });
        awarenessRuntimeConnectionPending.value = true;
        try {
          runtimeReady = Boolean(await ensureCommunicationReady().catch((error) => {
            appendAwarenessDiagnosticLog('reconnect-result-runtime-restore-failed', {
              message: error instanceof Error ? error.message : String(error),
              snapshot: getAwarenessConnectionSnapshot()
            });
            return false;
          })) && hasAwarenessRuntimeCommunicationReady();
        } finally {
          awarenessRuntimeConnectionPending.value = false;
        }
      }

      if (runtimeReady) {
        userStore.updateIsConnected(true);
        userStore.updateReconnectingStatus('2');
        const reconnectHistoryCooldown = getLegacyHomeCommunicationFailureCooldown(
          getAwarenessCanonicalDeviceMac()
        );
        // Generic ready callbacks do not prove a new physical connection.
        // The runtime-ready watcher advances the generation only after an
        // actual false -> true transition, which is the sole retry boundary.
        if (!isAwarenessRwRing()) {
          const closedUploadSession = getClosedLegacyLocalDataUploadSessionForCurrentForeground();
          if (closedUploadSession) {
            resetLegacyLocalDataUploadWatcherState(
              'reconnect-result-ready-upload-session-closed',
              userStore.deviceInfo?.protocol || ringStore.deviceInfo?.protocol || 'legacy',
              {
              deviceMac: getAwarenessCanonicalDeviceMac(),
              uploadedUntil: closedUploadSession.uploadedUntil,
              completedAt: closedUploadSession.completedAt,
              uploadSessionKey: closedUploadSession.uploadSessionKey
              }
            );
            appendAwarenessDiagnosticLog('reconnect-result-ready-sync-skip', {
              reason: 'same-foreground-upload-session-closed',
              deviceMac: getAwarenessCanonicalDeviceMac(),
              uploadedUntil: closedUploadSession.uploadedUntil,
              uploadSessionKey: closedUploadSession.uploadSessionKey,
              snapshot: getAwarenessConnectionSnapshot()
            });
          } else if (reconnectHistoryCooldown.active) {
            appendAwarenessDiagnosticLog('reconnect-result-ready-sync-skip', {
              reason: 'physical-disconnect-history-cooldown',
              deviceMac: reconnectHistoryCooldown.deviceMac,
              remainingMs: reconnectHistoryCooldown.remainingMs,
              snapshot: getAwarenessConnectionSnapshot()
            });
          } else if (
            validateAwarenessHomeSyncContext('reconnect-result-ready-precheck', {
              requireReady: true,
              allowMissingCurrent: false
            })
          ) {
            appendAwarenessDiagnosticLog('reconnect-result-ready-sync-dispatch', {
              snapshot: getAwarenessConnectionSnapshot()
            });
            dispatchAwarenessHomeSyncWhenReady('reconnect-result-ready');
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
        appendAwarenessDiagnosticLog('reconnect-result-runtime-not-ready', {
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
        const skipRestoreIfSyncActive = (trigger: string) => {
          const syncActive = Boolean(awarenessRefreshPromise || isAwarenessBackgroundDataSyncInProgress());
          if (!syncActive) return false;
          appendAwarenessDiagnosticLog('bluetooth-ready-restore-skip', {
            trigger,
            reason: 'home-sync-or-history-active',
            hasAwarenessRefreshPromise: Boolean(awarenessRefreshPromise),
            backgroundSyncing: isAwarenessBackgroundDataSyncInProgress(),
            snapshot: getAwarenessConnectionSnapshot()
          });
          return true;
        };
        const runtimeDevice = (ringStore.deviceInfo || {}) as Record<string, any>;
        const deviceId = String(runtimeDevice.deviceId || '').trim();
        const serviceId = String(runtimeDevice.serviceId || '').trim();
        if (hasAwarenessCommunicationReady() && deviceId && serviceId) {

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
                  })
                ) {
                  dispatchAwarenessHomeSyncWhenReady('bluetooth-ready-already-connected');
                }
              } else {
                appendAwarenessDiagnosticLog('bluetooth-ready-rw-home-sync-started', {
                  snapshot: getAwarenessConnectionSnapshot()
                });
                void syncRwHomeHistoryAndRefreshOverview(formatLocalDate(new Date()), 'bluetooth-ready-already-connected');
              }
            } else {
              if (skipRestoreIfSyncActive('already-connected-not-ready')) return;
              await restoreAwarenessDeviceSnapshot();
            }
            return;
          }

          if (skipRestoreIfSyncActive('known-runtime-not-connected')) return;
          await restoreAwarenessDeviceSnapshot();
        } else {
          let res: any = null;
          try {
            res = await getBindInfo();
          } catch {
            res = null;
          }
          if (hasBoundRingIdentity(res)) {
            if (skipRestoreIfSyncActive('bound-identity-no-runtime')) return;
            await restoreAwarenessDeviceSnapshot();
          } else {
            if (skipRestoreIfSyncActive('no-bound-identity-fallback')) return;
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
    const watchContextState = getAwarenessHomeSyncContextState(activeUploadDeviceMac);
    if (!isRwRing && activeUploadDeviceMac && watchContextState.mismatch) {
      appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
        protocol,
        reason: 'active-sync-device-mismatch',
        activeMac: activeUploadDeviceMac,
        deviceMac: uploadDeviceMacAtStart,
        currentMac: watchContextState.currentMac,
        expectedMac: watchContextState.expectedMac,
        localDataLength: Array.isArray(local.value) ? local.value.length : 0,
        snapshot: getAwarenessConnectionSnapshot()
      });
      userStore.updateUploadingStatus('2');
      userStore.updateIsSending(false);
      legacyLocalDataUploadWatcherPending = false;
      return;
    }
    if (!isRwRing && (legacyHomeHistoryReadInFlight.value || legacyHomeHistoryReadPromise)) {
      const now = Date.now();
      const historyReadElapsedMs = legacyHomeHistoryReadStartedAt > 0 ? now - legacyHomeHistoryReadStartedAt : 0;
      // History Notify can update localData many times in one read. Building the
      // complete normalize/dedupe/upload batch for every partial update creates
      // quadratic work on the mini-program JS thread and delays taps/timers long
      // after BLE has already finished. The terminal tick below owns the single
      // full build, so this branch must remain count-only and allocation-light.
      legacyLocalDataUploadWatcherPending = true;
      legacyLocalDataUploadWatcherActive = false;
      legacyLocalDataUploadWatcherActiveAt = 0;
      if (now - legacyLocalDataActiveHistoryDeferredLogAt >= 1000) {
        legacyLocalDataActiveHistoryDeferredLogAt = now;
        appendAwarenessDiagnosticLog('legacy-local-data-upload-deferred-during-history-read', {
          protocol,
          reason: 'history-read-active-terminal-build-only',
          historyReadElapsedMs,
          receivedDataLength: Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0,
          localDataLength: Array.isArray(local.value) ? local.value.length : 0,
          hasLegacyHomeHistoryReadPromise: Boolean(legacyHomeHistoryReadPromise),
          legacyHomeHistoryReadInFlight: legacyHomeHistoryReadInFlight.value
        });
      }
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
        if (tryCloseLegacyLocalDataTerminalSkip(terminalSnapshot, terminalSkipReason, 'legacy-local-data-watch', protocol)) {
          legacyLocalDataUploadWatcherPending = false;
          return;
        }
      }
    }

    if (!isRwRing) {
      const cooldownSnapshot = getLegacyLocalDataStableSnapshot();
      const hasPendingUpload = hasLegacyLocalDataUploadableSnapshot(cooldownSnapshot);
      if (isAwarenessHomeSyncInCooldown('legacy-local-data-watch')) {
        // Cooldown prevents another BLE history read. It must never discard
        // the completed snapshot produced by the current/previous read.
        if (!hasPendingUpload) {
          userStore.updateUploadingStatus('2');
          userStore.updateIsSending(false);
          legacyLocalDataUploadWatcherPending = false;
          return;
        }
        appendAwarenessDiagnosticLog('legacy-local-data-upload-continue-during-home-sync-cooldown', {
          protocol,
          stableSnapshot: cooldownSnapshot,
          snapshot: getAwarenessConnectionSnapshot()
        });
      }
    }

    // if (userStore.localData.length > lastLocalDataLength) {
    //   uni.showLoading({

    //     mask: true
    //   });
    // }
    lastLocalDataLength = userStore.localData.length;

    if (!isRwRing && legacyLocalDataUploadWatcherActive) {
      const watcherActiveElapsedMs = legacyLocalDataUploadWatcherActiveAt > 0 ? Date.now() - legacyLocalDataUploadWatcherActiveAt : 0;
      const stableWaitElapsedMs = legacyLocalDataStableWaitStartedAt > 0 ? Date.now() - legacyLocalDataStableWaitStartedAt : 0;
      const staleStableWaitSnapshot = getLegacyLocalDataStableSnapshot();
      if (
        stableWaitElapsedMs >= LEGACY_LOCAL_DATA_STABLE_BLOCK_STALE_MS &&
        hasLegacyLocalDataUploadableSnapshot(staleStableWaitSnapshot)
      ) {
        appendAwarenessDiagnosticLog('legacy-local-data-upload-active-stable-wait-stale-reset', {
          protocol,
          watcherActiveElapsedMs,
          stableWaitElapsedMs,
          staleMs: LEGACY_LOCAL_DATA_STABLE_BLOCK_STALE_MS,
          stableSnapshot: staleStableWaitSnapshot,
          snapshot: getAwarenessConnectionSnapshot()
        });
        legacyLocalDataStablePromise = null;
        legacyLocalDataStableUploadScheduled = false;
        legacyLocalDataStableWaitStartedAt = 0;
        legacyLocalDataUploadWatcherActive = false;
        legacyLocalDataUploadWatcherActiveAt = 0;
        legacyLocalDataUploadWatcherPending = false;
        requestLegacyLocalDataTimeoutFlush('legacy-local-data-upload-active-stable-wait-stale', protocol, staleStableWaitSnapshot);
      }
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
      const timeoutFlushSnapshot = !isRwRing ? getLegacyLocalDataStableSnapshot() : null;
      const allowTimeoutPartialUpload = Boolean(
        !isRwRing && timeoutFlushSnapshot && isLegacyLocalDataTimeoutFlushAllowed(timeoutFlushSnapshot)
      );
      const localDataReadComplete = isRingHistoryReadComplete(localData);
      if (!isRwRing && localDataReadComplete) {
        legacyLocalDataStableReadyAt = Date.now();
      }
      if (allowTimeoutPartialUpload && timeoutFlushSnapshot) {
        appendAwarenessDiagnosticLog('legacy-local-data-timeout-flush-allowed', {
          protocol,
          trigger: legacyLocalDataTimeoutFlushTrigger,
          localDataCount: localData.length,
          stableSnapshot: timeoutFlushSnapshot,
          snapshot: getAwarenessConnectionSnapshot()
        });
      }
      if (localDataReadComplete || allowTimeoutPartialUpload) {
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
          const stableWaitContextState = getAwarenessHomeSyncContextState(activeUploadDeviceMac);
          if (activeUploadDeviceMac && stableWaitContextState.mismatch) {
            userStore.updateUploadingStatus('2');
            userStore.updateIsSending(false);
            appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
              protocol,
              reason: 'active-sync-device-mismatch-before-stable-wait',
              activeMac: activeUploadDeviceMac,
              deviceMac: precheckDeviceMac,
              currentMac: stableWaitContextState.currentMac,
              expectedMac: stableWaitContextState.expectedMac,
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
          if (!allowTimeoutPartialUpload && !isLegacyLocalDataStableReadyForUpload()) {
            userStore.updateUploadingStatus('2');
            appendAwarenessDiagnosticLog('legacy-local-data-upload-pending', {
              protocol,
              reason: 'wait-stable-background',
              localDataCount: localData.length,
              localDataSummary: summarizeLegacyHistoryPayloadsForLog(localData as Array<Record<string, any>>),
              stableSnapshot: getLegacyLocalDataStableSnapshot(),
              snapshot: getAwarenessConnectionSnapshot()
            });
            requestOrScheduleLegacyLocalDataIncompleteFlush('legacy-local-data-upload-wait-stable-background', protocol);
            if (!isLegacyLocalDataStableReadyForUpload()) {
              scheduleLegacyLocalDataUploadAfterStableWait('legacy-local-data-upload', protocol);
            }
            return;
          }
          legacyLocalDataStableReadyAt = 0;
          localData = getAwarenessHistoryPayloadsForDevice(
            Array.isArray(userStore.receivedData) ? userStore.receivedData : [],
            precheckDeviceMac
          ).matchedPayloads;
          const postStableSnapshot = getLegacyLocalDataStableSnapshot();
          const allowPostStableTimeoutPartialUpload =
            allowTimeoutPartialUpload || isLegacyLocalDataTimeoutFlushAllowed(postStableSnapshot);
          if (!localData.length || (!isRingHistoryReadComplete(localData) && !allowPostStableTimeoutPartialUpload)) {
            userStore.updateUploadingStatus('2');
            requestOrScheduleLegacyLocalDataIncompleteFlush('legacy-local-data-upload-not-complete-after-stable-wait', protocol);
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
        const submitContextState = getAwarenessHomeSyncContextState(activeUploadDeviceMac);
        if (!isRwRing && activeUploadDeviceMac && submitContextState.mismatch) {
          userStore.updateUploadingStatus('2');
          userStore.updateIsSending(false);
          appendAwarenessDiagnosticLog('legacy-local-data-upload-skip', {
            protocol,
            isRwRing,
            reason: 'active-sync-device-mismatch-before-submit',
            activeMac: activeUploadDeviceMac,
            deviceMac,
            currentMac: submitContextState.currentMac,
            expectedMac: submitContextState.expectedMac,
            localDataCount: localData.length,
            rawRecordCount: allFilteredRecords.length,
            stableSnapshot: getLegacyLocalDataStableSnapshot(),
            snapshot: getAwarenessConnectionSnapshot()
          });
          return;
        }
        const defaultUploadSinceTimestamp = getAwarenessHistoryUploadSinceTimestamp(isRwRing);
        const uploadSinceTimestamp = isRwRing
          ? defaultUploadSinceTimestamp
          : getLegacyLocalDataHttpRetrySinceTimestamp(deviceMac, defaultUploadSinceTimestamp);
        if (!isRwRing && uploadSinceTimestamp !== defaultUploadSinceTimestamp) {
          appendAwarenessDiagnosticLog('legacy-local-data-http-retry-window-applied', {
            protocol,
            deviceMac,
            defaultUploadSinceTimestamp,
            defaultUploadSinceText: formatUnixTimestampForLog(defaultUploadSinceTimestamp),
            uploadSinceTimestamp,
            uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
            snapshot: getAwarenessConnectionSnapshot()
          });
        }
        // The last BLE notification and page navigation callbacks share the
        // mini-program JS thread. Yield once before the only full normalize /
        // dedupe pass so a completed history read cannot freeze page taps.
        await waitForAwarenessMs(0);
        const uploadBatch = buildLegacyLocalDataUploadBatch(deviceMac, uploadSinceTimestamp);
        // Keep the terminal snapshot alive for this upload cycle.  Stable-check,
        // watcher and HTTP dispatch can all enter this path before the cursor is
        // acknowledged; clearing here made the same 248 records normalize/sort
        // three times on B7.  The outer upload-cycle finally block invalidates it
        // after every success/failure branch has finished.
        legacyLocalDataStableSnapshotCache = null;
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
          // Keep identity, time-window and upload-dedupe losses separate. The
          // previous aggregate labelled all window-filtered rows as a device
          // mismatch, which made valid D7 history look like cross-device data.
          skippedPayloadDeviceMismatchCount: uploadBatch.payloadScope.skippedDeviceMismatchCount,
          skippedCachedDeviceMismatchCount: uploadBatch.skippedCachedDeviceMismatchCount,
          preservedOverlapRecordCount: uploadBatch.preservedOverlapRecordCount,
          mergedRecordCount: uploadBatch.mergedRecordCount,
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
          const uploadDeviceReadDone = Boolean(isRwRing || (uploadSignatureSnapshot.completed === true && isRingHistoryReadComplete(localData)));
          const uploadCoverageStatus = uploadDeviceReadDone ? 'complete' : 'partial';
          appendAwarenessDiagnosticLog('binding-check-skipped', {
            protocol,
            isRwRing,
            stage: 'legacy-local-data-upload',
            reason: 'trusted-scanned-device-context',
            deviceReadDone: uploadDeviceReadDone,
            coverageStatus: uploadCoverageStatus,
            submitCount: submitArray.length,
            rawFrameCount: rawFrames.length,
            uploadSinceTimestamp,
            uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
            submitMetricCounts,
            deviceMac,
            snapshot: getAwarenessConnectionSnapshot()
          });
          // Persist and upload oldest-first so each successful batch advances a
          // contiguous device watermark instead of jumping over a failed gap.
          submitArray.sort((left, right) => {
            const leftTimestamp = getRingHistoryRecordUnixTime(left) || 0;
            const rightTimestamp = getRingHistoryRecordUnixTime(right) || 0;
            return leftTimestamp - rightTimestamp;
          });
          const stagedUploadSession = stagePendingUploadSessionDeferred({
            uploadSessionId: createUploadSessionId(protocol || 'legacy'),
            deviceMac,
            protocol,
            dataList: submitArray as any,
            rawFrames,
            deviceReadDone: uploadDeviceReadDone,
            historyCompleted: uploadDeviceReadDone,
            partialUpload: !uploadDeviceReadDone,
            coverageStatus: uploadCoverageStatus,
            canDeleteDeviceBlocks: uploadDeviceReadDone
          });
          const uploadSession = stagedUploadSession.session;
          const durableUploadTimestamp = Number(uploadSignatureSnapshot?.submitRange?.maxTimestamp || 0);
          if (durableUploadTimestamp > 0) {
            void stagedUploadSession.persistence.then((persistResult) => {
              if (persistResult.ok) {
                updateAwarenessDeviceHistoryDurableCheckpoint(
                  durableUploadTimestamp,
                  'legacy-local-data-upload-queued-durably-background'
                );
                return;
              }
              appendAwarenessDiagnosticLog('legacy-local-data-persist-failed', {
                protocol,
                uploadSessionId: uploadSession.uploadSessionId,
                submitCount: submitArray.length,
                durableUploadTimestamp,
                deviceMac,
                elapsedMs: persistResult.elapsedMs,
                error: persistResult.error
              });
            });
          }
          homeDataSyncing.value = false;
          // BLE reading is complete and the upload payload is durable. HTTP
          // continuation is background work: it must not keep the global UI
          // in a sending state or block tab/detail page initialization.
          homeSyncRunningInBackground.value = true;
          userStore.updateIsSending(false);
          // The HTTP upload is background/non-blocking, but it still belongs to
          // the user's visible connect -> sync -> refresh chain. Hand the
          // indicator directly to the final overview refresh while keeping
          // isSending=false, so navigation remains usable and the battery does
          // not flash before the new cards have rendered.
          homeDataRefreshingAfterSync.value = true;
          userStore.updateUploadingStatus('2');
          appendAwarenessDiagnosticLog('legacy-local-data-upload-background-handoff', {
            protocol,
            isRwRing,
            uploadSessionId: uploadSession.uploadSessionId,
            submitCount: submitArray.length,
            rawFrameCount: rawFrames.length,
            deviceMac,
            snapshot: getAwarenessConnectionSnapshot()
          });
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
            deviceReadDone: uploadDeviceReadDone,
            coverageStatus: uploadCoverageStatus,
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
            deviceReadDone: uploadDeviceReadDone,
            coverageStatus: uploadCoverageStatus,
            deviceMac,
            snapshot: getAwarenessConnectionSnapshot()
          });

          let submitResponse: unknown;
          let rawSubmitResponse: unknown;
          let submitHttpStartedAt = 0;
          let submitHttpWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
          let rawUploadStarted = false;
          let foregroundBudgetExpired = false;
          let uploadSummaryReady = true;
          let uploadSummaryDates: string[] = [];
          let uploadedRecordKeyCountAfterAck = 0;
          const acceptedUploadBookkeepingRecords: SyncData[] = [];
          let acceptedUploadBatchCount = 0;
          let latestUploadBackendAckTimestamp = 0;
          const getSubmitForegroundElapsedMs = () => (submitHttpStartedAt > 0 ? Date.now() - submitHttpStartedAt : 0);
          const getSubmitForegroundRemainingMs = () =>
            Math.max(0, LEGACY_LOCAL_DATA_SUBMIT_FOREGROUND_BUDGET_MS - getSubmitForegroundElapsedMs());
          const startRawFrameBackgroundUpload = (reason: string) => {
            if (rawUploadStarted || rawFrames.length <= 0) return;
            rawUploadStarted = true;
            rawSubmitResponse = {
              rawStatus: 'scheduled',
              uploadSessionId: uploadSession.uploadSessionId,
              rawFrameCount: rawFrames.length,
              reason
            };
            const rawHttpStartedAt = Date.now();
            appendAwarenessDiagnosticLog('upload-start', {
              protocol,
              isRwRing,
              stage: 'legacy-local-raw-upload',
              reason,
              uploadSessionId: uploadSession.uploadSessionId,
              deviceMac,
              rawFrameCount: rawFrames.length,
              snapshot: getAwarenessConnectionSnapshot()
            });
            appendAwarenessDiagnosticLog('upload-http-start', {
              protocol,
              isRwRing,
              stage: 'legacy-local-raw-upload',
              reason,
              uploadSessionId: uploadSession.uploadSessionId,
              deviceMac,
              rawFrameCount: rawFrames.length,
              snapshot: getAwarenessConnectionSnapshot()
            });
            setRwDiagnosticBusinessUploadActive(true);
            void uploadPendingRawFramesInBackground(uploadSession, (params) => submitRingHistoryRawFrames(params))
              .then((rawUploadResponse) => {
                appendAwarenessDiagnosticLog('upload-http-result', {
                  protocol,
                  isRwRing,
                  stage: 'legacy-local-raw-upload',
                  reason,
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  elapsedMs: Date.now() - rawHttpStartedAt,
                  rawFrameCount: rawFrames.length,
                  rawSubmitResponse: summarizeSubmitDataResponse(rawUploadResponse),
                  snapshot: getAwarenessConnectionSnapshot()
                });
                appendAwarenessDiagnosticLog('upload-result', {
                  protocol,
                  isRwRing,
                  stage: 'legacy-local-raw-upload',
                  reason,
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  rawFrameCount: rawFrames.length,
                  rawSubmitResponse: summarizeSubmitDataResponse(rawUploadResponse),
                  snapshot: getAwarenessConnectionSnapshot()
                });
              })
              .catch((rawUploadError) => {
                const rawUploadErrorText = formatAwarenessUploadRequestError(rawUploadError);
                appendAwarenessDiagnosticLog('upload-http-failed', {
                  protocol,
                  isRwRing,
                  stage: 'legacy-local-raw-upload',
                  reason,
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  elapsedMs: Date.now() - rawHttpStartedAt,
                  rawFrameCount: rawFrames.length,
                  error: rawUploadErrorText,
                  rawError: getAwarenessRawError(rawUploadError),
                  snapshot: getAwarenessConnectionSnapshot()
                });
                appendAwarenessDiagnosticLog('legacy-local-raw-upload-failed', {
                  protocol,
                  reason,
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  rawFrameCount: rawFrames.length,
                  error: rawUploadErrorText,
                  rawError: getAwarenessRawError(rawUploadError),
                  snapshot: getAwarenessConnectionSnapshot()
                });
                appendAwarenessDiagnosticLog('upload-failed', {
                  protocol,
                  isRwRing,
                  stage: 'legacy-local-raw-upload',
                  reason,
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  rawFrameCount: rawFrames.length,
                  error: rawUploadErrorText,
                  rawError: getAwarenessRawError(rawUploadError),
                  snapshot: getAwarenessConnectionSnapshot()
                });
              })
              .finally(() => setRwDiagnosticBusinessUploadActive(false));
          };
          const scheduleRawFrameBackgroundUpload = (reason: string) => {
            if (rawUploadStarted || rawFrames.length <= 0) return;
            rawSubmitResponse = rawSubmitResponse || {
              rawStatus: 'scheduled',
              uploadSessionId: uploadSession.uploadSessionId,
              rawFrameCount: rawFrames.length,
              reason
            };
            appendAwarenessDiagnosticLog('legacy-local-raw-upload-scheduled', {
              protocol,
              isRwRing,
              reason,
              uploadSessionId: uploadSession.uploadSessionId,
              deviceMac,
              delayMs: LEGACY_RAW_FRAME_BACKGROUND_UPLOAD_DELAY_MS,
              rawFrameCount: rawFrames.length,
              snapshot: getAwarenessConnectionSnapshot()
            });
            setTimeout(() => {
              startRawFrameBackgroundUpload(reason);
            }, LEGACY_RAW_FRAME_BACKGROUND_UPLOAD_DELAY_MS);
          };
          setRwDiagnosticBusinessUploadActive(true);
          try {
            submitHttpStartedAt = Date.now();
            appendAwarenessDiagnosticLog('upload-http-start', {
              protocol,
              isRwRing,
              stage: 'legacy-local-data-submit',
              uploadSessionId: uploadSession.uploadSessionId,
              deviceMac,
              submitCount: submitArray.length,
              rawFrameCount: rawFrames.length,
              snapshot: getAwarenessConnectionSnapshot()
            });
            submitHttpWatchdogTimer = setTimeout(() => {
              appendAwarenessDiagnosticLog('upload-http-watchdog-pending', {
                protocol,
                isRwRing,
                stage: 'legacy-local-data-submit',
                uploadSessionId: uploadSession.uploadSessionId,
                deviceMac,
                elapsedMs: submitHttpStartedAt > 0 ? Date.now() - submitHttpStartedAt : 0,
                timeoutMs: LEGACY_LOCAL_DATA_SUBMIT_TIMEOUT_MS,
                watchdogMs: LEGACY_LOCAL_DATA_SUBMIT_WATCHDOG_MS,
                submitCount: submitArray.length,
                rawFrameCount: rawFrames.length,
                snapshot: getAwarenessConnectionSnapshot()
              });
            }, LEGACY_LOCAL_DATA_SUBMIT_WATCHDOG_MS);
            legacyLocalDataUploadPromise = (async () => {
              const submitRecords = submitArray as SyncData[];
              const submitBatches = chunkLegacySubmitData(submitRecords, LEGACY_LOCAL_DATA_SUBMIT_BATCH_SIZE);
              const submitBatchResponses: unknown[] = [];
              let latestAckPersistence: Promise<unknown> = Promise.resolve();
              appendAwarenessDiagnosticLog('upload-http-batch-plan', {
                protocol,
                isRwRing,
                stage: 'legacy-local-data-submit',
                uploadSessionId: uploadSession.uploadSessionId,
                deviceMac,
                submitCount: submitRecords.length,
                batchSize: LEGACY_LOCAL_DATA_SUBMIT_BATCH_SIZE,
                batchCount: submitBatches.length,
                rawFrameCount: rawFrames.length,
                snapshot: getAwarenessConnectionSnapshot()
              });
              for (let batchIndex = 0; batchIndex < submitBatches.length; batchIndex += 1) {
                const batch = submitBatches[batchIndex];
                const batchId = buildUploadBatchId(uploadSession.uploadSessionId, deviceMac, batchIndex, batch);
                const parsedUploadMeta = buildParsedDataUploadBatchSyncMeta(
                  uploadSession,
                  batchIndex,
                  submitBatches.length
                );
                const batchStartedAt = Date.now();
                const remainingBudgetMs = getSubmitForegroundRemainingMs();
                if (remainingBudgetMs <= 0 || (batchIndex > 0 && remainingBudgetMs < 2000)) {
                  foregroundBudgetExpired = true;
                  homeSyncRunningInBackground.value = true;
                  userStore.updateIsSending(false);
                  appendAwarenessDiagnosticLog('upload-http-foreground-budget-expired', {
                    protocol,
                    isRwRing,
                    stage: 'legacy-local-data-submit',
                    uploadSessionId: uploadSession.uploadSessionId,
                    deviceMac,
                    elapsedMs: getSubmitForegroundElapsedMs(),
                    remainingBudgetMs,
                    foregroundBudgetMs: LEGACY_LOCAL_DATA_SUBMIT_FOREGROUND_BUDGET_MS,
                    nextBatchIndex: batchIndex + 1,
                    batchCount: submitBatches.length,
                    submitCount: submitRecords.length,
                    rawFrameCount: rawFrames.length,
                    snapshot: getAwarenessConnectionSnapshot()
                  });
                }
                const batchSoftTimeoutMs = foregroundBudgetExpired
                  ? LEGACY_LOCAL_DATA_SUBMIT_TIMEOUT_MS + 1000
                  : Math.max(1000, Math.min(LEGACY_LOCAL_DATA_SUBMIT_TIMEOUT_MS + 1000, remainingBudgetMs));
                const batchRequestTimeoutMs = Math.max(
                  1000,
                  Math.min(LEGACY_LOCAL_DATA_SUBMIT_TIMEOUT_MS, Math.max(1000, batchSoftTimeoutMs - 500))
                );
                appendAwarenessDiagnosticLog('upload-http-batch-start', {
                  protocol,
                  isRwRing,
                  stage: 'legacy-local-data-submit',
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  batchIndex: batchIndex + 1,
                  batchCount: submitBatches.length,
                  batchSize: batch.length,
                  submitCount: submitRecords.length,
                  batchSoftTimeoutMs,
                  batchRequestTimeoutMs,
                  elapsedMs: getSubmitForegroundElapsedMs(),
                  remainingBudgetMs,
                  foregroundBudgetMs: LEGACY_LOCAL_DATA_SUBMIT_FOREGROUND_BUDGET_MS,
                  rawFrameCount: rawFrames.length,
                  snapshot: getAwarenessConnectionSnapshot()
                });
                let batchRequestTask: { abort?: () => void } | null = null;
                const logBatchRequestTiming = (phase: string, detail: Record<string, unknown> = {}) => {
                  appendAwarenessDiagnosticLog('upload-http-batch-request-timing', {
                    protocol,
                    isRwRing,
                    stage: 'legacy-local-data-submit',
                    uploadSessionId: uploadSession.uploadSessionId,
                    deviceMac,
                    batchIndex: batchIndex + 1,
                    batchCount: submitBatches.length,
                    batchSize: batch.length,
                    phase,
                    batchElapsedMs: Date.now() - batchStartedAt,
                    submitElapsedMs: getSubmitForegroundElapsedMs(),
                    requestTiming: detail,
                    hasRequestTask: !!batchRequestTask,
                    snapshot: getAwarenessConnectionSnapshot()
                  });
                };
                const batchResponse = await withAwarenessSoftTimeout(
                  `legacy-local-data-submit:${batchIndex + 1}/${submitBatches.length}`,
                  batchSoftTimeoutMs,
                  () =>
                    submitData(
                      {
                        deviceMac,
                        batchId,
                        dataList: batch,
                        ...parsedUploadMeta
                      },
                      {
                        timeout: batchRequestTimeoutMs,
                        custom: { toast: false, catch: true },
                        onTiming: logBatchRequestTiming,
                        getTask: (task: { abort?: () => void } | null) => {
                          batchRequestTask = task;
                        }
                      }
                    ),
                  () => {
                    appendAwarenessDiagnosticLog('upload-http-batch-soft-timeout', {
                      protocol,
                      isRwRing,
                      stage: 'legacy-local-data-submit',
                      uploadSessionId: uploadSession.uploadSessionId,
                      deviceMac,
                      batchIndex: batchIndex + 1,
                      batchCount: submitBatches.length,
                      batchSize: batch.length,
                      elapsedMs: Date.now() - batchStartedAt,
                      timeoutMs: batchSoftTimeoutMs,
                      requestTimeoutMs: batchRequestTimeoutMs,
                      hasRequestTask: !!batchRequestTask,
                      willAbort: true,
                      reason: 'abort-client-request-and-preserve-snapshot-for-http-only-retry',
                      snapshot: getAwarenessConnectionSnapshot()
                    });
                    try {
                      batchRequestTask?.abort?.();
                    } catch {
                      // 请求中止失败仍按超时处理；稳定快照会保留给 HTTP-only 补偿。
                    }
                  }
                );
                appendAwarenessDiagnosticLog('upload-http-batch-callback-enter', {
                  protocol,
                  isRwRing,
                  stage: 'legacy-local-data-submit',
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  batchIndex: batchIndex + 1,
                  batchCount: submitBatches.length,
                  batchSize: batch.length,
                  batchElapsedMs: Date.now() - batchStartedAt,
                  submitElapsedMs: getSubmitForegroundElapsedMs(),
                  snapshot: getAwarenessConnectionSnapshot()
                });
                appendAwarenessDiagnosticLog('upload-http-batch-result', {
                  protocol,
                  isRwRing,
                  stage: 'legacy-local-data-submit',
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  elapsedMs: Date.now() - batchStartedAt,
                  batchIndex: batchIndex + 1,
                  batchCount: submitBatches.length,
                  batchSize: batch.length,
                  submitCount: submitRecords.length,
                  rawFrameCount: rawFrames.length,
                  submitResponse: summarizeSubmitDataResponse(batchResponse),
                  snapshot: getAwarenessConnectionSnapshot()
                });
                if (!isSubmitDataResponseSuccessful(batchResponse)) {
                  throw new Error(`legacy local data submit batch failed: ${batchIndex + 1}/${submitBatches.length}`);
                }
                const ackParseStartedAt = Date.now();
                const batchAck = requireSubmitDataBatchAck(batchResponse, batchId, batch.length);
                const ackResult = acknowledgePendingUploadBatchDeferred(
                  uploadSession,
                  batchAck.acceptedCount,
                  batchResponse
                );
                latestAckPersistence = ackResult.persistence;
                acceptedUploadBookkeepingRecords.push(...batch);
                acceptedUploadBatchCount += 1;
                latestUploadBackendAckTimestamp = Math.max(
                  latestUploadBackendAckTimestamp,
                  batchAck.acceptedThrough
                );
                appendAwarenessDiagnosticLog('upload-http-batch-acknowledged', {
                  protocol,
                  isRwRing,
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  batchIndex: batchIndex + 1,
                  batchCount: submitBatches.length,
                  batchSize: batch.length,
                  batchId,
                  backendAckTimestamp: batchAck.acceptedThrough,
                  ackAndDispatchElapsedMs: Date.now() - ackParseStartedAt,
                  remainingRecordCount: Math.max(
                    0,
                    submitRecords.length - (batchIndex * LEGACY_LOCAL_DATA_SUBMIT_BATCH_SIZE + batch.length)
                  )
                });
                submitBatchResponses.push(batchResponse);
              }
              const finalizationStartedAt = Date.now();
              const persistenceResult = await latestAckPersistence;
              uploadedRecordKeyCountAfterAck =
                uploadedRecordFilter.uploadedRecordKeyCount + acceptedUploadBookkeepingRecords.length;
              if (acceptedUploadBookkeepingRecords.length > 0) {
                void scheduleLegacyUploadPostAckBookkeeping(
                  uploadSession.uploadSessionId,
                  deviceMac,
                  protocol || 'legacy',
                  acceptedUploadBatchCount,
                  submitBatches.length,
                  acceptedUploadBookkeepingRecords,
                  latestUploadBackendAckTimestamp
                );
              }
              appendAwarenessDiagnosticLog('upload-http-batch-finalization-result', {
                protocol,
                isRwRing,
                stage: 'legacy-local-data-submit',
                uploadSessionId: uploadSession.uploadSessionId,
                deviceMac,
                batchCount: submitBatches.length,
                persistenceResult,
                elapsedMs: Date.now() - finalizationStartedAt,
                snapshot: getAwarenessConnectionSnapshot()
              });
              const responseSummaryDates = Array.from(
                new Set(submitBatchResponses.flatMap((response) => getSubmitDataResponseTouchedDates(response)))
              );
              const fallbackSummaryDates = getSubmitDataRecordTouchedDates(
                submitRecords as Array<Record<string, any>>
              );
              uploadSummaryDates = responseSummaryDates.length > 0 ? responseSummaryDates : fallbackSummaryDates;
              if (responseSummaryDates.length === 0 && fallbackSummaryDates.length > 0) {
                appendAwarenessDiagnosticLog('upload-summary-dates-fallback', {
                  protocol,
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  summaryDates: fallbackSummaryDates,
                  submitCount: submitRecords.length,
                  reason: 'batch-response-missing-touched-dates'
                });
              }
              if (uploadSummaryDates.length > 0) {
                const summaryFinalizeStartedAt = Date.now();
                uploadSummaryReady = false;
                appendAwarenessDiagnosticLog('upload-summary-finalize-start', {
                  protocol,
                  uploadSessionId: uploadSession.uploadSessionId,
                  deviceMac,
                  summaryDates: uploadSummaryDates
                });
                try {
                  const summaryFinalizeResponse = await finalizeDataSyncSummary(
                    {
                      deviceMac,
                      uploadSessionId: uploadSession.uploadSessionId,
                      dates: uploadSummaryDates
                    },
                    {
                      timeout: 12000,
                      custom: { toast: false, catch: true }
                    }
                  );
                  uploadSummaryReady = isSummaryFinalizeResponseReady(summaryFinalizeResponse);
                  appendAwarenessDiagnosticLog('upload-summary-finalize-result', {
                    protocol,
                    uploadSessionId: uploadSession.uploadSessionId,
                    deviceMac,
                    summaryDates: uploadSummaryDates,
                    summaryReady: uploadSummaryReady,
                    elapsedMs: Date.now() - summaryFinalizeStartedAt
                  });
                } catch (summaryFinalizeError) {
                  appendAwarenessDiagnosticLog('upload-summary-finalize-failed', {
                    protocol,
                    uploadSessionId: uploadSession.uploadSessionId,
                    deviceMac,
                    summaryDates: uploadSummaryDates,
                    elapsedMs: Date.now() - summaryFinalizeStartedAt,
                    error: formatAwarenessUploadRequestError(summaryFinalizeError)
                  });
                }
              }
              const aggregateSleepAcceptedCounts = submitBatchResponses
                .map((response) => getSubmitDataResponseSleepAcceptedCount(response))
                .filter((value): value is number => typeof value === 'number');
              const aggregateSleepAcceptedCount = aggregateSleepAcceptedCounts.length > 0
                ? aggregateSleepAcceptedCounts.reduce((sum, value) => sum + value, 0)
                : undefined;
              return {
                code: 200,
                batchCount: submitBatches.length,
                submitCount: submitRecords.length,
                sleepCount: aggregateSleepAcceptedCount,
                sleepAcceptedCount: aggregateSleepAcceptedCount,
                responses: submitBatchResponses
              };
            })();
            submitResponse = await legacyLocalDataUploadPromise;
            appendAwarenessDiagnosticLog('upload-http-result', {
              protocol,
              isRwRing,
              stage: 'legacy-local-data-submit',
              uploadSessionId: uploadSession.uploadSessionId,
              deviceMac,
              elapsedMs: submitHttpStartedAt > 0 ? Date.now() - submitHttpStartedAt : 0,
              submitCount: submitArray.length,
              rawFrameCount: rawFrames.length,
              submitResponse: summarizeSubmitDataResponse(submitResponse),
              snapshot: getAwarenessConnectionSnapshot()
            });
            if (!isSubmitDataResponseSuccessful(submitResponse)) {
              throw new Error('历史数据提交失败');
            }
            await markPendingUploadDataDoneDeferred(uploadSession, submitResponse);
            if (!isRwRing) {
              clearLegacyLocalDataHttpRetryWindow(deviceMac);
            }
          } catch (uploadError) {
            const uploadErrorText = formatAwarenessUploadRequestError(uploadError);
            appendAwarenessDiagnosticLog('upload-http-failed', {
              protocol,
              isRwRing,
              stage: 'legacy-local-data-submit',
              uploadSessionId: uploadSession.uploadSessionId,
              deviceMac,
              elapsedMs: submitHttpStartedAt > 0 ? Date.now() - submitHttpStartedAt : 0,
              submitCount: submitArray.length,
              rawFrameCount: rawFrames.length,
              error: uploadErrorText,
              rawError: getAwarenessRawError(uploadError),
              snapshot: getAwarenessConnectionSnapshot()
            });
            releaseLegacyLocalDataUploadSignature(uploadSignatureSnapshot);
            if (acceptedUploadBookkeepingRecords.length > 0) {
              void scheduleLegacyUploadPostAckBookkeeping(
                uploadSession.uploadSessionId,
                deviceMac,
                protocol || 'legacy',
                acceptedUploadBatchCount,
                acceptedUploadBatchCount,
                acceptedUploadBookkeepingRecords,
                latestUploadBackendAckTimestamp
              );
            }
            const failurePersistence = markPendingUploadDataFailedDeferred(uploadSession, uploadError);
            if (!isRwRing) {
              rememberLegacyLocalDataHttpRetryWindow(deviceMac, uploadSinceTimestamp);
              const retrySnapshot = getLegacyLocalDataStableSnapshot();
              if (hasLegacyLocalDataUploadableSnapshot(retrySnapshot)) {
                legacyLocalDataStablePromise = null;
                legacyLocalDataStableUploadScheduled = false;
                legacyLocalDataStableReadyAt = Date.now();
                legacyLocalDataUploadWatcherPending = false;
                appendAwarenessDiagnosticLog('legacy-local-data-upload-retry-after-http-failed', {
                  protocol,
                  stage: 'legacy-local-data-submit',
                  uploadSessionId: uploadSession.uploadSessionId,
                  reason: 'http-failed-with-uploadable-snapshot',
                  failedSubmitCount: submitArray.length,
                  failedRawFrameCount: rawFrames.length,
                  stableSnapshot: retrySnapshot,
                  snapshot: getAwarenessConnectionSnapshot()
                });
                userStore.updateUploadingStatus('2');
                userStore.updateIsSending(false);
                homeDataSyncing.value = false;
                homeDataRefreshingAfterSync.value = false;
                homeSyncRunningInBackground.value = true;
                void failurePersistence.finally(() => {
                  schedulePendingParsedUploadRetry(
                    'legacy-local-data-upload-http-failed-auto-retry',
                    PENDING_PARSED_UPLOAD_RETRY_DELAY_MS
                  );
                });
                const httpRetryQueued = true;
                appendAwarenessDiagnosticLog('legacy-local-data-upload-http-retry-only', {
                  protocol,
                  stage: 'legacy-local-data-submit',
                  uploadSessionId: uploadSession.uploadSessionId,
                  reason: 'http-failed-auto-retry-pending-session',
                  httpRetryQueued,
                  deviceMac,
                  uploadSinceTimestamp,
                  uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
                  stableSnapshot: retrySnapshot,
                  snapshot: getAwarenessConnectionSnapshot()
                });
                return;
              }
            }
            throw uploadError;
          } finally {
            setRwDiagnosticBusinessUploadActive(false);
            if (submitHttpWatchdogTimer) {
              clearTimeout(submitHttpWatchdogTimer);
              submitHttpWatchdogTimer = null;
            }
            legacyLocalDataUploadPromise = null;
          }
          if (rawFrames.length > 0) {
            scheduleRawFrameBackgroundUpload('after-parsed-submit');
            rawSubmitResponse = rawSubmitResponse || {
              rawStatus: 'scheduled',
              uploadSessionId: uploadSession.uploadSessionId,
              rawFrameCount: rawFrames.length
            };
          } else {
            rawSubmitResponse = { rawStatus: 'none', uploadSessionId: uploadSession.uploadSessionId, rawFrameCount: 0 };
          }
          const uploadedRecordKeyCount = uploadedRecordKeyCountAfterAck;
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
          const historyReadTerminal = !isRwRing ? getLegacyHomeHistoryReadTerminalForDevice(deviceMac) : null;
          const historyReadTerminalComplete =
            isLegacyHomeHistoryReadTerminalComplete(historyReadTerminal) || uploadSignatureSnapshot.completed === true;
          const maxReceivedTimestamp = getLegacyLocalDataSnapshotMaxTimestamp(uploadSignatureSnapshot);
          const alreadyUploadedOnlyAfterDedup =
            submitArray.length === 0 &&
            uploadedRecordFilter.alreadyUploadedRecords.length > 0 &&
            maxReceivedTimestamp > 0;
          const legacyHistoryIncompleteAfterUpload =
            !isRwRing && !historyReadTerminalComplete && !alreadyUploadedOnlyAfterDedup;
          if (legacyHistoryIncompleteAfterUpload) {
            appendAwarenessDiagnosticLog('legacy-local-data-cache-keep', {
              protocol,
              isRwRing,
              reason: 'partial-history-read-not-terminal-background-deferred',
              submitCount: submitArray.length,
              uploadSinceTimestamp,
              uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
              stableSnapshot: uploadSignatureSnapshot,
              submitMetricCounts,
              submitRecordSummary,
              submitResponse: summarizeSubmitDataResponse(submitResponse),
              deviceMac,
              snapshot: getAwarenessConnectionSnapshot()
            });
            appendAwarenessDiagnosticLog('legacy-local-data-background-compensation-deferred', {
              protocol,
              isRwRing,
              reason: 'uploaded-records-first-history-read-not-terminal',
              uploadSessionId: uploadSession.uploadSessionId,
              submitCount: submitArray.length,
              uploadSinceTimestamp,
              uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
              stableSnapshot: uploadSignatureSnapshot,
              deviceMac,
              snapshot: getAwarenessConnectionSnapshot()
            });
          } else if (!isRwRing) {
            const sleepCacheParkKey = getLegacySleepNotIngestedParkKey(deviceMac, uploadSinceTimestamp);
            const sleepCacheParkDecision = getLegacyLocalHistoryCacheParkDecisionAfterUpload(
              submitMetricCounts,
              submitResponse,
              { key: sleepCacheParkKey }
            );
            if (sleepCacheParkDecision.keep) {
              appendAwarenessDiagnosticLog('legacy-local-data-cache-keep', {
                protocol,
                isRwRing,
                reason: sleepCacheParkDecision.reason,
                submitCount: submitArray.length,
                uploadSinceTimestamp,
                uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
                submitMetricCounts,
                submitRecordSummary,
                submitResponse: summarizeSubmitDataResponse(submitResponse),
                sleepCacheParkDecision,
                deviceMac,
                snapshot: getAwarenessConnectionSnapshot()
              });
            } else {
              resetLegacySleepNotIngestedParkState(sleepCacheParkKey);
              clearLegacyLocalHistoryCacheAfterUpload({
                protocol,
                submitCount: submitArray.length,
                uploadSinceTimestamp,
                uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
                submitMetricCounts,
                submitRecordSummary,
                sleepCacheParkDecision,
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
          }
          const readCheckpointTimestampAfterUpload = legacyHistoryIncompleteAfterUpload
            ? getAwarenessReadCheckpointTimestamp()
            : Math.max(maxReceivedTimestamp, Number(historyReadTerminal?.maxTimestamp || 0));
          const backendAckCheckpointTimestamp = maxSubmittedTimestamp;
          if (!legacyHistoryIncompleteAfterUpload && readCheckpointTimestampAfterUpload > 0) {
            updateAwarenessDeviceHistoryReadCheckpoint(
              readCheckpointTimestampAfterUpload,
              'legacy-local-data-upload-read-complete'
            );
          }
          if (backendAckCheckpointTimestamp > 0) {
            updateAwarenessDeviceHistoryBackendAckCheckpoint(
              backendAckCheckpointTimestamp,
              legacyHistoryIncompleteAfterUpload
                ? 'legacy-local-data-upload-partial-backend-ack'
                : 'legacy-local-data-upload-backend-ack'
            );
          }
          const checkpointTimestampAfterUpload = Math.max(
            readCheckpointTimestampAfterUpload,
            backendAckCheckpointTimestamp
          );
          completeLegacyLocalDataUploadSignature(uploadSignatureSnapshot, checkpointTimestampAfterUpload);
          closeLegacyLocalDataUploadSession(deviceMac, uploadDedupKey, checkpointTimestampAfterUpload);
          if (legacyHistoryIncompleteAfterUpload) {
            appendAwarenessDiagnosticLog('legacy-local-data-checkpoint-advanced-partial', {
              protocol,
              isRwRing,
              reason: 'partial-history-read-not-terminal-advance-uploaded-checkpoint',
              uploadSessionId: uploadSession.uploadSessionId,
              uploadDedupKey,
              uploadSignatureKey,
              coverageStatus: uploadCoverageStatus,
              deviceReadDone: uploadDeviceReadDone,
              historyCompleted: uploadDeviceReadDone,
              canDeleteDeviceBlocks: false,
              submitCount: submitArray.length,
              alreadyUploadedCount: uploadedRecordFilter.alreadyUploadedRecords.length,
              uploadedRecordKeyCount,
              maxSubmittedTimestamp,
              maxReceivedTimestamp,
              checkpointTimestampAfterUpload,
              historyReadTerminal,
              alreadyUploadedOnlyAfterDedup,
              checkpointSource:
                legacyHistoryIncompleteAfterUpload
                  ? 'max-submitted-or-received-timestamp'
                  : checkpointTimestampAfterUpload === maxReceivedTimestamp
                  ? 'max-received-timestamp'
                  : 'max-submitted-timestamp',
              maxSubmittedText: formatUnixTimestampForLog(maxSubmittedTimestamp),
              maxReceivedText: formatUnixTimestampForLog(maxReceivedTimestamp),
              checkpointText: formatUnixTimestampForLog(checkpointTimestampAfterUpload),
              stableSnapshot: uploadSignatureSnapshot,
              deviceMac,
              snapshot: getAwarenessConnectionSnapshot()
            });
          }
          resetLegacyLocalDataUploadWatcherState(
            legacyHistoryIncompleteAfterUpload ? 'legacy-local-data-upload-partial' : 'legacy-local-data-upload-complete',
            protocol,
            {
              isRwRing,
              uploadSessionId: uploadSession.uploadSessionId,
              submitCount: submitArray.length,
              maxSubmittedTimestamp,
              maxReceivedTimestamp,
              checkpointTimestampAfterUpload,
              legacyHistoryIncompleteAfterUpload
            }
          );
          if (legacyHistoryIncompleteAfterUpload) {
            completeAwarenessVisibleSyncAfterPartialHistory(
              'legacy-local-data-upload-partial-continuation',
              protocol,
              {
                isRwRing,
                deviceMac,
                uploadSinceTimestamp,
                uploadSinceText: formatUnixTimestampForLog(uploadSinceTimestamp),
                submitCount: submitArray.length,
                maxSubmittedTimestamp,
                maxReceivedTimestamp,
                checkpointTimestampAfterUpload,
                fallbackSinceTimestamp: getAwarenessHistoryReadSinceTimestamp(false),
                stableSnapshot: uploadSignatureSnapshot
              }
            );
            return;
          }

          if (uploadSummaryReady || uploadSummaryDates.length === 0) {
            scheduleAwarenessAfterDataProcessed('legacy-local-data-upload-summary-ready');
            finishAwarenessHomeSyncWithoutHistoryCooldown('legacy-local-data-upload-complete');
          } else {
            finishAwarenessHomeSyncWithoutHistoryCooldown('legacy-local-data-upload-complete');
            // Keep the last complete overview instead of briefly rendering a
            // mixed "new detail + old summary" state. Retry finalization in the
            // background and emit the single refresh only after summaryReady.
            // Reuse the durable pending-session finalizer so navigation/page
            // hide cannot drop this last step of the upload transaction.
            schedulePendingParsedSummaryFinalize(
              'legacy-local-data-upload-summary-not-ready',
              {
                deviceMac,
                uploadSessionId: uploadSession.uploadSessionId
              },
              uploadSummaryDates
            );
          }
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
            const alreadyUploadedStableSnapshot = getLegacyLocalDataStableSnapshot();
            const alreadyUploadedMaxTimestamp =
              alreadyUploadedStableSnapshot.completed === true
                ? advanceLegacyLocalDataReadCheckpointFromSnapshot(
                    alreadyUploadedStableSnapshot,
                    'legacy-local-data-already-uploaded'
                  )
                : getLegacyLocalDataSnapshotMaxTimestamp(alreadyUploadedStableSnapshot);
            if (alreadyUploadedMaxTimestamp > 0) {
              completeLegacyLocalDataUploadSignature(alreadyUploadedStableSnapshot, alreadyUploadedMaxTimestamp);
              closeLegacyLocalDataUploadSession(
                deviceMac,
                alreadyUploadedStableSnapshot.uploadDedupKey,
                alreadyUploadedMaxTimestamp
              );
            }
            if (alreadyUploadedStableSnapshot.completed !== true) {
              resetLegacyLocalDataUploadWatcherState('legacy-local-data-already-uploaded-partial', protocol, {
                isRwRing,
                deviceMac,
                reason: 'all-submit-records-already-uploaded-but-history-not-terminal'
              });
              appendAwarenessDiagnosticLog('legacy-local-data-background-compensation-deferred', {
                protocol,
                isRwRing,
                reason: 'all-submit-records-already-uploaded-but-history-not-terminal',
                deviceMac,
                uploadDedupKey: alreadyUploadedStableSnapshot.uploadDedupKey,
                completed: alreadyUploadedStableSnapshot.completed,
                checkpointTimestamp: alreadyUploadedMaxTimestamp,
                checkpointText: formatUnixTimestampForLog(alreadyUploadedMaxTimestamp),
                stableSnapshot: alreadyUploadedStableSnapshot,
                snapshot: getAwarenessConnectionSnapshot()
              });
              completeAwarenessVisibleSyncAfterPartialHistory(
                'legacy-local-data-already-uploaded-partial-continuation',
                protocol,
                {
                  isRwRing,
                  deviceMac,
                  fallbackSinceTimestamp: getAwarenessHistoryReadSinceTimestamp(false),
                  fallbackSinceText: formatUnixTimestampForLog(getAwarenessHistoryReadSinceTimestamp(false)),
                  stableSnapshot: alreadyUploadedStableSnapshot
                }
              );
              return;
            }
            resetLegacyLocalDataUploadWatcherState('legacy-local-data-already-uploaded', protocol, {
              isRwRing,
              deviceMac,
              reason: 'all-submit-records-already-uploaded'
            });
            clearLegacyLocalDataHttpRetryWindow(deviceMac);
            finishAwarenessHomeSyncWithoutHistoryCooldown('legacy-local-data-already-uploaded');
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
          const noSubmitStableSnapshot = getLegacyLocalDataStableSnapshot();
          const noSubmitMaxTimestamp =
            noSubmitStableSnapshot.completed === true
              ? advanceLegacyLocalDataReadCheckpointFromSnapshot(noSubmitStableSnapshot, 'legacy-local-data-no-submit')
              : getLegacyLocalDataSnapshotMaxTimestamp(noSubmitStableSnapshot);
          // A terminal history frame set may contain only raw frames and no
          // parseable business records (9E reproduced this after a transport
          // drop). Close that exact snapshot even when its max timestamp is 0;
          // otherwise resetting the watcher immediately submits the same raw
          // frames again and creates an upload/overview-refresh loop.
          if (noSubmitStableSnapshot.completed === true || noSubmitMaxTimestamp > 0) {
            completeLegacyLocalDataUploadSignature(noSubmitStableSnapshot, noSubmitMaxTimestamp);
            closeLegacyLocalDataUploadSession(
              deviceMac,
              noSubmitStableSnapshot.uploadDedupKey,
              noSubmitMaxTimestamp
            );
          }
          if (noSubmitStableSnapshot.completed !== true && hasLegacyLocalDataUploadableSnapshot(noSubmitStableSnapshot)) {
            resetLegacyLocalDataUploadWatcherState('legacy-local-data-no-submit-partial', protocol, {
              isRwRing,
              deviceMac,
              reason: 'empty-submit-array-but-history-not-terminal'
            });
            appendAwarenessDiagnosticLog('legacy-local-data-background-compensation-deferred', {
              protocol,
              isRwRing,
              reason: 'empty-submit-array-but-history-not-terminal',
              deviceMac,
              uploadDedupKey: noSubmitStableSnapshot.uploadDedupKey,
              completed: noSubmitStableSnapshot.completed,
              maxReceivedTimestamp: noSubmitMaxTimestamp,
              maxReceivedText: formatUnixTimestampForLog(noSubmitMaxTimestamp),
              stableSnapshot: noSubmitStableSnapshot,
              snapshot: getAwarenessConnectionSnapshot()
            });
            completeAwarenessVisibleSyncAfterPartialHistory(
              'legacy-local-data-no-submit-partial-continuation',
              protocol,
              {
                isRwRing,
                deviceMac,
                fallbackSinceTimestamp: getAwarenessHistoryReadSinceTimestamp(false),
                fallbackSinceText: formatUnixTimestampForLog(getAwarenessHistoryReadSinceTimestamp(false)),
                stableSnapshot: noSubmitStableSnapshot
              }
            );
            return;
          }
          resetLegacyLocalDataUploadWatcherState('legacy-local-data-no-submit', protocol, {
            isRwRing,
            deviceMac,
            reason: 'empty-submit-array'
          });
          clearLegacyLocalDataHttpRetryWindow(deviceMac);
          finishAwarenessHomeSyncWithoutHistoryCooldown('legacy-local-data-no-submit');
          scheduleAwarenessAfterDataProcessed('legacy-local-data-no-submit');
        }
      } else {
        // userStore.updateIsSending(false);
        userStore.updateUploadingStatus('2');
        if (!isRwRing) {
          requestOrScheduleLegacyLocalDataIncompleteFlush('legacy-local-data-upload-pending', protocol);
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
      homeDataRefreshingAfterSync.value = false;
      if (!isRwRing) {
        resetLegacyLocalDataUploadWatcherState('legacy-local-data-upload-failed', protocol, {
          isRwRing,
          error: formatBleErrorMessage(error, 'legacy local data upload failed')
        });
        // 上传异常不能继续占用首页同步会话。失败批次的读取窗口已单独保留，
        // 后续只重试 HTTP；这里不推进 checkpoint，也不重新读取 BLE。
        releaseAwarenessHomeSyncSession('legacy-local-data-upload-failed', 'failed', false);
      }
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
      // The upload cycle now owns the cached normalized batch until every ACK,
      // summary and checkpoint branch has settled.  Invalidate only here so the
      // next history generation cannot reuse this cycle's records.
      clearLegacyLocalDataUploadBatchCache();
      legacyLocalDataStableSnapshotCache = null;
      if (legacyHomeHistoryPartialContinuationPending) {
        legacyHomeHistoryPartialContinuationPending = false;
        userStore.updateUploadingStatus('1');
        userStore.updateIsSending(true);
        homeDataSyncing.value = true;
      } else if (pendingParsedUploadRetryTimer || pendingParsedUploadRetryPromise) {
        homeDataSyncing.value = false;
        homeSyncRunningInBackground.value = true;
      } else {
        homeDataSyncing.value = false;
      }
      if (!isRwRing) {
        legacyLocalDataUploadWatcherActive = false;
        legacyLocalDataUploadWatcherActiveAt = 0;
        if (legacyHomeDeviceInfoRefreshPendingRetry) {
          scheduleLegacyHomeDeviceInfoRetryFlush('legacy-local-data-upload-cycle-finished', 120);
        }
        if (legacyLocalDataUploadWatcherPending) {
          const pendingSnapshot = getLegacyLocalDataStableSnapshot();
          const pendingSkipReason = getLegacyLocalDataStableSkipReason(pendingSnapshot);
          legacyLocalDataUploadWatcherPending = false;
          if (isLegacyLocalDataSilentTerminalSkipReason(pendingSkipReason)) {
            if (tryCloseLegacyLocalDataTerminalSkip(pendingSnapshot, pendingSkipReason, 'legacy-local-data-upload-finally', protocol)) {
              return;
            }
          }
          if (isLegacyLocalDataTerminalSkipReason(pendingSkipReason)) {
            if (tryCloseLegacyLocalDataTerminalSkip(pendingSnapshot, pendingSkipReason, 'legacy-local-data-upload-finally', protocol)) {
              return;
            }
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
  { deep: false, flush: 'post' }
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
const getAwarenessSilentRequestConfig = (timeout?: number) => ({
  ...(timeout ? { timeout } : {}),
  custom: { toast: false, catch: true }
});
const getAwarenessAuxiliaryRequestConfig = () =>
  getAwarenessSilentRequestConfig(AWARENESS_AUXILIARY_REQUEST_SOFT_TIMEOUT_MS);
const getAwarenessRawError = (error: unknown) => {
  const typed = error as { rawMsg?: unknown; rawError?: unknown; errMsg?: unknown; message?: unknown };
  return typed?.rawMsg || typed?.rawError || typed?.errMsg || typed?.message;
};
const isAwarenessNetworkTimeoutError = (error: unknown) => {
  const raw = `${getAwarenessRawError(error) || ''}`.toLowerCase();
  return /timeout|time\s*out|err_connection_timed_out|\u7f51\u7edc\u8bf7\u6c42\u8d85\u65f6/.test(raw);
};
const getAwarenessBusinessRequestSoftTimeoutMs = (key: string) =>
  key === 'stressDetail' || key === 'stressSummary'
    ? AWARENESS_STRESS_REQUEST_SOFT_TIMEOUT_MS
    : AWARENESS_BUSINESS_REQUEST_SOFT_TIMEOUT_MS;
const getAwarenessOverviewRequestConfig = (key: string) =>
  getAwarenessSilentRequestConfig(getAwarenessBusinessRequestSoftTimeoutMs(key));
const formatAwarenessBusinessRequestError = (error: unknown) => {
  if (isAwarenessNetworkTimeoutError(error)) return '\u9996\u9875\u6570\u636e\u8bf7\u6c42\u8d85\u65f6';
  return formatBleErrorMessage(error, '\u9996\u9875\u6570\u636e\u8bf7\u6c42\u5931\u8d25');
};
const formatAwarenessUploadRequestError = (error: unknown) => {
  if (isAwarenessNetworkTimeoutError(error)) return '\u6570\u636e\u4e0a\u4f20\u8d85\u65f6\uff0c\u5df2\u8f6c\u5165\u540e\u53f0\u91cd\u8bd5';
  return formatBleErrorMessage(error, '\u6570\u636e\u4e0a\u4f20\u5931\u8d25');
};
const withAwarenessSoftTimeout = <T>(
  key: string,
  timeoutMs: number,
  task: () => Promise<T>,
  onTimeout?: () => void,
  options: { pageBound?: boolean } = {}
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const id = ++awarenessSoftTimeoutSequence;
    const startedAt = Date.now();
    const normalizedTimeoutMs = Math.max(1, Number(timeoutMs) || 1);
    const deadlineAt = startedAt + normalizedTimeoutMs;
    const pageGeneration = awarenessPageGeneration;
    const pageBound = options.pageBound === true;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const expire = (reason: string) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      awarenessActiveSoftTimeouts.delete(id);
      try {
        onTimeout?.();
      } catch {
        // 超时中止失败不影响上层按超时处理。
      }
      reject(new Error(`awareness request soft timeout: ${key} ${normalizedTimeoutMs}ms (${reason})`));
    };
    awarenessActiveSoftTimeouts.set(id, {
      id,
      key,
      startedAt,
      deadlineAt,
      pageGeneration,
      pageBound,
      expire
    });
    timer = setTimeout(() => expire('timer'), normalizedTimeoutMs);

    task()
      .then((result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        awarenessActiveSoftTimeouts.delete(id);
        resolve(result);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        awarenessActiveSoftTimeouts.delete(id);
        reject(error);
      });
  });

const reconcileAwarenessSoftTimeouts = (trigger: string, invalidatePageBound = false) => {
  const now = Date.now();
  let expiredCount = 0;
  let stalePageCount = 0;
  Array.from(awarenessActiveSoftTimeouts.values()).forEach((entry) => {
    const deadlineExpired = now >= entry.deadlineAt;
    const stalePage =
      entry.pageBound && (invalidatePageBound || entry.pageGeneration !== awarenessPageGeneration);
    if (!deadlineExpired && !stalePage) return;
    if (deadlineExpired) expiredCount += 1;
    if (stalePage) stalePageCount += 1;
    entry.expire(deadlineExpired ? `absolute-deadline:${trigger}` : `page-generation:${trigger}`);
  });
  if (expiredCount > 0 || stalePageCount > 0) {
    appendAwarenessDiagnosticLog('business-soft-timeout-reconciled', {
      trigger,
      expiredCount,
      stalePageCount,
      pageGeneration: awarenessPageGeneration,
      activeCount: awarenessActiveSoftTimeouts.size,
      snapshot: getAwarenessConnectionSnapshot()
    });
  }
};

const shouldSkipLegacyHomeHistoryByCloudCoverage = async (protocol: string, trigger: string) => {
  const deviceMac = getAwarenessCheckpointDeviceMac() || getAwarenessUploadDeviceMac();
  const normalizedDeviceMac = normalizeHistoryCheckpointDeviceMac(deviceMac);
  const date = formatLocalDate(new Date());
  const checkpointTimestamp = getAwarenessReadCheckpointTimestamp();
  const checkpointMeta = getDeviceHistoryCheckpointMeta(deviceMac, protocol);
  const lastHistoryReadCompletedAt = Number(checkpointMeta?.lastHistoryReadCompletedAt || 0);
  const recentCompleteHistoryRead =
    lastHistoryReadCompletedAt > 0 &&
    Date.now() - lastHistoryReadCompletedAt >= 0 &&
    Date.now() - lastHistoryReadCompletedAt < AWARENESS_HOME_SYNC_COOLDOWN_MS;
  if (!normalizedDeviceMac) {
    appendAwarenessDiagnosticLog('legacy-home-cloud-coverage-skip-check-missing-device', {
      protocol,
      trigger,
      date,
      checkpointTimestamp,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }

  const startedAt = Date.now();
  try {
    const response = await withAwarenessSoftTimeout(
      `legacy-home-cloud-coverage:${normalizedDeviceMac}:${date}`,
      LEGACY_HOME_CLOUD_COVERAGE_TIMEOUT_MS,
      () =>
        getRingHistoryCoverage(
          {
            deviceMac,
            date,
            freshWindowSeconds: Math.floor(LEGACY_HOME_CLOUD_COVERAGE_FRESH_MS / 1000)
          } as any,
          getAwarenessSilentRequestConfig(LEGACY_HOME_CLOUD_COVERAGE_TIMEOUT_MS)
        ),
      undefined,
      { pageBound: true }
    );
    const data = unwrapAwarenessApiData(response) as Record<string, any>;
    const recordCount = Number(data?.recordCount || data?.count || 0);
    const latestTimestamp = Math.floor(Number(data?.latestTimestamp || data?.latestUnixTimestamp || 0));
    const ageSeconds = Number(data?.ageSeconds);
    const coverageStatus = String(data?.coverageStatus || '').trim();
    const backendFresh = data?.shouldSkipBle === true || coverageStatus === 'fresh';
    rememberLegacyHomeCloudCoverageSnapshot(normalizedDeviceMac, date, {
      recordCount: Number.isFinite(recordCount) ? recordCount : 0,
      latestTimestamp: Number.isFinite(latestTimestamp) ? latestTimestamp : 0,
      coverageStatus,
      shouldSkipBle: data?.shouldSkipBle === true
    });
    const checkpointCovered =
      checkpointTimestamp > 0 &&
      latestTimestamp > 0 &&
      latestTimestamp >= Math.max(0, checkpointTimestamp - LEGACY_HISTORY_READ_CHECKPOINT_OVERLAP_SECONDS);
    // Backend freshness proves that cached data can be rendered, not that the
    // device has no unread tail. Skip BLE only when a recent complete 0x36
    // session independently established that fact.
    const shouldSkip = recordCount > 0 && backendFresh && checkpointCovered && recentCompleteHistoryRead;

    appendAwarenessDiagnosticLog('legacy-home-cloud-coverage-result', {
      protocol,
      trigger,
      date,
      deviceMac,
      normalizedDeviceMac,
      recordCount,
      latestTimestamp,
      latestRecordTime: data?.latestRecordTime,
      checkpointTimestamp,
      checkpointCovered,
      coverageStatus,
      backendFresh,
      recentCompleteHistoryRead,
      lastHistoryReadCompletedAt,
      ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : undefined,
      shouldSkip,
      elapsedMs: Date.now() - startedAt,
      snapshot: getAwarenessConnectionSnapshot()
    });

    return shouldSkip;
  } catch (error) {
    appendAwarenessDiagnosticLog('legacy-home-cloud-coverage-failed', {
      protocol,
      trigger,
      date,
      deviceMac,
      normalizedDeviceMac,
      checkpointTimestamp,
      elapsedMs: Date.now() - startedAt,
      error: formatBleErrorMessage(error, 'cloud coverage check failed'),
      rawError: getAwarenessRawError(error),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }
};

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

const releaseAwarenessAuxiliaryRefresh = (key: string, date: Date, reason: string) => {
  const cacheKey = getAwarenessAuxiliaryCacheKey(key, date);
  const released = awarenessAuxiliaryRefreshAt.delete(cacheKey);
  if (released) {
    appendAwarenessDiagnosticLog('business-aux-request-cache-released', {
      key,
      date: formatLocalDate(date),
      reason,
      cacheKey,
      snapshot: getAwarenessConnectionSnapshot()
    });
  }
  return released;
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
    } else {
      releaseAwarenessAuxiliaryRefresh(key, date, 'empty-or-failed-response');
    }
  });
};

const requestAwarenessOverview = async <T>(key: string, date: Date, task: () => Promise<T>): Promise<T | null> => {
  const startedAt = Date.now();
  const timeoutMs = getAwarenessBusinessRequestSoftTimeoutMs(key);
  appendAwarenessDiagnosticLog('business-overview-request-start', {
    key,
    date: formatLocalDate(date),
    timeoutMs,
    snapshot: getAwarenessConnectionSnapshot()
  });
  try {
    const result = await withAwarenessSoftTimeout(key, timeoutMs, task, undefined, { pageBound: true });
    appendAwarenessDiagnosticLog('business-overview-request-success', {
      key,
      date: formatLocalDate(date),
      elapsedMs: Date.now() - startedAt,
      timeoutMs,
      summary: summarizeAwarenessResponse(result),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return result;
  } catch (error) {
    appendAwarenessDiagnosticLog('business-overview-request-failed', {
      key,
      date: formatLocalDate(date),
      elapsedMs: Date.now() - startedAt,
      timeoutMs,
      error: formatAwarenessBusinessRequestError(error),
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
    const result = await withAwarenessSoftTimeout(
      key,
      AWARENESS_AUXILIARY_REQUEST_SOFT_TIMEOUT_MS,
      task,
      undefined,
      { pageBound: true }
    );
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
    getBalanceScore({ date }, getAwarenessOverviewRequestConfig('balanceScore'))
  );
  if (res) {
    balanceScoreObj.value = res;
  }
};

const getSleepOverviewData = async (currentDate = new Date()) => {
  const date = formatLocalDate(currentDate);
  const requestSeq = ++sleepOverviewRequestSeq;
  const cachedOverview = sleepOverviewDateCache.get(date);
  if (sleepOverviewConfirmedDate.value !== date && cachedOverview) {
    sleepOverviewObj.value = cachedOverview;
    sleepOverviewConfirmedDate.value = date;
  }
  const res = await requestAwarenessOverview('sleepOverview', currentDate, () =>
    getSleepOverview({ date }, getAwarenessOverviewRequestConfig('sleepOverview'))
  );
  if (requestSeq !== sleepOverviewRequestSeq) return;
  if (res) {
    sleepOverviewObj.value = res;
    sleepOverviewConfirmedDate.value = date;
    rememberSleepOverviewForDate(date, res);
    return;
  }
  appendAwarenessDiagnosticLog('business-overview-sleep-preserved-after-failure', {
    date,
    preservedDate: sleepOverviewConfirmedDate.value,
    hasPreservedData: Boolean(sleepOverviewObj.value),
    hasDateCache: Boolean(cachedOverview),
    snapshot: getAwarenessConnectionSnapshot()
  });
};

const getMotionOverviewData = async (currentDate = new Date()) => {
  const date = formatLocalDate(currentDate);
  const [res, resT] = await Promise.all([
    requestAwarenessOverview('motionOverview', currentDate, () => getMotionOverview({ date }, getAwarenessOverviewRequestConfig('motionOverview'))),
    requestAwarenessOverview('motionSummary', currentDate, () => getMotionSummary({ date }, getAwarenessOverviewRequestConfig('motionSummary')))
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


const getStressInfo = async (currentDate = new Date(), forceRefresh = false) => {

  const localDate = formatLocalDate(new Date());
  const dateKey = formatLocalDate(currentDate);
  let offset = 0;
  if (selectedDayIndex.value === 3) {
    const today = new Date();

    const diffTime = today.getTime() - currentDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    offset = -diffDays;
  } else {
    offset = selectedDayIndex.value - 2;
  }
  const refreshKey = `${getAwarenessHomeUploadDeviceKey()}:${dateKey}:${selectedDayIndex.value}:${offset}`;
  const now = Date.now();
  const lastAt = awarenessStressInfoRefreshAt.get(refreshKey) || 0;
  if (!forceRefresh && lastAt && now - lastAt < AWARENESS_STRESS_INFO_REFRESH_TTL_MS) {
    appendAwarenessDiagnosticLog('business-overview-stress-cache-skip', {
      key: refreshKey,
      date: dateKey,
      elapsedMs: now - lastAt,
      ttlMs: AWARENESS_STRESS_INFO_REFRESH_TTL_MS,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }
  awarenessStressInfoRefreshAt.set(refreshKey, now);
  const [res, resT] = await Promise.all([
    requestAwarenessOverview('stressDetail', currentDate, () =>
      getStressData({
        date: localDate,
        type: 'day',
        offset
      }, getAwarenessOverviewRequestConfig('stressDetail'))
    ).catch((error) => {
      appendAwarenessDiagnosticLog('business-overview-stress-partial-failed', {
        request: 'stressDetail',
        date: dateKey,
        error: formatBleErrorMessage(error, 'stress detail request failed'),
        rawError: getAwarenessRawError(error),
        snapshot: getAwarenessConnectionSnapshot()
      });
      return null;
    }),
    requestAwarenessOverview('stressSummary', currentDate, () =>
      getStressSummary({ date: formatLocalDate(currentDate) }, getAwarenessOverviewRequestConfig('stressSummary'))
    ).catch((error) => {
      appendAwarenessDiagnosticLog('business-overview-stress-partial-failed', {
        request: 'stressSummary',
        date: dateKey,
        error: formatBleErrorMessage(error, 'stress summary request failed'),
        rawError: getAwarenessRawError(error),
        snapshot: getAwarenessConnectionSnapshot()
      });
      return null;
    })
  ]);
  if (res) {
    stressDetailObj.value = res;
  }
  if (resT) {
    stressSummaryObj.value = resT;
  }
  if (!res && !resT) {
    awarenessStressInfoRefreshAt.delete(refreshKey);
  }
};

const getVitalSigns = async (currentDate = new Date()) => {
  const date = formatLocalDate(currentDate);
  const res = await requestAwarenessOverview('vitalSign', currentDate, () =>
    getVitalSign({ date }, getAwarenessOverviewRequestConfig('vitalSign'))
  );
  if (res) {
    vitalSignObj.value = res;
  }
};

type AwarenessBusinessRefreshOptions = {
  allowDuringSync?: boolean;
  trigger?: string;
  sourceTrigger?: string;
  forceStressRefresh?: boolean;
};
const consumePostBindingRefreshFlag = () => {
  try {
    const markedAt = Number(uni.getStorageSync(POST_BINDING_REFRESH_STORAGE_KEY) || 0);
    if (!markedAt) return false;
    uni.removeStorageSync(POST_BINDING_REFRESH_STORAGE_KEY);
    return Date.now() - markedAt <= POST_BINDING_REFRESH_MAX_AGE_MS;
  } catch {
    return false;
  }
};

const getAwarenessSyncGateSnapshot = () =>
  buildDeviceSyncGateSnapshot({
    homeSyncing: homeDataSyncing.value,
    businessRefreshRunning: Boolean(awarenessRefreshPromise),
    historySyncRunning: Boolean(awarenessHistorySyncPromise),
    historyReadRunning: legacyHomeHistoryReadInFlight.value,
    historyReadPromiseRunning: Boolean(legacyHomeHistoryReadPromise),
    stableSnapshotRunning: Boolean(legacyLocalDataStablePromise),
    stableUploadScheduled: legacyLocalDataStableUploadScheduled,
    uploadRunning: Boolean(legacyLocalDataUploadPromise),
    finalRefreshRunning:
      homeDataRefreshingAfterSync.value || homeFreshBatteryReadingAfterSync.value
  });

const isAwarenessBackgroundDataSyncInProgress = () =>
  getAwarenessSyncGateSnapshot().backgroundSyncing;

const hasAwarenessActualBackgroundWork = () =>
  Boolean(
    awarenessHistorySyncPromise ||
      legacyHomeHistoryReadInFlight.value ||
      legacyHomeHistoryReadPromise ||
      legacyLocalDataStablePromise ||
      legacyLocalDataStableUploadScheduled ||
      legacyLocalDataUploadWatcherActive ||
      legacyLocalDataUploadWatcherPending ||
      legacyLocalDataUploadPromise ||
      pendingParsedUploadRetryPromise ||
      (pendingParsedUploadRetryTimer && Boolean(activeAwarenessHomeSyncClaim || homeDataSyncing.value)) ||
      homeDataRefreshingAfterSync.value ||
      homeFreshBatteryReadingAfterSync.value ||
      awarenessProcessedRefreshPromise
  );

const reconcileAwarenessVisibleSyncState = (trigger: string) => {
  const stillRunning = hasAwarenessActualBackgroundWork();
  appendAwarenessDiagnosticLog('home-sync-visible-state-reconcile', {
    trigger,
    stillRunning,
    homeDataSyncing: homeDataSyncing.value,
    uploadingStatus: userStore.uploadingStatus,
    isSending: userStore.isSending,
    snapshot: getAwarenessConnectionSnapshot()
  });
  if (stillRunning) return false;
  homeDataSyncing.value = false;
  homeSyncRunningInBackground.value = false;
  userStore.updateIsSending(false);
  if (userStore.uploadingStatus === 'uploading') {
    userStore.updateUploadingStatus('2');
  }
  return true;
};

function scheduleAwarenessVisibleSyncReconcile(trigger: string) {
  // Promise references are cleared in their own finally blocks. Reconcile on
  // the next task so the just-finished promise is not mistaken for live work.
  setTimeout(() => {
    reconcileAwarenessVisibleSyncState(trigger);
  }, 0);
}

const isAwarenessDataSyncInProgress = () => getAwarenessSyncGateSnapshot().dataSyncing;

const isAwarenessBusinessRefreshDeferredBySync = () =>
  getAwarenessSyncGateSnapshot().deferBusinessRefresh;

const waitForAwarenessAuxiliaryIdleSlot = async (key: string) => {
  const startedAt = Date.now();
  await waitForAwarenessMs(AWARENESS_AUXILIARY_SYNC_IDLE_INITIAL_DELAY_MS);
  while (isAwarenessDataSyncInProgress() && Date.now() - startedAt < AWARENESS_AUXILIARY_SYNC_IDLE_MAX_WAIT_MS) {
    await waitForAwarenessMs(AWARENESS_AUXILIARY_SYNC_IDLE_POLL_MS);
  }
  const stillSyncing = isAwarenessDataSyncInProgress();
  appendAwarenessDiagnosticLog('business-aux-request-idle-slot', {
    key,
    waitedMs: Date.now() - startedAt,
    stillSyncing,
    homeDataSyncing: homeDataSyncing.value,
    legacyHomeHistoryReadInFlight: legacyHomeHistoryReadInFlight.value,
    hasLegacyHomeHistoryReadPromise: Boolean(legacyHomeHistoryReadPromise),
    hasLegacyLocalDataUploadPromise: Boolean(legacyLocalDataUploadPromise),
    snapshot: getAwarenessConnectionSnapshot()
  });
  return !stillSyncing;
};

const isAwarenessFinalBusinessRefreshTrigger = (trigger = '') =>
  /upload-complete|upload-summary-ready|sync-result/.test(trigger);

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
    await withAwarenessSoftTimeout(
      `stage:${stage}`,
      AWARENESS_BUSINESS_STAGE_SOFT_TIMEOUT_MS,
      task,
      undefined,
      { pageBound: true }
    );
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
  const stressRefreshTask = (async () => {
    await runAwarenessBusinessRefreshStage('stressInfo', date, options, () =>
      getStressInfo(currentDate, options.forceStressRefresh === true)
    );
    await runAwarenessBusinessRefreshStage('chart.relax', date, options, () => initRelaxChart());
  })();
  if (options.forceStressRefresh) {
    await stressRefreshTask;
  } else {
    void stressRefreshTask;
  }
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
  const syncGate = getAwarenessSyncGateSnapshot();
  if (!options.allowDuringSync && syncGate.deferBusinessRefresh) {
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
      gateReasons: syncGate.reasons,
      gate: syncGate,
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

  const taskGeneration = awarenessPageGeneration;
  const taskRefreshKey = getAwarenessBusinessRefreshQueueKey(date, trigger, options.sourceTrigger);
  runningAwarenessBusinessRefreshKey = taskRefreshKey;
  const businessRefreshTask = runAwarenessBusinessOverviewRefresh(date, options);
  awarenessBusinessRefreshPromise = businessRefreshTask;
  try {
    await businessRefreshTask;
    if (taskGeneration !== awarenessPageGeneration) {
      appendAwarenessDiagnosticLog('business-overview-refresh-stale-result-ignored', {
        trigger,
        date,
        taskRefreshKey,
        taskGeneration,
        currentPageGeneration: awarenessPageGeneration,
        snapshot: getAwarenessConnectionSnapshot()
      });
      return;
    }
    lastAwarenessBusinessRefreshDate = date;
    lastAwarenessBusinessRefreshAt = Date.now();
    if (isAwarenessFinalBusinessRefreshKey(taskRefreshKey)) {
      lastAwarenessFinalRefreshKey = taskRefreshKey;
      lastAwarenessFinalRefreshAt = lastAwarenessBusinessRefreshAt;
    }
  } finally {
    if (awarenessBusinessRefreshPromise !== businessRefreshTask) return;
    awarenessBusinessRefreshPromise = null;
    const staleTask = taskGeneration !== awarenessPageGeneration;
    if (staleTask) {
      runningAwarenessBusinessRefreshKey = '';
      pendingAwarenessBusinessRefreshDate = '';
      pendingAwarenessBusinessRefreshTrigger = '';
      pendingAwarenessBusinessRefreshKey = '';
      appendAwarenessDiagnosticLog('business-overview-refresh-stale-task-released', {
        trigger,
        date,
        taskRefreshKey,
        taskGeneration,
        currentPageGeneration: awarenessPageGeneration,
        snapshot: getAwarenessConnectionSnapshot()
      });
      return;
    }
    const queuedDate = pendingAwarenessBusinessRefreshDate;
    const queuedTrigger = pendingAwarenessBusinessRefreshTrigger;
    const queuedKey = pendingAwarenessBusinessRefreshKey;
    const finishedRefreshKey = taskRefreshKey;
    const shouldDropQueuedRefreshAfterFinal =
      Boolean(queuedDate) && isAwarenessFinalBusinessRefreshKey(finishedRefreshKey);
    const shouldDropQueuedRefreshAsDuplicate =
      Boolean(queuedDate) &&
      queuedDate === lastAwarenessBusinessRefreshDate &&
      lastAwarenessBusinessRefreshAt > 0 &&
      Date.now() - lastAwarenessBusinessRefreshAt < AWARENESS_BUSINESS_REFRESH_QUEUE_DEDUP_MS;
    const shouldRunQueuedRefresh =
      Boolean(queuedDate) &&
      !shouldDropQueuedRefreshAfterFinal &&
      !shouldDropQueuedRefreshAsDuplicate &&
      !isAwarenessBusinessRefreshDeferredBySync();
    runningAwarenessBusinessRefreshKey = '';
    if (shouldRunQueuedRefresh || shouldDropQueuedRefreshAfterFinal || shouldDropQueuedRefreshAsDuplicate) {
      pendingAwarenessBusinessRefreshDate = '';
      pendingAwarenessBusinessRefreshTrigger = '';
      pendingAwarenessBusinessRefreshKey = '';
    }
    if (shouldDropQueuedRefreshAfterFinal || shouldDropQueuedRefreshAsDuplicate) {
      appendAwarenessDiagnosticLog('business-overview-refresh-queue-drop', {
        trigger: shouldDropQueuedRefreshAfterFinal ? 'drop-after-final-refresh' : 'drop-duplicate-same-date-refresh',
        sourceTrigger: queuedTrigger,
        date: queuedDate,
        queueKey: queuedKey,
        finishedRefreshKey,
        reason: shouldDropQueuedRefreshAfterFinal ? 'final-refresh-already-ran' : 'same-date-refresh-just-finished',
        elapsedSinceRefreshMs:
          lastAwarenessBusinessRefreshAt > 0 ? Date.now() - lastAwarenessBusinessRefreshAt : 0,
        dedupMs: AWARENESS_BUSINESS_REFRESH_QUEUE_DEDUP_MS,
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
          allowDuringSync: false,
          trigger: 'queued-after-running',
          sourceTrigger: queuedTrigger
        });
      }, 0);
    }
  }
};

let awarenessIdentityOverviewRefreshPromise: Promise<void> | null = null;
let lastAwarenessIdentityOverviewRefreshMac = '';
const scheduleAwarenessIdentityOverviewRefresh = (sourceTrigger: string) => {
  const requestedMac = normalizeHistoryCheckpointDeviceMac(getAwarenessCanonicalDeviceMac());
  if (!requestedMac || !awarenessPageActive.value || !userStore.token) return;
  if (requestedMac === lastAwarenessIdentityOverviewRefreshMac) return;
  if (awarenessIdentityOverviewRefreshPromise) return;

  const task = (async () => {
    // 首次概览可能正以空设备身份执行；必须等它结束后再主动补拉，不能进入
    // 普通队列后被“同日重复请求”策略丢弃。
    if (awarenessBusinessRefreshPromise) {
      await awarenessBusinessRefreshPromise.catch(() => undefined);
      await waitForAwarenessMs(0);
    }
    if (
      !awarenessPageActive.value ||
      !userStore.token ||
      normalizeHistoryCheckpointDeviceMac(getAwarenessCanonicalDeviceMac()) !== requestedMac
    ) {
      return;
    }
    appendAwarenessDiagnosticLog('business-overview-device-identity-ready-refresh-start', {
      sourceTrigger,
      deviceMac: requestedMac,
      snapshot: getAwarenessConnectionSnapshot()
    });
    await refreshAwarenessBusinessOverview(formatLocalDate(today.value || new Date()), {
      allowDuringSync: true,
      trigger: 'device-identity-ready',
      sourceTrigger
    });
    lastAwarenessIdentityOverviewRefreshMac = requestedMac;
    appendAwarenessDiagnosticLog('business-overview-device-identity-ready-refresh-result', {
      sourceTrigger,
      deviceMac: requestedMac,
      snapshot: getAwarenessConnectionSnapshot()
    });
  })();
  awarenessIdentityOverviewRefreshPromise = task;
  void task.then(
    () => {
      if (awarenessIdentityOverviewRefreshPromise === task) {
        awarenessIdentityOverviewRefreshPromise = null;
      }
    },
    (error) => {
      appendAwarenessDiagnosticLog('business-overview-device-identity-ready-refresh-failed', {
        sourceTrigger,
        deviceMac: requestedMac,
        error: formatBleErrorMessage(error, 'device identity overview refresh failed'),
        snapshot: getAwarenessConnectionSnapshot()
      });
      if (awarenessIdentityOverviewRefreshPromise === task) {
        awarenessIdentityOverviewRefreshPromise = null;
      }
    }
  );
};

watch(
  () => normalizeHistoryCheckpointDeviceMac(getAwarenessCanonicalDeviceMac()),
  (deviceMac, previousDeviceMac) => {
    if (!deviceMac || deviceMac === previousDeviceMac) return;
    scheduleAwarenessIdentityOverviewRefresh(previousDeviceMac ? 'device-identity-changed' : 'device-identity-restored');
  },
  { flush: 'post' }
);

const refreshAwarenessAfterDataProcessed = async (reason: string, date = getSelectedDetailDate()) => {
  const now = Date.now();
  const pendingRefreshTrigger = pendingAwarenessBusinessRefreshTrigger;
  const pendingRefreshKey = pendingAwarenessBusinessRefreshKey;
  const hadPendingBusinessRefresh = Boolean(pendingAwarenessBusinessRefreshDate || pendingAwarenessBusinessRefreshKey);
  const refreshDate = pendingAwarenessBusinessRefreshDate || date;
  pendingAwarenessBusinessRefreshDate = '';
  pendingAwarenessBusinessRefreshTrigger = '';
  pendingAwarenessBusinessRefreshKey = '';
  const shouldForceProcessedRefresh = hadPendingBusinessRefresh || isAwarenessFinalBusinessRefreshTrigger(reason);
  const finalRefreshTrigger = isAwarenessFinalBusinessRefreshTrigger(reason)
    ? reason
    : isAwarenessFinalBusinessRefreshTrigger(pendingRefreshTrigger)
      ? pendingRefreshTrigger
      : '';
  const finalRefreshKey = finalRefreshTrigger ? getAwarenessBusinessRefreshQueueKey(refreshDate, finalRefreshTrigger) : '';
  if (awarenessProcessedRefreshPromise) {
    const shouldQueueAfterRunning = Boolean(
      finalRefreshKey && finalRefreshKey !== runningAwarenessProcessedRefreshKey
    );
    if (shouldQueueAfterRunning) {
      pendingAwarenessProcessedRefresh = {
        reason: finalRefreshTrigger || reason,
        date: refreshDate,
        finalRefreshKey
      };
    }
    appendAwarenessDiagnosticLog('business-processed-refresh-skip', {
      reason: shouldQueueAfterRunning ? 'queued-after-running' : 'dedup-running',
      trigger: reason,
      pendingTrigger: pendingRefreshTrigger,
      date: refreshDate,
      forced: shouldForceProcessedRefresh,
      finalRefreshKey,
      runningRefreshKey: runningAwarenessProcessedRefreshKey,
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
  const taskGeneration = awarenessPageGeneration;
  const processedRefreshTask = (async () => {
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
    await refreshAwarenessBusinessOverview(refreshDate, {
      allowDuringSync: true,
      trigger: reason,
      forceStressRefresh: true
    });
    if (taskGeneration !== awarenessPageGeneration) {
      appendAwarenessDiagnosticLog('business-processed-refresh-stale-result-ignored', {
        trigger: reason,
        date: refreshDate,
        taskGeneration,
        currentPageGeneration: awarenessPageGeneration,
        snapshot: getAwarenessConnectionSnapshot()
      });
      return;
    }
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
    // The request result only means the refs have been assigned. Keep the
    // visible refresh state until Vue/uni-app has committed those values to
    // the page, so the status and the cards switch in the same rendered frame.
    await nextTick();
    appendAwarenessDiagnosticLog('business-processed-refresh-rendered', {
      trigger: reason,
      date: refreshDate,
      elapsedMs: Date.now() - startedAt,
      finalRefreshKey
    });
  })();
  runningAwarenessProcessedRefreshKey = finalRefreshKey || getAwarenessBusinessRefreshQueueKey(refreshDate, reason);
  awarenessProcessedRefreshPromise = processedRefreshTask;
  try {
    await processedRefreshTask;
  } finally {
    if (awarenessProcessedRefreshPromise !== processedRefreshTask) return;
    awarenessProcessedRefreshPromise = null;
    runningAwarenessProcessedRefreshKey = '';
    homeDataRefreshingAfterSync.value = false;
    scheduleAwarenessVisibleSyncReconcile(`processed-refresh-finished:${reason}`);
    const queuedRefresh = pendingAwarenessProcessedRefresh;
    pendingAwarenessProcessedRefresh = null;
    if (queuedRefresh) {
      setTimeout(() => {
        void refreshAwarenessAfterDataProcessed(queuedRefresh.reason, queuedRefresh.date).catch((error) => {
          appendAwarenessDiagnosticLog('business-processed-refresh-queued-failed', {
            trigger: queuedRefresh.reason,
            date: queuedRefresh.date,
            finalRefreshKey: queuedRefresh.finalRefreshKey,
            error: formatBleErrorMessage(error, 'queued business overview refresh failed'),
            rawError: getAwarenessRawError(error),
            snapshot: getAwarenessConnectionSnapshot()
          });
        });
      }, 0);
    }
  }
};

const scheduleAwarenessAfterDataProcessed = (reason: string, date = getSelectedDetailDate()) => {
  // Overview data comes from the backend and does not need the BLE/history or
  // background-upload session to be idle. Refresh immediately for every
  // terminal/preflight event; refreshAwarenessAfterDataProcessed coalesces
  // duplicates and guarantees that a later final event is replayed once.
  void refreshAwarenessAfterDataProcessed(reason, date).catch((error) => {
    appendAwarenessDiagnosticLog('business-processed-refresh-schedule-failed', {
      trigger: reason,
      date,
      immediateRefresh: true,
      error: formatBleErrorMessage(error, 'business overview refresh failed'),
      rawError: getAwarenessRawError(error),
      snapshot: getAwarenessConnectionSnapshot()
    });
  });
};

const getAwarenessLocalDateKeyFromTimestamp = (timestampMs: number): string => {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return '';
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const syncRwHomeDeviceTimeBeforeHistory = async (
  trigger: string,
  options: { allowLegacy?: boolean; force?: boolean; forceIfStaleMs?: number } = {}
) => {
  const isRwRing = isAwarenessRwRing();
  if (!hasAwarenessRuntimeCommunicationReady()) return false;

  const now = Date.now();
  const syncIdentity = getAwarenessDeviceTimeSyncIdentity();
  const lastSyncAt = awarenessDeviceTimeSyncAtByIdentity.get(syncIdentity) || 0;
  const elapsedSinceSyncMs = lastSyncAt > 0 ? now - lastSyncAt : Number.POSITIVE_INFINITY;
  const forceIfStaleMs = Number(options.forceIfStaleMs || RW_AWARENESS_DEVICE_TIME_SYNC_STALE_MS);
  const crossedLocalDate =
    lastSyncAt > 0 &&
    getAwarenessLocalDateKeyFromTimestamp(lastSyncAt) !== getAwarenessLocalDateKeyFromTimestamp(now);
  const staleForTrigger =
    lastSyncAt > 0 &&
    Number.isFinite(forceIfStaleMs) &&
    forceIfStaleMs > 0 &&
    elapsedSinceSyncMs >= forceIfStaleMs;
  const bypassDedupReason =
    options.force === true ? 'force' : crossedLocalDate ? 'cross-day' : staleForTrigger ? 'stale' : '';
  if (
    elapsedSinceSyncMs >= 0 &&
    elapsedSinceSyncMs < RW_AWARENESS_DEVICE_TIME_SYNC_DEDUP_MS &&
    !bypassDedupReason
  ) {
    appendAwarenessDiagnosticLog('device-time-sync-skip', {
      reason: 'dedup-recent',
      trigger,
      isRwRing,
      allowLegacy: options.allowLegacy === true,
      force: options.force === true,
      forceIfStaleMs,
      crossedLocalDate,
      syncIdentity,
      elapsedMs: elapsedSinceSyncMs,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return true;
  }

  const timezone = -new Date().getTimezoneOffset() / 60;
  const startedAt = Date.now();
  appendAwarenessDiagnosticLog('device-time-sync-start', {
    trigger,
    isRwRing,
    allowLegacy: options.allowLegacy === true,
    force: options.force === true,
    forceIfStaleMs,
    crossedLocalDate,
    bypassDedupReason: bypassDedupReason || undefined,
    syncIdentity,
    timestampMs: now,
    timezone,
    snapshot: getAwarenessConnectionSnapshot()
  });

  try {
    await updateDeviceTime(now, timezone);
    awarenessDeviceTimeSyncAtByIdentity.set(syncIdentity, Date.now());
    appendAwarenessDiagnosticLog('device-time-sync-result', {
      trigger,
      isRwRing,
      allowLegacy: options.allowLegacy === true,
      force: options.force === true,
      forceIfStaleMs,
      crossedLocalDate,
      bypassDedupReason: bypassDedupReason || undefined,
      syncIdentity,
      elapsedMs: Date.now() - startedAt,
      timestampMs: now,
      timezone,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return true;
  } catch (error) {
    appendAwarenessDiagnosticLog('device-time-sync-failed', {
      trigger,
      isRwRing,
      allowLegacy: options.allowLegacy === true,
      force: options.force === true,
      forceIfStaleMs,
      crossedLocalDate,
      bypassDedupReason: bypassDedupReason || undefined,
      syncIdentity,
      elapsedMs: Date.now() - startedAt,
      timestampMs: now,
      timezone,
      error: formatBleErrorMessage(error, '\u8bbe\u5907\u65f6\u95f4\u6821\u51c6\u5931\u8d25'),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
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

const handleCalendarDayTap = (index: number) =>
  handleDateClick(index, { allowDuringSync: true, trigger: 'date-click' });

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

const handleCalendarConfirm = (date: any) =>
  confirm(date, { allowDuringSync: true, trigger: 'date-confirm' });

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
const getHomeDeviceInfoBeforeHistoryTimeoutMs = () =>
  isAwarenessRwRing() ? RW_HOME_DEVICE_INFO_BEFORE_HISTORY_TIMEOUT_MS : LEGACY_HOME_DEVICE_INFO_BEFORE_HISTORY_TIMEOUT_MS;
const isLegacyHomeHistoryReadLocallyActive = () =>
  Boolean(legacyHomeHistoryReadInFlight.value || legacyHomeHistoryReadPromise || legacyHomeHistoryReadActiveScopeKey);
const scheduleLegacyHomeDeviceInfoRetryAfterHistory = (
  protocol: string,
  hasCachedSnapshot: boolean,
  reason: string,
  skipReason: string,
  freshBatteryBarrierId?: number,
  batteryOnly = false
) => {
  legacyHomeDeviceInfoRefreshPendingRetry = {
    protocol,
    hasCachedSnapshot,
    reason,
    skipReason,
    freshBatteryBarrierId,
    batteryOnly
  };
  appendAwarenessDiagnosticLog('legacy-home-device-info-retry-scheduled', {
    protocol,
    reason,
    skipReason,
    hasCachedSnapshot,
    historyReadKey: legacyHomeHistoryReadActiveKey,
    historyScopeKey: legacyHomeHistoryReadActiveScopeKey,
    inFlight: legacyHomeHistoryReadInFlight.value,
    hasPromise: Boolean(legacyHomeHistoryReadPromise),
    freshBatteryBarrierId: freshBatteryBarrierId || 0,
    batteryOnly,
    snapshot: getAwarenessConnectionSnapshot()
  });
};
const scheduleLegacyHomeDeviceInfoRetryFlush = (trigger: string, delayMs = 1000) => {
  if (legacyHomeDeviceInfoRetryDeferredTimer) return;
  legacyHomeDeviceInfoRetryDeferredTimer = setTimeout(() => {
    legacyHomeDeviceInfoRetryDeferredTimer = null;
    flushLegacyHomeDeviceInfoPendingRetry(trigger);
  }, delayMs);
};
const refreshLegacyHomeDeviceInfoBeforeHistorySync = async (
  protocol: string,
  hasCachedSnapshot: boolean,
  reason = 'legacy-home-sync-before-history'
) => {
  if (!validateAwarenessHomeSyncContext('legacy-home-device-info-before-history-precheck', {
    requireReady: true,
    allowMissingCurrent: false
  })) {
    appendAwarenessDiagnosticLog('legacy-home-device-info-before-history-skip', {
      protocol,
      reason,
      skipReason: 'sync-context-or-communication-not-ready',
      hasCachedSnapshot,
      battery: displayBatteryValue.value,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }

  if (legacyHomeDeviceInfoRefreshPromise) {
    const startedAt = Date.now();
    appendAwarenessDiagnosticLog('legacy-home-device-info-before-history-wait-existing', {
      protocol,
      reason,
      hasCachedSnapshot,
      battery: displayBatteryValue.value,
      snapshot: getAwarenessConnectionSnapshot()
    });
    try {
      await legacyHomeDeviceInfoRefreshPromise;
    } catch (error) {
      appendAwarenessDiagnosticLog('legacy-home-device-info-before-history-existing-failed', {
        protocol,
        reason,
        elapsedMs: Date.now() - startedAt,
        error: formatBleErrorMessage(error, 'legacy device info refresh failed'),
        rawError: getAwarenessRawError(error),
        snapshot: getAwarenessConnectionSnapshot()
      });
    }
    const hasBattery = hasAwarenessFreshBatteryDisplayValue();
    appendAwarenessDiagnosticLog('legacy-home-device-info-before-history-existing-result', {
      protocol,
      reason,
      elapsedMs: Date.now() - startedAt,
      hasBattery,
      battery: displayBatteryValue.value,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return hasBattery;
  }

  const startedAt = Date.now();
  const timeoutMs = getHomeDeviceInfoBeforeHistoryTimeoutMs();
  appendAwarenessDiagnosticLog('legacy-home-device-info-before-history-start', {
    protocol,
    reason,
    hasCachedSnapshot,
    timeoutMs,
    batteryBefore: displayBatteryValue.value,
    snapshot: getAwarenessConnectionSnapshot()
  });

  let refreshResult: unknown = null;
  legacyHomeDeviceInfoRefreshPromise = (async () => {
    refreshResult = await refreshHealthData({
      includeDeviceTime: false,
      includeCollectPeriod: false,
      includeDeviceInfo: true,
      includeRealtimeMetrics: false,
      includeHistorySnapshot: false,
      timeoutMs
    });
    lastAwarenessRefreshAt = Date.now();
  })();

  try {
    await legacyHomeDeviceInfoRefreshPromise;
    const hasBattery = hasAwarenessFreshBatteryDisplayValue();
    appendAwarenessDiagnosticLog('legacy-home-device-info-before-history-result', {
      protocol,
      reason,
      elapsedMs: Date.now() - startedAt,
      hasCachedSnapshot,
      hasBattery,
      battery: displayBatteryValue.value,
      result: refreshResult,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return hasBattery;
  } catch (error) {
    appendAwarenessDiagnosticLog('legacy-home-device-info-before-history-failed', {
      protocol,
      reason,
      elapsedMs: Date.now() - startedAt,
      hasCachedSnapshot,
      battery: displayBatteryValue.value,
      error: formatBleErrorMessage(error, 'legacy device info refresh failed'),
      rawError: getAwarenessRawError(error),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  } finally {
    legacyHomeDeviceInfoRefreshPromise = null;
  }
};
const refreshLegacyHomeDeviceInfoInBackground = (
  protocol: string,
  hasCachedSnapshot: boolean,
  reason = 'legacy-home-sync'
): Promise<void> => {
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
    return Promise.resolve();
  }

  if (!isAwarenessRwRing() && isLegacyHomeHistoryReadLocallyActive()) {
    scheduleLegacyHomeDeviceInfoRetryAfterHistory(protocol, hasCachedSnapshot, reason, 'local-history-read-active');
    appendAwarenessDiagnosticLog('legacy-home-device-info-skip', {
      protocol,
      reason,
      skipReason: 'local-history-read-active',
      hasCachedSnapshot,
      historyReadKey: legacyHomeHistoryReadActiveKey,
      historyScopeKey: legacyHomeHistoryReadActiveScopeKey,
      inFlight: legacyHomeHistoryReadInFlight.value,
      hasPromise: Boolean(legacyHomeHistoryReadPromise),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return Promise.resolve();
  }

  if (legacyHomeDeviceInfoRefreshPromise) {
    appendAwarenessDiagnosticLog('legacy-home-device-info-skip', {
      protocol,
      reason,
      skipReason: 'refresh-already-running',
      hasCachedSnapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return legacyHomeDeviceInfoRefreshPromise;
  }

  legacyHomeDeviceInfoRefreshPromise = (async () => {
    const startedAt = Date.now();
    if (!isAwarenessRwRing() && isLegacyHomeHistoryReadLocallyActive()) {
      scheduleLegacyHomeDeviceInfoRetryAfterHistory(protocol, hasCachedSnapshot, reason, 'local-history-read-active-before-refresh');
      appendAwarenessDiagnosticLog('legacy-home-device-info-skip', {
        protocol,
        reason,
        skipReason: 'local-history-read-active-before-refresh',
        hasCachedSnapshot,
        historyReadKey: legacyHomeHistoryReadActiveKey,
        historyScopeKey: legacyHomeHistoryReadActiveScopeKey,
        inFlight: legacyHomeHistoryReadInFlight.value,
        hasPromise: Boolean(legacyHomeHistoryReadPromise),
        snapshot: getAwarenessConnectionSnapshot()
      });
      return;
    }
    const historyExclusive = getLegacyBleHistoryExclusiveSnapshot(getAwarenessCanonicalDeviceMac());
    if (historyExclusive.active) {
      scheduleLegacyHomeDeviceInfoRetryAfterHistory(protocol, hasCachedSnapshot, reason, 'history-exclusive');
      appendAwarenessDiagnosticLog('legacy-home-device-info-skip', {
        protocol,
        reason,
        skipReason: 'history-exclusive',
        exclusive: historyExclusive,
        hasCachedSnapshot,
        snapshot: getAwarenessConnectionSnapshot()
      });
      return;
    }
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
  return legacyHomeDeviceInfoRefreshPromise;
};
const flushLegacyHomeDeviceInfoPendingRetry = (trigger: string) => {
  const pending = legacyHomeDeviceInfoRefreshPendingRetry;
  if (!pending) return;
  if (!isAwarenessRwRing() && isLegacyHomeHistoryReadLocallyActive()) {
    scheduleLegacyHomeDeviceInfoRetryFlush(`${trigger}:history-active`, 1200);
    return;
  }
  if (legacyHomeDeviceInfoRetryDeferredTimer) {
    clearTimeout(legacyHomeDeviceInfoRetryDeferredTimer);
    legacyHomeDeviceInfoRetryDeferredTimer = null;
  }
  legacyHomeDeviceInfoRefreshPendingRetry = null;
  appendAwarenessDiagnosticLog('legacy-home-device-info-retry-dispatch', {
    trigger,
    protocol: pending.protocol,
    reason: pending.reason,
    skipReason: pending.skipReason,
    hasCachedSnapshot: pending.hasCachedSnapshot,
    freshBatteryBarrierId: pending.freshBatteryBarrierId || 0,
    batteryOnly: pending.batteryOnly === true,
    snapshot: getAwarenessConnectionSnapshot()
  });
  setTimeout(() => {
    const refreshReason = `${pending.reason}:retry-after-${trigger}`;
    const refreshTask = pending.batteryOnly
      ? (async () => {
          const startedAt = Date.now();
          if (!validateAwarenessHomeSyncContext('legacy-home-fresh-battery-before-read', {
            requireReady: true,
            allowMissingCurrent: false
          })) {
            appendAwarenessDiagnosticLog('legacy-home-fresh-battery-skip', {
              protocol: pending.protocol,
              reason: refreshReason,
              skipReason: 'sync-context-or-communication-not-ready',
              snapshot: getAwarenessConnectionSnapshot()
            });
            return;
          }
          appendAwarenessDiagnosticLog('legacy-home-fresh-battery-start', {
            protocol: pending.protocol,
            reason: refreshReason,
            batteryBefore: displayBatteryValue.value,
            snapshot: getAwarenessConnectionSnapshot()
          });
          const result = await readBattery();
          lastAwarenessRefreshAt = Date.now();
          appendAwarenessDiagnosticLog('legacy-home-fresh-battery-result', {
            protocol: pending.protocol,
            reason: refreshReason,
            elapsedMs: Date.now() - startedAt,
            battery: displayBatteryValue.value,
            result,
            snapshot: getAwarenessConnectionSnapshot()
          });
        })().catch((error) => {
          appendAwarenessDiagnosticLog('legacy-home-fresh-battery-failed', {
            protocol: pending.protocol,
            reason: refreshReason,
            error: formatBleErrorMessage(error, 'legacy fresh battery read failed'),
            rawError: getAwarenessRawError(error),
            snapshot: getAwarenessConnectionSnapshot()
          });
        })
      : refreshLegacyHomeDeviceInfoInBackground(
          pending.protocol,
          pending.hasCachedSnapshot,
          refreshReason
        );
    if (pending.freshBatteryBarrierId) {
      void refreshTask.finally(async () => {
        await nextTick();
        finishLegacyHomeFreshBatteryBarrier(
          pending.freshBatteryBarrierId || 0,
          `device-info-settled:${trigger}`
        );
      });
    }
  }, 80);
};
const pruneLegacyHomeHistoryLongRetryAttempts = () => {
  const now = Date.now();
  legacyHomeHistoryLongRetryAttemptAt.forEach((value, key) => {
    if (!value || now - value > LEGACY_HOME_HISTORY_LONG_RETRY_DEDUP_MS) {
      legacyHomeHistoryLongRetryAttemptAt.delete(key);
    }
  });
};
const scheduleLegacyHomeHistoryLongRetry = (
  trigger: string,
  protocol: string,
  context: {
    reason: string;
    historyReadKey: string;
    historyScopeKey: string;
    deviceMac: string;
    sinceTimestamp: number;
    allowForegroundUploadWork?: boolean;
    allowWithUploadableSnapshot?: boolean;
    allowAfterTimeoutFlush?: boolean;
  }
) => {
  pruneLegacyHomeHistoryLongRetryAttempts();
  const retryKey = `${context.historyReadKey}:long-retry`;
  const now = Date.now();
  const normalizedRetryDeviceMac = normalizeHistoryCheckpointDeviceMac(context.deviceMac);
  const stableSnapshot = getLegacyLocalDataStableSnapshot();
  const hasSameDeviceUploadableSnapshot =
    Boolean(normalizedRetryDeviceMac) &&
    stableSnapshot.deviceMacNorm === normalizedRetryDeviceMac &&
    hasLegacyLocalDataUploadableSnapshot(stableSnapshot);
  const hasRecentTimeoutFlushForDevice =
    Boolean(normalizedRetryDeviceMac) &&
    legacyLocalDataTimeoutFlushDeviceMacNorm === normalizedRetryDeviceMac &&
    legacyLocalDataTimeoutFlushRequestedAt > 0 &&
    now - legacyLocalDataTimeoutFlushRequestedAt <= LEGACY_HOME_LONG_RETRY_SUPPRESS_AFTER_FLUSH_MS;
  const hasForegroundUploadWork =
    Boolean(legacyLocalDataUploadPromise || legacyLocalDataStablePromise || legacyLocalDataStableUploadScheduled);
  const partialSnapshotAlreadyHandled =
    hasSameDeviceUploadableSnapshot &&
    stableSnapshot.completed !== true &&
    stableSnapshot.submitCount <= 0 &&
    (stableSnapshot.alreadyUploadedCount > 0 ||
      stableSnapshot.builtSubmitCount > 0 ||
      stableSnapshot.recordCount > 0);
  const shouldSkipForForegroundUploadWork = hasForegroundUploadWork && context.allowForegroundUploadWork !== true;
  const shouldSkipForUploadableSnapshot =
    hasSameDeviceUploadableSnapshot &&
    !partialSnapshotAlreadyHandled &&
    context.allowWithUploadableSnapshot !== true;
  const shouldSkipForRecentTimeoutFlush =
    hasRecentTimeoutFlushForDevice && context.allowAfterTimeoutFlush !== true;
  if (shouldSkipForForegroundUploadWork || shouldSkipForUploadableSnapshot || shouldSkipForRecentTimeoutFlush) {
    appendAwarenessDiagnosticLog('legacy-home-history-long-retry-skip', {
      protocol,
      reason: context.reason,
      trigger,
      skipReason: shouldSkipForForegroundUploadWork
        ? 'foreground-upload-running'
        : shouldSkipForUploadableSnapshot
          ? 'uploadable-snapshot-ready'
          : 'recent-timeout-flush',
      deviceMac: context.deviceMac,
      normalizedDeviceMac: normalizedRetryDeviceMac,
      historyReadKey: context.historyReadKey,
      historyScopeKey: context.historyScopeKey,
      sinceTimestamp: context.sinceTimestamp,
      sinceText: formatUnixTimestampForLog(context.sinceTimestamp),
      hasForegroundUploadWork,
      hasSameDeviceUploadableSnapshot,
      hasRecentTimeoutFlushForDevice,
      allowForegroundUploadWork: context.allowForegroundUploadWork === true,
      allowWithUploadableSnapshot: context.allowWithUploadableSnapshot === true,
      allowAfterTimeoutFlush: context.allowAfterTimeoutFlush === true,
      timeoutFlushElapsedMs:
        legacyLocalDataTimeoutFlushRequestedAt > 0 ? now - legacyLocalDataTimeoutFlushRequestedAt : 0,
      suppressMs: LEGACY_HOME_LONG_RETRY_SUPPRESS_AFTER_FLUSH_MS,
      stableSnapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }
  const previousAttemptAt = legacyHomeHistoryLongRetryAttemptAt.get(retryKey) || 0;
  if (previousAttemptAt > 0 && now - previousAttemptAt < LEGACY_HOME_HISTORY_LONG_RETRY_DEDUP_MS) {
    appendAwarenessDiagnosticLog('legacy-home-history-long-retry-skip', {
      protocol,
      reason: context.reason,
      trigger,
      skipReason: 'recent-long-retry-attempt',
      deviceMac: context.deviceMac,
      historyReadKey: context.historyReadKey,
      historyScopeKey: context.historyScopeKey,
      sinceTimestamp: context.sinceTimestamp,
      sinceText: formatUnixTimestampForLog(context.sinceTimestamp),
      elapsedSinceAttemptMs: now - previousAttemptAt,
      dedupMs: LEGACY_HOME_HISTORY_LONG_RETRY_DEDUP_MS,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }
  legacyHomeHistoryLongRetryAttemptAt.set(retryKey, now);
  appendAwarenessDiagnosticLog('legacy-home-history-long-retry-scheduled', {
    protocol,
    reason: context.reason,
    trigger,
    deviceMac: context.deviceMac,
    historyReadKey: context.historyReadKey,
    historyScopeKey: context.historyScopeKey,
    sinceTimestamp: context.sinceTimestamp,
    sinceText: formatUnixTimestampForLog(context.sinceTimestamp),
    delayMs: LEGACY_HOME_HISTORY_LONG_RETRY_DELAY_MS,
    timeoutMs: LEGACY_HOME_HISTORY_LONG_RETRY_TIMEOUT_MS,
    snapshot: getAwarenessConnectionSnapshot()
  });
  setTimeout(() => {
    const historyExclusive = getLegacyBleHistoryExclusiveSnapshot(getAwarenessCanonicalDeviceMac());
    const hasRunningHistoryRead = Boolean(legacyHomeHistoryReadPromise || legacyHomeHistoryReadInFlight.value);
    if (hasRunningHistoryRead || historyExclusive.active) {
      appendAwarenessDiagnosticLog('legacy-home-history-long-retry-skip', {
        protocol,
        reason: context.reason,
        trigger,
        skipReason: hasRunningHistoryRead ? 'read-already-running' : 'history-exclusive-active',
        deviceMac: context.deviceMac,
        historyReadKey: context.historyReadKey,
        historyScopeKey: context.historyScopeKey,
        sinceTimestamp: context.sinceTimestamp,
        sinceText: formatUnixTimestampForLog(context.sinceTimestamp),
        hasRunningHistoryRead,
        historyExclusive,
        snapshot: getAwarenessConnectionSnapshot()
      });
      return;
    }
    startLegacyHomeHistoryReadInBackground(`${context.reason}:long-retry`, protocol, {
      force: true,
      longRetry: true
    });
  }, LEGACY_HOME_HISTORY_LONG_RETRY_DELAY_MS);
};
const scheduleLegacyHomeHistoryLongRetryAfterPartialUpload = (
  trigger: string,
  protocol: string,
  context: {
    reason: string;
    deviceMac: string;
    fallbackSinceTimestamp?: number;
  }
) => {
  const retryDeviceMac = context.deviceMac || getAwarenessCheckpointDeviceMac() || getAwarenessUploadDeviceMac();
  const normalizedRetryDeviceMac = normalizeHistoryCheckpointDeviceMac(retryDeviceMac);
  const retrySinceTimestamp = context.fallbackSinceTimestamp || getAwarenessHistoryReadSinceTimestamp(false) || 0;
  const retryDate = formatLocalDate(new Date());
  if (!normalizedRetryDeviceMac) {
    appendAwarenessDiagnosticLog('legacy-home-history-long-retry-skip', {
      protocol,
      reason: context.reason,
      trigger,
      skipReason: 'missing-device-mac-after-partial-upload',
      fallbackSinceTimestamp: context.fallbackSinceTimestamp,
      fallbackSinceText: formatUnixTimestampForLog(context.fallbackSinceTimestamp || 0),
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }
  const activeHistoryExclusiveSnapshot = getLegacyBleHistoryExclusiveSnapshot(getAwarenessCanonicalDeviceMac());
  const activeHistoryReadStillRunning = Boolean(
    legacyHomeHistoryReadInFlight.value || legacyHomeHistoryReadPromise || activeHistoryExclusiveSnapshot.active
  );
  if (activeHistoryReadStillRunning) {
    appendAwarenessDiagnosticLog('legacy-home-history-long-retry-skip', {
      protocol,
      reason: context.reason,
      trigger,
      skipReason: 'active-history-read-owns-continuation',
      deviceMac: normalizedRetryDeviceMac,
      retryDate,
      retrySinceTimestamp,
      retrySinceText: formatUnixTimestampForLog(retrySinceTimestamp),
      historyReadInFlight: legacyHomeHistoryReadInFlight.value,
      hasHistoryReadPromise: Boolean(legacyHomeHistoryReadPromise),
      historyExclusive: activeHistoryExclusiveSnapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }
  const partialContinueScopeKey = getLegacyHomeHistoryReadScopeKey(normalizedRetryDeviceMac, retryDate);
  const partialContinueCount = legacyHomeHistoryPartialContinueAttempts.get(partialContinueScopeKey) || 0;
  if (partialContinueCount >= LEGACY_HOME_HISTORY_PARTIAL_CONTINUE_MAX_ROUNDS) {
    appendAwarenessDiagnosticLog('legacy-home-history-long-retry-skip', {
      protocol,
      reason: context.reason,
      trigger,
      skipReason: 'partial-continuation-max-rounds',
      deviceMac: normalizedRetryDeviceMac,
      retryDate,
      partialContinueCount,
      maxRounds: LEGACY_HOME_HISTORY_PARTIAL_CONTINUE_MAX_ROUNDS,
      retrySinceTimestamp,
      retrySinceText: formatUnixTimestampForLog(retrySinceTimestamp),
      snapshot: getAwarenessConnectionSnapshot()
    });
    userStore.updateUploadingStatus('2');
    userStore.updateIsSending(false);
    homeDataSyncing.value = false;
    return false;
  }
  legacyHomeHistoryPartialContinueAttempts.set(partialContinueScopeKey, partialContinueCount + 1);
  appendAwarenessDiagnosticLog('legacy-home-history-partial-continuation-scheduled', {
    protocol,
    reason: context.reason,
    trigger,
    deviceMac: normalizedRetryDeviceMac,
    retryDate,
    partialContinueCount: partialContinueCount + 1,
    maxRounds: LEGACY_HOME_HISTORY_PARTIAL_CONTINUE_MAX_ROUNDS,
    retrySinceTimestamp,
    retrySinceText: formatUnixTimestampForLog(retrySinceTimestamp),
    snapshot: getAwarenessConnectionSnapshot()
  });
  scheduleLegacyHomeHistoryLongRetry(trigger, protocol, {
    reason: context.reason,
    historyReadKey: getLegacyHomeHistoryReadKey(normalizedRetryDeviceMac, retryDate, retrySinceTimestamp),
    historyScopeKey: getLegacyHomeHistoryReadScopeKey(normalizedRetryDeviceMac, retryDate),
    deviceMac: normalizedRetryDeviceMac,
    sinceTimestamp: retrySinceTimestamp,
    allowWithUploadableSnapshot: true
  });
  return true;
};
const startLegacyHomeHistoryReadInBackground = (
  reason: string,
  protocol: string,
  options: { force?: boolean; longRetry?: boolean } = {}
) => {
  const historyDate = formatLocalDate(new Date());
  const historyDeviceMac = getAwarenessCheckpointDeviceMac() || getAwarenessUploadDeviceMac();
  const normalizedHistoryDeviceMac = normalizeHistoryCheckpointDeviceMac(historyDeviceMac);
  const now = Date.now();
  const bypassRecentReadGate = shouldBypassLegacyHomeHistoryRecentReadGate(reason, options);
  const historyCheckpointMeta = getDeviceHistoryCheckpointMeta(historyDeviceMac, protocol);
  const historyReadCursor = Number(historyCheckpointMeta?.readTimestamp || 0);
  const historyPlannerCheckpoint = historyCheckpointMeta
    ? {
        ...historyCheckpointMeta,
        // BLE continuation follows only a confirmed complete 0x36 read. A
        // durable/ACK cursor owns upload dedupe, but must not hide the unread
        // tail of a partial device history session.
        timestamp: historyReadCursor
      }
    : historyCheckpointMeta;
  const historySyncDecision = decideDeviceSync({
    trigger: reason,
    checkpoint: historyPlannerCheckpoint,
    nowMs: now,
    force: bypassRecentReadGate,
    includeSleep: true,
    normalOverlapSeconds: LEGACY_HISTORY_READ_CHECKPOINT_OVERLAP_SECONDS,
    sleepOverlapSeconds: LEGACY_HISTORY_READ_CHECKPOINT_OVERLAP_SECONDS
  });
  const historySinceTimestamp = historySyncDecision.readSinceTimestamp || getAwarenessHistoryReadSinceTimestamp(false);
  const historyLastDataCheckpointTimestamp = historySyncDecision.checkpointTimestamp || getAwarenessLastReadTimestamp();
  const historyEmptyReadCheckpointTimestamp = historySyncDecision.emptyReadTimestamp || getAwarenessLastEmptyReadTimestamp();
  const historyReadKey = getLegacyHomeHistoryReadKey(historyDeviceMac, historyDate, historySinceTimestamp);
  const historyScopeKey = getLegacyHomeHistoryReadScopeKey(historyDeviceMac, historyDate);

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
    userStore.updateUploadingStatus('2');
    userStore.updateIsSending(false);
    homeDataSyncing.value = false;
    releaseAwarenessHomeSyncSession('legacy-home-history-read-missing-device-mac-skip', 'failed', false);
    return;
  }

  if (historySyncDecision.action === 'skip') {
    appendAwarenessDiagnosticLog('legacy-home-history-read-skip', {
      protocol,
      reason,
      skipReason: `device-sync-planner:${historySyncDecision.reason}`,
      historyDate,
      deviceMac: normalizedHistoryDeviceMac,
      historyReadKey,
      historyScopeKey,
      historySinceTimestamp,
      historySinceText: formatUnixTimestampForLog(historySinceTimestamp),
      checkpointTimestamp: historySyncDecision.checkpointTimestamp,
      checkpointText: formatUnixTimestampForLog(historySyncDecision.checkpointTimestamp),
      emptyReadTimestamp: historySyncDecision.emptyReadTimestamp,
      emptyReadText: formatUnixTimestampForLog(historySyncDecision.emptyReadTimestamp),
      lastSyncSuccessAt: historySyncDecision.lastSyncSuccessAt,
      emptyReadUpdatedAt: historySyncDecision.emptyReadUpdatedAt,
      elapsedSinceSuccessMs: Number.isFinite(historySyncDecision.elapsedSinceSuccessMs)
        ? historySyncDecision.elapsedSinceSuccessMs
        : undefined,
      elapsedSinceEmptyReadMs: Number.isFinite(historySyncDecision.elapsedSinceEmptyReadMs)
        ? historySyncDecision.elapsedSinceEmptyReadMs
        : undefined,
      autoLike: historySyncDecision.autoLike,
      overlapSeconds: historySyncDecision.overlapSeconds,
      snapshot: getAwarenessConnectionSnapshot()
    });
    userStore.updateUploadingStatus('2');
    userStore.updateIsSending(false);
    homeDataSyncing.value = false;
    finishAwarenessHomeSyncWithoutHistoryCooldown(
      `legacy-home-history-read-planner-skip:${historySyncDecision.reason}`
    );
    scheduleAwarenessAfterDataProcessed(`legacy-home-history-read-planner-skip:${historySyncDecision.reason}`);
    return;
  }

  if (!validateAwarenessHomeSyncContext('legacy-home-history-read-precheck', {
    expectedMac: normalizedHistoryDeviceMac,
    requireReady: true,
    allowMissingCurrent: false
  })) {
    userStore.updateUploadingStatus('2');
    userStore.updateIsSending(false);
    homeDataSyncing.value = false;
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

  if (isLegacyLocalDataUploadWorkActive()) {
    const activeUploadSnapshot = getLegacyLocalDataStableSnapshot();
    const activeUploadDeviceMac = normalizeHistoryCheckpointDeviceMac(activeUploadSnapshot.deviceMacNorm);
    const uploadBelongsToAnotherDevice = Boolean(
      activeUploadDeviceMac && activeUploadDeviceMac !== normalizedHistoryDeviceMac
    );
    // A listener/stable-wait can be created by an empty local-data callback
    // before the real BLE history read starts. It is not upload work: there is
    // no HTTP request and no record/raw frame to preserve. Treating that empty
    // placeholder as an active pipeline prevented both the current device and
    // the next bound device from ever issuing 0x36.
    const staleEmptyUploadWatcher = Boolean(
      !legacyLocalDataUploadPromise && !hasLegacyLocalDataUploadableSnapshot(activeUploadSnapshot)
    );

    if (staleEmptyUploadWatcher) {
      const staleUploadState = {
        handoffPending: legacyHomeHistoryUploadHandoffPending,
        hasUploadPromise: Boolean(legacyLocalDataUploadPromise),
        hasStablePromise: Boolean(legacyLocalDataStablePromise),
        stableUploadScheduled: legacyLocalDataStableUploadScheduled,
        watcherActive: legacyLocalDataUploadWatcherActive,
        watcherPending: legacyLocalDataUploadWatcherPending
      };
      legacyHomeHistoryUploadHandoffPending = false;
      resetLegacyLocalDataUploadWatcherState(
        uploadBelongsToAnotherDevice ? 'cross-device-empty-upload-state' : 'same-device-empty-upload-state',
        protocol,
        {
        requestedDeviceMac: normalizedHistoryDeviceMac,
        staleDeviceMac: activeUploadDeviceMac,
        uploadBelongsToAnotherDevice,
        staleUploadState,
        stableSnapshot: activeUploadSnapshot
        }
      );
      appendAwarenessDiagnosticLog('legacy-home-history-empty-upload-state-recovered', {
        protocol,
        reason,
        requestedDeviceMac: normalizedHistoryDeviceMac,
        staleDeviceMac: activeUploadDeviceMac,
        uploadBelongsToAnotherDevice,
        historyReadKey,
        historyScopeKey,
        staleUploadState,
        stableSnapshot: activeUploadSnapshot,
        snapshot: getAwarenessConnectionSnapshot()
      });
      if (uploadBelongsToAnotherDevice) {
        appendAwarenessDiagnosticLog('legacy-home-history-cross-device-upload-state-recovered', {
          protocol,
          reason,
          requestedDeviceMac: normalizedHistoryDeviceMac,
          staleDeviceMac: activeUploadDeviceMac,
          historyReadKey,
          historyScopeKey,
          staleUploadState,
          stableSnapshot: activeUploadSnapshot,
          snapshot: getAwarenessConnectionSnapshot()
        });
      }
    }
  }

  if (isLegacyLocalDataUploadWorkActive()) {
    const activeUploadSnapshot = getLegacyLocalDataStableSnapshot();
    appendAwarenessDiagnosticLog('legacy-home-history-read-skip', {
      protocol,
      reason,
      skipReason: legacyHomeHistoryUploadHandoffPending
        ? 'history-upload-handoff-pending'
        : 'history-upload-pipeline-active',
      historyReadKey,
      historyScopeKey,
      deviceMac: normalizedHistoryDeviceMac,
      historySinceTimestamp,
      historySinceText: formatUnixTimestampForLog(historySinceTimestamp),
      activeUploadSnapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    // Upload/handoff is background work. A coalesced foreground trigger must
    // not leave the page displaying an endless "syncing" state when no new BLE
    // read was started by this call.
    userStore.updateUploadingStatus('2');
    userStore.updateIsSending(false);
    homeDataSyncing.value = false;
    homeSyncRunningInBackground.value = true;
    finishAwarenessHomeSyncWithoutHistoryCooldown('legacy-home-history-read-upload-active-skip');
    scheduleAwarenessVisibleSyncReconcile('legacy-home-history-read-upload-active-skip');
    return;
  }

  const historyExclusive = getLegacyBleHistoryExclusiveSnapshot(getAwarenessCanonicalDeviceMac());
  if (historyExclusive.active) {
    appendAwarenessDiagnosticLog('legacy-home-history-read-skip', {
      protocol,
      reason,
      skipReason: 'history-exclusive-active',
      historyReadKey,
      historyScopeKey,
      activeReadKey: legacyHomeHistoryReadActiveKey,
      activeScopeKey: legacyHomeHistoryReadActiveScopeKey,
      historyExclusive,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return;
  }

  const completedAt = legacyHomeHistoryReadCompletedAt.get(historyScopeKey) || 0;
  if (!bypassRecentReadGate && completedAt > 0 && now - completedAt < LEGACY_HOME_HISTORY_READ_SCOPE_DEDUP_MS) {
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
    userStore.updateUploadingStatus('2');
    userStore.updateIsSending(false);
    homeDataSyncing.value = false;
    finishAwarenessHomeSyncWithoutHistoryCooldown('legacy-home-history-read-recent-completed-skip');
    return;
  }

  const fetchedAt = Math.max(
    legacyHomeHistoryReadFetchedAt.get(historyReadKey) || 0,
    legacyHomeHistoryReadFetchedAt.get(historyScopeKey) || 0
  );
  if (!bypassRecentReadGate && fetchedAt > 0 && now - fetchedAt < LEGACY_HOME_HISTORY_READ_SCOPE_DEDUP_MS) {
    // A fetched frame set is not necessarily a complete 0x36 session. Active
    // read/upload guards above already prevent concurrency; once they release,
    // an incomplete fetch must not suppress the next device read.
    appendAwarenessDiagnosticLog('legacy-home-history-read-fetched-no-cooldown', {
      protocol,
      reason,
      reasonDetail: 'fetched-without-confirmed-terminal-does-not-block-next-0x36',
      historyReadKey,
      historyScopeKey,
      historyDate,
      deviceMac: normalizedHistoryDeviceMac,
      historySinceTimestamp,
      historySinceText: formatUnixTimestampForLog(historySinceTimestamp),
      elapsedSinceFetchedMs: now - fetchedAt,
      dedupMs: LEGACY_HOME_HISTORY_READ_SCOPE_DEDUP_MS,
      snapshot: getAwarenessConnectionSnapshot()
    });
    legacyHomeHistoryReadFetchedAt.delete(historyReadKey);
    legacyHomeHistoryReadFetchedAt.delete(historyScopeKey);
  }

  const failedAt = legacyHomeHistoryReadFailedAt.get(historyScopeKey) || legacyHomeHistoryReadFailedAt.get(historyReadKey) || 0;
  const failedReason =
    legacyHomeHistoryReadFailedReason.get(historyScopeKey) ||
    legacyHomeHistoryReadFailedReason.get(historyReadKey) ||
    '';
  const failedGeneration = Math.max(
    legacyHomeHistoryReadFailedGeneration.get(historyScopeKey) || 0,
    legacyHomeHistoryReadFailedGeneration.get(historyReadKey) || 0
  );
  const failureCooldownMs =
    failedReason === 'communication-not-ready'
      ? LEGACY_HOME_HISTORY_READ_COMMUNICATION_FAILURE_COOLDOWN_MS
      : LEGACY_HOME_HISTORY_READ_FAILURE_COOLDOWN_MS;
  const failedInCurrentPhysicalConnection =
    failedReason !== 'communication-not-ready' &&
    failedGeneration > 0 &&
    failedGeneration === awarenessPhysicalConnectionGeneration;
  const failureCooldownActive = failedAt > 0 && now - failedAt < failureCooldownMs;
  if (failedAt > 0 && (failedInCurrentPhysicalConnection || (!bypassRecentReadGate && failureCooldownActive))) {
    if (
      failedReason !== 'communication-not-ready' &&
      failedGeneration > 0 &&
      awarenessPhysicalConnectionGeneration > failedGeneration
    ) {
      clearLegacyHomeHistoryReadFailureKeys(historyReadKey, historyScopeKey);
      appendAwarenessDiagnosticLog('legacy-home-history-read-failure-cleared-by-new-connection', {
        protocol,
        reason,
        failedReason,
        failedGeneration,
        connectionGeneration: awarenessPhysicalConnectionGeneration,
        historyReadKey,
        historyScopeKey,
        deviceMac: normalizedHistoryDeviceMac,
        elapsedSinceFailedMs: now - failedAt,
        snapshot: getAwarenessConnectionSnapshot()
      });
    } else {
      appendAwarenessDiagnosticLog('legacy-home-history-read-skip', {
        protocol,
        reason,
        skipReason: 'recent-read-failed',
        failedReason,
        failedGeneration,
        connectionGeneration: awarenessPhysicalConnectionGeneration,
        historyReadKey,
        historyScopeKey,
        historyDate,
        deviceMac: normalizedHistoryDeviceMac,
        historySinceTimestamp,
        historySinceText: formatUnixTimestampForLog(historySinceTimestamp),
        elapsedSinceFailedMs: now - failedAt,
        cooldownMs: failedInCurrentPhysicalConnection ? null : failureCooldownMs,
        generationLatched: failedInCurrentPhysicalConnection,
        snapshot: getAwarenessConnectionSnapshot()
      });
      userStore.updateUploadingStatus('2');
      userStore.updateIsSending(false);
      homeDataSyncing.value = false;
      releaseAwarenessHomeSyncSession('legacy-home-history-read-recent-failed-skip', 'failed', false);
      return;
    }
  }

  const attemptedAt = Math.max(
    legacyHomeHistoryReadAttemptAt.get(historyReadKey) || 0,
    legacyHomeHistoryReadAttemptAt.get(historyScopeKey) || 0
  );
  if (!bypassRecentReadGate && attemptedAt > 0 && now - attemptedAt < LEGACY_HOME_HISTORY_READ_RETRY_DEDUP_MS) {
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
    userStore.updateUploadingStatus('2');
    userStore.updateIsSending(false);
    homeDataSyncing.value = false;
    releaseAwarenessHomeSyncSession('legacy-home-history-read-recent-attempt-skip', 'failed', false);
    return;
  }

  // Do not write the long-lived dedup marker when a read merely starts.
  // In-flight/exclusive guards already prevent concurrent reads. Persisting
  // an attempt here made disconnect/not-ready/empty failures look successful
  // and suppressed the next valid retry with recent-same-window-attempt.
  legacyLocalDataTerminalSkipMemo = null;
  legacyHomeHistoryReadActiveKey = historyReadKey;
  legacyHomeHistoryReadActiveScopeKey = historyScopeKey;
  legacyHomeHistoryReadHasUploadableRecords = false;
  const historyReadTimeoutMs = options.longRetry
    ? LEGACY_HOME_HISTORY_LONG_RETRY_TIMEOUT_MS
    : options.force
      ? LEGACY_HOME_HISTORY_SYNC_TIMEOUT_MS
      : LEGACY_HOME_HISTORY_BACKGROUND_TIMEOUT_MS;
  const historyReadWatchdogTimeoutMs =
    historyReadTimeoutMs + (options.force ? LEGACY_HOME_EMPTY_HISTORY_FALLBACK_TIMEOUT_MS : 0) + LEGACY_HOME_HISTORY_READ_WATCHDOG_EXTRA_MS;
  let historyReadWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  const clearHistoryReadWatchdog = () => {
    if (!historyReadWatchdogTimer) return;
    clearTimeout(historyReadWatchdogTimer);
    historyReadWatchdogTimer = null;
  };
  const isCurrentHistoryRead = () =>
    legacyHomeHistoryReadActiveKey === historyReadKey && legacyHomeHistoryReadActiveScopeKey === historyScopeKey;
  const resetCurrentHistoryReadState = () => {
    if (!isCurrentHistoryRead()) return false;
    legacyHomeHistoryReadInFlight.value = false;
    legacyHomeHistoryReadPromise = null;
    legacyHomeHistoryReadStartedAt = 0;
    legacyHomeHistoryReadActiveKey = '';
    legacyHomeHistoryReadActiveScopeKey = '';
    return true;
  };
  const markCurrentHistoryReadFailed = (
    trigger: string,
    startedAt = Date.now(),
    details: { skipLongRetry?: boolean; skipLongRetryReason?: string; status?: string; failureReason?: string } = {}
  ) => {
    const failedAt = Date.now();
    const failureReason = details.failureReason || trigger;
    const failedStableSnapshot = getLegacyLocalDataStableSnapshot();
    const hasUploadableFailedSnapshot = hasLegacyLocalDataUploadableSnapshot(failedStableSnapshot);
    // Partial reads may continue from their stable snapshot. A zero-frame BLE
    // failure is different: latch it to this physical connection so repeated
    // page-show/ready callbacks cannot create another 30-60s read loop.
    const failedGeneration =
      failureReason === 'communication-not-ready' || hasUploadableFailedSnapshot
        ? 0
        : awarenessPhysicalConnectionGeneration;
    legacyHomeHistoryReadFailedAt.set(historyReadKey, failedAt);
    legacyHomeHistoryReadFailedAt.set(historyScopeKey, failedAt);
    legacyHomeHistoryReadFailedReason.set(historyReadKey, failureReason);
    legacyHomeHistoryReadFailedReason.set(historyScopeKey, failureReason);
    legacyHomeHistoryReadFailedGeneration.set(historyReadKey, failedGeneration);
    legacyHomeHistoryReadFailedGeneration.set(historyScopeKey, failedGeneration);
    // attemptAt is a success-window dedup gate. Keeping it after a failed read
    // makes a recovered connection look "already attempted" for five minutes.
    // Failure retry cadence is controlled exclusively by failedAt/reason.
    legacyHomeHistoryReadAttemptAt.delete(historyReadKey);
    legacyHomeHistoryReadAttemptAt.delete(historyScopeKey);
    appendAwarenessDiagnosticLog(trigger, {
      protocol,
      reason,
      longRetry: Boolean(options.longRetry),
      deviceMac: normalizedHistoryDeviceMac,
      historyReadKey,
      historyScopeKey,
      timeoutMs: historyReadTimeoutMs,
      watchdogTimeoutMs: historyReadWatchdogTimeoutMs,
      elapsedMs: Date.now() - startedAt,
      receivedCount: Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0,
      receivedTail: summarizeAwarenessReceivedDataTailForLog(),
      localDataLength: Array.isArray(userStore.localData) ? userStore.localData.length : 0,
      status: details.status,
      failureReason,
      failedGeneration,
      connectionGeneration: awarenessPhysicalConnectionGeneration,
      skipLongRetry: Boolean(details.skipLongRetry),
      skipLongRetryReason: details.skipLongRetryReason,
      snapshot: getAwarenessConnectionSnapshot()
    });
    if (hasUploadableFailedSnapshot) {
      appendAwarenessDiagnosticLog('legacy-home-history-read-failed-background-flush', {
        protocol,
        trigger,
        reason: 'history-read-failed-but-has-uploadable-data',
        stableSnapshot: failedStableSnapshot,
        snapshot: getAwarenessConnectionSnapshot()
      });
      requestLegacyLocalDataTimeoutFlush(`${trigger}:background-uploadable`, protocol, failedStableSnapshot);
      userStore.updateUploadingStatus('1');
      userStore.updateIsSending(true);
      if (!options.longRetry && !details.skipLongRetry) {
        scheduleLegacyHomeHistoryLongRetry(trigger, protocol, {
          reason,
          historyReadKey,
          historyScopeKey,
          deviceMac: normalizedHistoryDeviceMac,
          sinceTimestamp: historySinceTimestamp
        });
      }
      return;
    }
    appendAwarenessDiagnosticLog('legacy-home-history-read-failed-flush-skip', {
      protocol,
      trigger,
      reason: 'history-read-failed-or-timeout',
      stableSnapshot: failedStableSnapshot,
      snapshot: getAwarenessConnectionSnapshot()
    });
    userStore.updateUploadingStatus('2');
    userStore.updateIsSending(false);
    homeDataSyncing.value = false;
    releaseAwarenessHomeSyncSession(`${trigger}:ui-released`, 'failed', false);
    appendAwarenessDiagnosticLog('legacy-home-history-read-retry-suppressed', {
      protocol,
      trigger,
      reason: 'no-uploadable-frame-in-current-physical-connection',
      deviceMac: normalizedHistoryDeviceMac,
      failedGeneration,
      connectionGeneration: awarenessPhysicalConnectionGeneration,
      snapshot: getAwarenessConnectionSnapshot()
    });
  };
  const startHistoryReadWatchdog = () => {
    if (historyReadWatchdogTimer) return;
    historyReadWatchdogTimer = setTimeout(() => {
      if (!isCurrentHistoryRead()) {
        const timeoutFlushSnapshot = getLegacyLocalDataStableSnapshot();
        appendAwarenessDiagnosticLog('legacy-home-history-read-watchdog-stale', {
          protocol,
          reason,
          deviceMac: normalizedHistoryDeviceMac,
          historyReadKey,
          historyScopeKey,
          timeoutMs: historyReadTimeoutMs,
          watchdogTimeoutMs: historyReadWatchdogTimeoutMs,
          stableSnapshot: timeoutFlushSnapshot,
          snapshot: getAwarenessConnectionSnapshot()
        });
        return;
      }
      // This watchdog is deliberately observational. The protocol waiter owns
      // the read terminal state and uses packet activity to extend its quiet
      // timeout. Cancelling here used to clear the shared BLE listener while
      // the ring was still streaming, which split one history session into a
      // failed read followed by late, unowned packets.
      appendAwarenessDiagnosticLog('legacy-home-history-read-watchdog-observe-active', {
        protocol,
        reason,
        deviceMac: normalizedHistoryDeviceMac,
        historyReadKey,
        historyScopeKey,
        watchdogTimeoutMs: historyReadWatchdogTimeoutMs,
        elapsedMs: Date.now() - (legacyHomeHistoryReadStartedAt || Date.now()),
        stableSnapshot: getLegacyLocalDataStableSnapshot(),
        snapshot: getAwarenessConnectionSnapshot()
      });
      historyReadWatchdogTimer = null;
      startHistoryReadWatchdog();
      return;
    }, historyReadWatchdogTimeoutMs);
  };
  legacyHomeHistoryReadPromise = (async () => {
    await waitForAwarenessMs(50);
    if (!validateAwarenessHomeSyncContext('legacy-home-history-read-before-start', {
      expectedMac: normalizedHistoryDeviceMac,
      requireReady: true,
      allowMissingCurrent: false
    })) {
      clearHistoryReadWatchdog();
      legacyHomeHistoryReadAttemptAt.delete(historyReadKey);
      legacyHomeHistoryReadAttemptAt.delete(historyScopeKey);
      resetCurrentHistoryReadState();
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
      let legacyHistoryReadSucceeded = false;
      let legacyHistoryReadRecordCount = 0;
      let legacyHistoryReadStatus = '';
      let legacyHistoryReadCommunicationFailed = false;
      let legacyHistoryParsedComplete = true;
      let legacyHistoryReadMaxTimestamp = 0;
      let historyReadRecordsForUpload: any[] = [];
      let shouldSignalLegacyHistoryTerminalUpload = false;
      let legacyHistoryIncrementalNoNewDataTerminal = false;
      let legacyHistoryL19ShortResultRecoveryAttempted = false;
      let legacyHistoryL19ShortResultUnresolved = false;
      const isL19IncrementalHistoryRead = isAwarenessL19HistoryDevice() && historySinceTimestamp > 0;
      const updateLegacyHistoryReadMaxTimestamp = (summary: ReturnType<typeof summarizeLegacyUploadRecordsForLog>) => {
        const maxTimestamp = Math.max(
          Number(summary?.startTimeRange?.maxTimestamp || 0),
          Number(summary?.syncTimeRange?.maxTimestamp || 0)
        );
        if (Number.isFinite(maxTimestamp) && maxTimestamp > legacyHistoryReadMaxTimestamp) {
          legacyHistoryReadMaxTimestamp = maxTimestamp;
        }
      };
      // L19 incremental reads must not build/merge the whole local cache before 0x36.
      // On affected phones this synchronous snapshot alone can block the JS thread for seconds.
      const historyReadInitialStableSnapshot = isL19IncrementalHistoryRead
        ? null
        : getLegacyLocalDataStableSnapshot();
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
        lastDataCheckpointTimestamp: historyLastDataCheckpointTimestamp,
        lastDataCheckpointText: formatUnixTimestampForLog(historyLastDataCheckpointTimestamp),
        emptyReadCheckpointTimestamp: historyEmptyReadCheckpointTimestamp,
        emptyReadCheckpointText: formatUnixTimestampForLog(historyEmptyReadCheckpointTimestamp),
        syncDecisionReason: historySyncDecision.reason,
        syncDecisionAutoLike: historySyncDecision.autoLike,
        syncDecisionOverlapSeconds: historySyncDecision.overlapSeconds,
        syncDecisionElapsedSinceSuccessMs: Number.isFinite(historySyncDecision.elapsedSinceSuccessMs)
          ? historySyncDecision.elapsedSinceSuccessMs
          : undefined,
        syncDecisionElapsedSinceEmptyReadMs: Number.isFinite(historySyncDecision.elapsedSinceEmptyReadMs)
          ? historySyncDecision.elapsedSinceEmptyReadMs
          : undefined,
        timeoutMs: historyReadTimeoutMs,
        snapshot: getAwarenessConnectionSnapshot()
      });
      if (!hasAwarenessRuntimeCommunicationReady()) {
        appendAwarenessDiagnosticLog('legacy-home-history-runtime-restore-start', {
          protocol,
          reason,
          deviceMac: normalizedHistoryDeviceMac,
          snapshot: getAwarenessConnectionSnapshot()
        });
        const runtimeReady = Boolean(await ensureCommunicationReady().catch((error) => {
          appendAwarenessDiagnosticLog('legacy-home-history-runtime-restore-failed', {
            protocol,
            reason,
            deviceMac: normalizedHistoryDeviceMac,
            message: error instanceof Error ? error.message : String(error),
            snapshot: getAwarenessConnectionSnapshot()
          });
          return false;
        }));
        if (!runtimeReady) {
          appendAwarenessDiagnosticLog('legacy-home-history-read-deferred-runtime-not-ready', {
            protocol,
            reason,
            deviceMac: normalizedHistoryDeviceMac,
            snapshot: getAwarenessConnectionSnapshot()
          });
          throw new Error('Ring BLE command channel is not ready.');
        }
      }

      await syncRwHomeDeviceTimeBeforeHistory('legacy-home-history-read', {
        allowLegacy: true,
        forceIfStaleMs: RW_AWARENESS_DEVICE_TIME_SYNC_HISTORY_STALE_MS
      });
      if (!hasAwarenessRuntimeCommunicationReady()) {
        // The page-local device ref can lag behind the shared BLE runtime after
        // a reconnect. Re-check the actual command channel instead of treating
        // the stale notifyEnabled flag as authoritative.
        const commandChannelReady = Boolean(await ensureCommunicationReady().catch(() => false));
        if (commandChannelReady) {
          appendAwarenessDiagnosticLog('legacy-home-history-command-channel-revalidated', {
            protocol,
            reason,
            deviceMac: normalizedHistoryDeviceMac,
            snapshot: getAwarenessConnectionSnapshot()
          });
        } else {
        appendAwarenessDiagnosticLog('legacy-home-history-read-deferred-command-channel-lost', {
          protocol,
          reason,
          deviceMac: normalizedHistoryDeviceMac,
          snapshot: getAwarenessConnectionSnapshot()
        });
        throw new Error('Ring BLE command channel was lost before history read.');
        }
      }
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
        lastDataCheckpointTimestamp: historyLastDataCheckpointTimestamp,
        lastDataCheckpointText: formatUnixTimestampForLog(historyLastDataCheckpointTimestamp),
        emptyReadCheckpointTimestamp: historyEmptyReadCheckpointTimestamp,
        emptyReadCheckpointText: formatUnixTimestampForLog(historyEmptyReadCheckpointTimestamp),
        timeoutMs: historyReadTimeoutMs,
        snapshot: getAwarenessConnectionSnapshot()
      });
      startHistoryReadWatchdog();

      let records: any[] = [];
      let primaryHistoryReadError: unknown = null;
      try {
        const historyResult = await readLocalData(false, historySinceTimestamp, undefined, {
          timeoutMs: historyReadTimeoutMs,
          silentUploadStatus: true,
          skipUpload: true
        });
        records = Array.isArray((historyResult as any)?.records) ? (historyResult as any).records : [];
        historyReadRecordsForUpload = records;
        legacyHistoryReadStatus = `${(historyResult as any)?.status || ''}`;
        legacyHistoryParsedComplete =
          (historyResult as any)?.complete !== false && (historyResult as any)?.parsed?.complete !== false;
        legacyHistoryReadSucceeded = true;
        legacyHistoryReadRecordCount = records.length;
        legacyHomeHistoryReadHasUploadableRecords = legacyHistoryReadRecordCount > 0;
        const recordSummary = summarizeLegacyUploadRecordsForLog(records as Array<Record<string, any>>);
        updateLegacyHistoryReadMaxTimestamp(recordSummary);
        markLegacyHomeHistoryReadFetchedForWindow({
          historyReadKey,
          historyScopeKey,
          deviceMac: normalizedHistoryDeviceMac,
          date: historyDate,
          maxReachedTimestamp: legacyHistoryReadMaxTimestamp,
          recordCount: legacyHistoryReadRecordCount,
          reason: 'primary-read-result'
        });
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
          complete: (historyResult as any)?.complete,
          parsedComplete: (historyResult as any)?.parsed?.complete,
          uploaded: (historyResult as any)?.uploaded,
          recordCount: records.length,
          recordSummary,
          maxHistoryTimestamp: legacyHistoryReadMaxTimestamp,
          maxHistoryText: formatUnixTimestampForLog(legacyHistoryReadMaxTimestamp),
          receivedCount: Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0,
          receivedTail: summarizeAwarenessReceivedDataTailForLog(),
          localDataLength: Array.isArray(userStore.localData) ? userStore.localData.length : 0,
          sample: records.slice(0, 2),
          snapshot: getAwarenessConnectionSnapshot()
        });
      } catch (historyReadError) {
        primaryHistoryReadError = historyReadError;
        const primaryHistoryReadErrorMessage = formatBleErrorMessage(
          historyReadError,
          'legacy history read failed'
        );
        legacyHistoryReadCommunicationFailed =
          legacyHistoryReadCommunicationFailed ||
          /(?:communication|not\s+ready|disconnect|connection|listener|bluetooth|ble|\u84dd\u7259|\u65ad\u5f00)/i.test(
            primaryHistoryReadErrorMessage
          );
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
          error: primaryHistoryReadErrorMessage,
          communicationFailure: legacyHistoryReadCommunicationFailed,
          rawError: getAwarenessRawError(historyReadError),
          receivedCount: Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0,
          receivedTail: summarizeAwarenessReceivedDataTailForLog(),
          localDataLength: Array.isArray(userStore.localData) ? userStore.localData.length : 0,
          snapshot: getAwarenessConnectionSnapshot()
        });
      }

      const historyDateStartTimestamp = getLegacyHomeHistoryDateStartTimestamp(historyDate);
      const historySleepWindowStartTimestamp = getLegacyHomeHistorySleepWindowStartTimestamp(historyDate);
      const cloudCoverageSnapshot = getLegacyHomeCloudCoverageSnapshot(normalizedHistoryDeviceMac, historyDate);
      const cloudCoverageStatus = String(cloudCoverageSnapshot?.coverageStatus || '').trim().toLowerCase();
      const cloudCoverageMissingForDate =
        Boolean(cloudCoverageSnapshot) &&
        cloudCoverageSnapshot?.shouldSkipBle !== true &&
        (
          cloudCoverageStatus === 'missing' ||
          cloudCoverageStatus === 'empty' ||
          Number(cloudCoverageSnapshot?.recordCount || 0) <= 0 ||
          Number(cloudCoverageSnapshot?.latestTimestamp || 0) <= 0
        );
      const primaryHistoryReadReachedDateForFallback =
        hasLegacyHomeHistoryReachedDate(legacyHistoryReadMaxTimestamp, historyDate);
      const primaryHistoryStoppedBeforeTargetDate =
        legacyHistoryReadSucceeded &&
        !primaryHistoryReadError &&
        legacyHistoryReadStatus !== 'partial' &&
        legacyHistoryParsedComplete &&
        historySinceTimestamp > 0 &&
        historySleepWindowStartTimestamp > 0 &&
        historySinceTimestamp !== historySleepWindowStartTimestamp &&
        !primaryHistoryReadReachedDateForFallback;
      const l19PrimaryShortResult =
        isL19IncrementalHistoryRead &&
        cloudCoverageMissingForDate &&
        records.length <= 1;
      const shouldRunCloudMissingIncrementalFallback =
        !primaryHistoryReadError &&
        legacyHistoryReadSucceeded &&
        historySinceTimestamp > 0 &&
        historySleepWindowStartTimestamp > 0 &&
        historySinceTimestamp !== historySleepWindowStartTimestamp &&
        (
          l19PrimaryShortResult ||
          (records.length === 0 && cloudCoverageMissingForDate) ||
          primaryHistoryStoppedBeforeTargetDate
        );
      const shouldRunEmptyFallback =
        !primaryHistoryReadError &&
        (
          (records.length === 0 && options.force && historySinceTimestamp <= 0) ||
          shouldRunCloudMissingIncrementalFallback
        );
      if (shouldRunEmptyFallback) {
        legacyHistoryL19ShortResultRecoveryAttempted = l19PrimaryShortResult;
        const fallbackStartedAt = Date.now();
        const fallbackReadAll = historySinceTimestamp <= 0;
        const fallbackSinceTimestamp = shouldRunCloudMissingIncrementalFallback
          ? historySleepWindowStartTimestamp
          : historySinceTimestamp;
        const fallbackReadArgument = fallbackReadAll ? historyDate : fallbackSinceTimestamp;
        const fallbackReason = shouldRunCloudMissingIncrementalFallback
          ? (l19PrimaryShortResult
              ? 'l19-cloud-coverage-short-result'
              : primaryHistoryStoppedBeforeTargetDate
              ? 'primary-history-before-target-date'
              : 'cloud-coverage-missing-incremental-empty')
          : 'empty-primary-history';
        appendAwarenessDiagnosticLog('legacy-home-history-empty-fallback-start', {
          protocol,
          reason,
          date: historyDate,
          deviceMac: normalizedHistoryDeviceMac,
          historyReadKey,
          historyScopeKey,
          primarySinceTimestamp: historySinceTimestamp,
          primarySinceText: formatUnixTimestampForLog(historySinceTimestamp),
          fallbackSinceTimestamp,
          fallbackSinceText: formatUnixTimestampForLog(fallbackSinceTimestamp),
          historySleepWindowStartTimestamp,
          historySleepWindowStartText: formatUnixTimestampForLog(historySleepWindowStartTimestamp),
          cloudCoverageStatus,
          cloudCoverageRecordCount: cloudCoverageSnapshot?.recordCount,
          cloudCoverageLatestTimestamp: cloudCoverageSnapshot?.latestTimestamp,
          cloudCoverageLatestText: formatUnixTimestampForLog(Number(cloudCoverageSnapshot?.latestTimestamp || 0)),
          readAll: fallbackReadAll,
          reasonDetail: fallbackReason,
          primaryError: primaryHistoryReadError ? formatBleErrorMessage(primaryHistoryReadError, 'legacy history read failed') : undefined,
          primaryRawError: primaryHistoryReadError ? getAwarenessRawError(primaryHistoryReadError) : undefined,
          timeoutMs: LEGACY_HOME_EMPTY_HISTORY_FALLBACK_TIMEOUT_MS,
          primaryRecordCount: records.length,
          primaryMaxHistoryTimestamp: legacyHistoryReadMaxTimestamp,
          primaryMaxHistoryText: formatUnixTimestampForLog(legacyHistoryReadMaxTimestamp),
          primaryReachedDate: primaryHistoryReadReachedDateForFallback,
          snapshot: getAwarenessConnectionSnapshot()
        });
        if (fallbackReadAll) {
          await new Promise((resolve) =>
            setTimeout(resolve, LEGACY_HOME_EMPTY_HISTORY_FULL_FALLBACK_SETTLE_MS)
          );
          if (!isCurrentHistoryRead()) {
            throw new Error('History read context changed before full fallback.');
          }
        }
        const fallbackResult = await readLocalData(fallbackReadAll, fallbackReadArgument, undefined, {
          timeoutMs: LEGACY_HOME_EMPTY_HISTORY_FALLBACK_TIMEOUT_MS,
          silentUploadStatus: true,
          skipUpload: true
        });
        let fallbackRecords = Array.isArray((fallbackResult as any)?.records) ? (fallbackResult as any).records : [];
        const fallbackStatus = `${(fallbackResult as any)?.status || ''}`;
        if (fallbackStatus) legacyHistoryReadStatus = fallbackStatus;
        legacyHistoryParsedComplete =
          (fallbackResult as any)?.complete !== false && (fallbackResult as any)?.parsed?.complete !== false;
        if (fallbackRecords.length > 0) {
          historyReadRecordsForUpload = [
            ...historyReadRecordsForUpload,
            ...fallbackRecords
          ];
          legacyHistoryReadRecordCount = historyReadRecordsForUpload.length;
          legacyHomeHistoryReadHasUploadableRecords = true;
        }
        const fallbackRecordSummary = summarizeLegacyUploadRecordsForLog(fallbackRecords as Array<Record<string, any>>);
        updateLegacyHistoryReadMaxTimestamp(fallbackRecordSummary);
        markLegacyHomeHistoryReadFetchedForWindow({
          historyReadKey,
          historyScopeKey,
          deviceMac: normalizedHistoryDeviceMac,
          date: historyDate,
          maxReachedTimestamp: legacyHistoryReadMaxTimestamp,
          recordCount: fallbackRecords.length,
          reason: 'empty-fallback-result'
        });
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
          fallbackSinceTimestamp,
          fallbackSinceText: formatUnixTimestampForLog(fallbackSinceTimestamp),
          historySleepWindowStartTimestamp,
          historySleepWindowStartText: formatUnixTimestampForLog(historySleepWindowStartTimestamp),
          cloudCoverageStatus,
          cloudCoverageRecordCount: cloudCoverageSnapshot?.recordCount,
          cloudCoverageLatestTimestamp: cloudCoverageSnapshot?.latestTimestamp,
          cloudCoverageLatestText: formatUnixTimestampForLog(Number(cloudCoverageSnapshot?.latestTimestamp || 0)),
          reasonDetail: fallbackReason,
          primaryRecordCount: records.length,
          mergedRecordCount: historyReadRecordsForUpload.length,
          primaryMaxHistoryTimestamp: legacyHistoryReadMaxTimestamp,
          primaryReachedDate: primaryHistoryReadReachedDateForFallback,
          elapsedMs: Date.now() - fallbackStartedAt,
          status: (fallbackResult as any)?.status,
          complete: (fallbackResult as any)?.complete,
          parsedComplete: (fallbackResult as any)?.parsed?.complete,
          uploaded: (fallbackResult as any)?.uploaded,
          recordCount: fallbackRecords.length,
          recordSummary: fallbackRecordSummary,
          maxHistoryTimestamp: legacyHistoryReadMaxTimestamp,
          maxHistoryText: formatUnixTimestampForLog(legacyHistoryReadMaxTimestamp),
          receivedCount: Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0,
          receivedTail: summarizeAwarenessReceivedDataTailForLog(),
          localDataLength: Array.isArray(userStore.localData) ? userStore.localData.length : 0,
          rawMetricCounts: countRingHistoryRecordMetrics(fallbackRecords as Array<Record<string, any>>),
          sample: fallbackRecords.slice(0, 2),
          snapshot: getAwarenessConnectionSnapshot()
        });
        if (
          fallbackRecords.length === 0 &&
          shouldRunCloudMissingIncrementalFallback &&
          !fallbackReadAll &&
          !isL19IncrementalHistoryRead
        ) {
          const fullFallbackStartedAt = Date.now();
          appendAwarenessDiagnosticLog('legacy-home-history-empty-full-fallback-start', {
            protocol,
            reason,
            date: historyDate,
            deviceMac: normalizedHistoryDeviceMac,
            historyReadKey,
            historyScopeKey,
            primarySinceTimestamp: historySinceTimestamp,
            primarySinceText: formatUnixTimestampForLog(historySinceTimestamp),
            previousFallbackSinceTimestamp: fallbackSinceTimestamp,
            previousFallbackSinceText: formatUnixTimestampForLog(fallbackSinceTimestamp),
            historySleepWindowStartTimestamp,
            historySleepWindowStartText: formatUnixTimestampForLog(historySleepWindowStartTimestamp),
            cloudCoverageStatus,
            cloudCoverageRecordCount: cloudCoverageSnapshot?.recordCount,
            cloudCoverageLatestTimestamp: cloudCoverageSnapshot?.latestTimestamp,
            cloudCoverageLatestText: formatUnixTimestampForLog(Number(cloudCoverageSnapshot?.latestTimestamp || 0)),
            readAll: true,
            reasonDetail: 'cloud-coverage-missing-incremental-empty-full-read',
            timeoutMs: LEGACY_HOME_EMPTY_HISTORY_FULL_FALLBACK_TIMEOUT_MS,
            snapshot: getAwarenessConnectionSnapshot()
          });
          try {
            // Give Notify a short quiet window before the only full-history fallback.
            await new Promise((resolve) =>
              setTimeout(resolve, LEGACY_HOME_EMPTY_HISTORY_FULL_FALLBACK_SETTLE_MS)
            );
            if (!isCurrentHistoryRead()) {
              throw new Error('History read context changed before full fallback.');
            }
            const fullFallbackResult = await readLocalData(true, historyDate, undefined, {
              timeoutMs: LEGACY_HOME_EMPTY_HISTORY_FULL_FALLBACK_TIMEOUT_MS,
              silentUploadStatus: true,
              skipUpload: true
            });
            const fullFallbackRecords = Array.isArray((fullFallbackResult as any)?.records)
              ? (fullFallbackResult as any).records
              : [];
            const fullFallbackStatus = `${(fullFallbackResult as any)?.status || ''}`;
            if (fullFallbackStatus) legacyHistoryReadStatus = fullFallbackStatus;
            legacyHistoryParsedComplete =
              (fullFallbackResult as any)?.complete !== false && (fullFallbackResult as any)?.parsed?.complete !== false;
            if (fullFallbackRecords.length > 0) {
              fallbackRecords = fullFallbackRecords;
              historyReadRecordsForUpload = [
                ...historyReadRecordsForUpload,
                ...fullFallbackRecords
              ];
              legacyHistoryReadRecordCount = historyReadRecordsForUpload.length;
              legacyHomeHistoryReadHasUploadableRecords = true;
            }
            const fullFallbackRecordSummary = summarizeLegacyUploadRecordsForLog(fullFallbackRecords as Array<Record<string, any>>);
            updateLegacyHistoryReadMaxTimestamp(fullFallbackRecordSummary);
            markLegacyHomeHistoryReadFetchedForWindow({
              historyReadKey,
              historyScopeKey,
              deviceMac: normalizedHistoryDeviceMac,
              date: historyDate,
              maxReachedTimestamp: legacyHistoryReadMaxTimestamp,
              recordCount: fullFallbackRecords.length,
              reason: 'empty-full-fallback-result'
            });
            appendAwarenessDiagnosticLog('legacy-home-history-empty-full-fallback-result', {
              protocol,
              reason,
              date: historyDate,
              deviceMac: normalizedHistoryDeviceMac,
              historyReadKey,
              historyScopeKey,
              readAll: true,
              primarySinceTimestamp: historySinceTimestamp,
              primarySinceText: formatUnixTimestampForLog(historySinceTimestamp),
              previousFallbackSinceTimestamp: fallbackSinceTimestamp,
              previousFallbackSinceText: formatUnixTimestampForLog(fallbackSinceTimestamp),
              historySleepWindowStartTimestamp,
              historySleepWindowStartText: formatUnixTimestampForLog(historySleepWindowStartTimestamp),
              cloudCoverageStatus,
              cloudCoverageRecordCount: cloudCoverageSnapshot?.recordCount,
              cloudCoverageLatestTimestamp: cloudCoverageSnapshot?.latestTimestamp,
              cloudCoverageLatestText: formatUnixTimestampForLog(Number(cloudCoverageSnapshot?.latestTimestamp || 0)),
              reasonDetail: 'cloud-coverage-missing-incremental-empty-full-read',
              primaryRecordCount: records.length,
              mergedRecordCount: historyReadRecordsForUpload.length,
              primaryMaxHistoryTimestamp: legacyHistoryReadMaxTimestamp,
              primaryReachedDate: primaryHistoryReadReachedDateForFallback,
              elapsedMs: Date.now() - fullFallbackStartedAt,
              status: (fullFallbackResult as any)?.status,
              complete: (fullFallbackResult as any)?.complete,
              parsedComplete: (fullFallbackResult as any)?.parsed?.complete,
              uploaded: (fullFallbackResult as any)?.uploaded,
              recordCount: fullFallbackRecords.length,
              recordSummary: fullFallbackRecordSummary,
              maxHistoryTimestamp: legacyHistoryReadMaxTimestamp,
              maxHistoryText: formatUnixTimestampForLog(legacyHistoryReadMaxTimestamp),
              receivedCount: Array.isArray(userStore.receivedData) ? userStore.receivedData.length : 0,
              receivedTail: summarizeAwarenessReceivedDataTailForLog(),
              localDataLength: Array.isArray(userStore.localData) ? userStore.localData.length : 0,
              rawMetricCounts: countRingHistoryRecordMetrics(fullFallbackRecords as Array<Record<string, any>>),
              sample: fullFallbackRecords.slice(0, 2),
              snapshot: getAwarenessConnectionSnapshot()
            });
          } catch (fullFallbackError) {
            appendAwarenessDiagnosticLog('legacy-home-history-empty-full-fallback-failed', {
              protocol,
              reason,
              date: historyDate,
              deviceMac: normalizedHistoryDeviceMac,
              historyReadKey,
              historyScopeKey,
              primarySinceTimestamp: historySinceTimestamp,
              primarySinceText: formatUnixTimestampForLog(historySinceTimestamp),
              previousFallbackSinceTimestamp: fallbackSinceTimestamp,
              previousFallbackSinceText: formatUnixTimestampForLog(fallbackSinceTimestamp),
              historySleepWindowStartTimestamp,
              historySleepWindowStartText: formatUnixTimestampForLog(historySleepWindowStartTimestamp),
              cloudCoverageStatus,
              cloudCoverageRecordCount: cloudCoverageSnapshot?.recordCount,
              cloudCoverageLatestTimestamp: cloudCoverageSnapshot?.latestTimestamp,
              cloudCoverageLatestText: formatUnixTimestampForLog(Number(cloudCoverageSnapshot?.latestTimestamp || 0)),
              reasonDetail: 'cloud-coverage-missing-incremental-empty-full-read',
              elapsedMs: Date.now() - fullFallbackStartedAt,
              error: formatBleErrorMessage(fullFallbackError, 'legacy full history fallback failed'),
              rawError: getAwarenessRawError(fullFallbackError),
              snapshot: getAwarenessConnectionSnapshot()
            });
          }
        } else if (
          fallbackRecords.length === 0 &&
          shouldRunCloudMissingIncrementalFallback &&
          !fallbackReadAll &&
          isL19IncrementalHistoryRead
        ) {
          appendAwarenessDiagnosticLog('legacy-home-history-empty-full-fallback-skip', {
            protocol,
            reason,
            date: historyDate,
            deviceMac: normalizedHistoryDeviceMac,
            historyReadKey,
            historyScopeKey,
            primarySinceTimestamp: historySinceTimestamp,
            primarySinceText: formatUnixTimestampForLog(historySinceTimestamp),
            previousFallbackSinceTimestamp: fallbackSinceTimestamp,
            previousFallbackSinceText: formatUnixTimestampForLog(fallbackSinceTimestamp),
            skipReason: 'l19-incremental-no-new-data-terminal',
            snapshot: getAwarenessConnectionSnapshot()
          });
        }
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
          historySleepWindowStartTimestamp,
          historySleepWindowStartText: formatUnixTimestampForLog(historySleepWindowStartTimestamp),
          cloudCoverageStatus,
          cloudCoverageRecordCount: cloudCoverageSnapshot?.recordCount,
          cloudCoverageLatestTimestamp: cloudCoverageSnapshot?.latestTimestamp,
          cloudCoverageLatestText: formatUnixTimestampForLog(Number(cloudCoverageSnapshot?.latestTimestamp || 0)),
          skipReason: primaryHistoryReadError ? 'primary-read-failed-or-timeout' : 'incremental-read-empty',
          primaryError: primaryHistoryReadError ? formatBleErrorMessage(primaryHistoryReadError, 'legacy history read failed') : undefined,
          snapshot: getAwarenessConnectionSnapshot()
        });
      }
      if (isL19IncrementalHistoryRead) {
        const mergedRecordCount = historyReadRecordsForUpload.length;
        historyReadRecordsForUpload = historyReadRecordsForUpload.filter((record) =>
          getAwarenessHistoryRecordUploadWindowTimestamp(record as Record<string, any>) > historySinceTimestamp
        );
        legacyHistoryReadRecordCount = historyReadRecordsForUpload.length;
        legacyHomeHistoryReadHasUploadableRecords = legacyHistoryReadRecordCount > 0;
        legacyHistoryL19ShortResultUnresolved =
          cloudCoverageMissingForDate &&
          legacyHistoryReadRecordCount <= 1;
        legacyHistoryIncrementalNoNewDataTerminal =
          !primaryHistoryReadError &&
          legacyHistoryReadSucceeded &&
          legacyHistoryReadStatus !== 'partial' &&
          legacyHistoryParsedComplete &&
          legacyHistoryReadRecordCount === 0 &&
          !legacyHistoryL19ShortResultUnresolved;
        if (legacyHistoryL19ShortResultUnresolved) {
          appendAwarenessDiagnosticLog('legacy-home-history-l19-short-result-unresolved', {
            protocol,
            reason,
            date: historyDate,
            deviceMac: normalizedHistoryDeviceMac,
            historyReadKey,
            historyScopeKey,
            sinceTimestamp: historySinceTimestamp,
            sinceText: formatUnixTimestampForLog(historySinceTimestamp),
            mergedRecordCount,
            uploadRecordCount: legacyHistoryReadRecordCount,
            recoveryAttempted: legacyHistoryL19ShortResultRecoveryAttempted,
            cloudCoverageStatus,
            cloudCoverageRecordCount: cloudCoverageSnapshot?.recordCount,
            cloudCoverageLatestTimestamp: cloudCoverageSnapshot?.latestTimestamp,
            maxHistoryTimestamp: legacyHistoryReadMaxTimestamp,
            maxHistoryText: formatUnixTimestampForLog(legacyHistoryReadMaxTimestamp),
            snapshot: getAwarenessConnectionSnapshot()
          });
        }
        if (legacyHistoryIncrementalNoNewDataTerminal) {
          appendAwarenessDiagnosticLog('legacy-home-history-incremental-no-new-data-terminal', {
            protocol,
            reason,
            date: historyDate,
            deviceMac: normalizedHistoryDeviceMac,
            historyReadKey,
            historyScopeKey,
            sinceTimestamp: historySinceTimestamp,
            sinceText: formatUnixTimestampForLog(historySinceTimestamp),
            mergedRecordCount,
            uploadRecordCount: legacyHistoryReadRecordCount,
            maxHistoryTimestamp: legacyHistoryReadMaxTimestamp,
            maxHistoryText: formatUnixTimestampForLog(legacyHistoryReadMaxTimestamp),
            skippedFullHistoryFallback: true,
            snapshot: getAwarenessConnectionSnapshot()
          });
        }
      }
      const legacyHistoryReadWasEmptyIncremental =
        legacyHistoryReadSucceeded && legacyHistoryReadRecordCount === 0 && historySinceTimestamp > 0;
      const legacyHistoryReadReachedDate = hasLegacyHomeHistoryReachedDate(legacyHistoryReadMaxTimestamp, historyDate);
      legacyHistoryReadCompleted =
        legacyHistoryReadSucceeded &&
        legacyHistoryReadStatus !== 'partial' &&
        legacyHistoryParsedComplete &&
        !legacyHistoryL19ShortResultUnresolved &&
        (legacyHistoryReadReachedDate || legacyHistoryIncrementalNoNewDataTerminal);
      if (
        legacyHistoryReadSucceeded &&
        legacyHistoryReadStatus !== 'partial' &&
        legacyHistoryParsedComplete &&
        !legacyHistoryReadReachedDate &&
        !legacyHistoryIncrementalNoNewDataTerminal
      ) {
        appendAwarenessDiagnosticLog('legacy-home-history-read-incomplete-before-history-date', {
          protocol,
          reason,
          deviceMac: normalizedHistoryDeviceMac,
          historyDate,
          historyReadKey,
          historyScopeKey,
          historySinceTimestamp,
          historySinceText: formatUnixTimestampForLog(historySinceTimestamp),
          maxHistoryTimestamp: legacyHistoryReadMaxTimestamp,
          maxHistoryText: formatUnixTimestampForLog(legacyHistoryReadMaxTimestamp),
          historyDateStartTimestamp,
          historyDateStartText: formatUnixTimestampForLog(historyDateStartTimestamp),
          recordCount: legacyHistoryReadRecordCount,
          emptyIncrementalNotCompleted: legacyHistoryReadWasEmptyIncremental,
          snapshot: getAwarenessConnectionSnapshot()
        });
      }
    } catch (error) {
      const historyReadErrorMessage = formatBleErrorMessage(error, 'legacy history read background failed');
      legacyHistoryReadCommunicationFailed =
        /(?:communication|not\s+ready|disconnect|connection|listener|bluetooth|ble|\u84dd\u7259|\u65ad\u5f00)/i.test(historyReadErrorMessage);
      appendAwarenessDiagnosticLog('legacy-home-history-read-background-failed', {
        protocol,
        reason,
        deviceMac: normalizedHistoryDeviceMac,
        historyReadKey,
        historyScopeKey,
        elapsedMs: Date.now() - historyStartedAt,
        error: historyReadErrorMessage,
        communicationFailure: legacyHistoryReadCommunicationFailed,
        rawError: getAwarenessRawError(error),
        snapshot: getAwarenessConnectionSnapshot()
      });
    } finally {
      clearHistoryReadWatchdog();
      rememberLegacyHomeHistoryReadResult(normalizedHistoryDeviceMac, {
        completed: legacyHistoryReadCompleted,
        parsedComplete: legacyHistoryParsedComplete && legacyHistoryReadStatus !== 'partial',
        status: legacyHistoryReadStatus,
        records: historyReadRecordsForUpload as Array<Record<string, any>>,
        recordCount: legacyHistoryReadRecordCount,
        maxTimestamp: legacyHistoryReadMaxTimestamp,
        reason: legacyHistoryL19ShortResultUnresolved
          ? 'l19-short-result-incomplete'
          : 'legacy-home-history-read-background-finished'
      });
      appendAwarenessDiagnosticLog('legacy-home-history-read-background-finished', {
        protocol,
        reason,
        completed: legacyHistoryReadCompleted,
        status: legacyHistoryReadStatus,
        parsedComplete: legacyHistoryParsedComplete,
        deviceMac: normalizedHistoryDeviceMac,
        historyReadKey,
        historyScopeKey,
        elapsedMs: Date.now() - historyStartedAt,
        readElapsedMs: legacyHomeHistoryReadStartedAt > 0 ? Date.now() - legacyHomeHistoryReadStartedAt : 0,
        recordCount: legacyHistoryReadRecordCount,
        maxHistoryTimestamp: legacyHistoryReadMaxTimestamp,
        maxHistoryText: formatUnixTimestampForLog(legacyHistoryReadMaxTimestamp),
        l19ShortResultRecoveryAttempted: legacyHistoryL19ShortResultRecoveryAttempted,
        l19ShortResultUnresolved: legacyHistoryL19ShortResultUnresolved,
        historyDateStartTimestamp: getLegacyHomeHistoryDateStartTimestamp(historyDate),
        historyDateStartText: formatUnixTimestampForLog(getLegacyHomeHistoryDateStartTimestamp(historyDate)),
        receivedTail: summarizeAwarenessReceivedDataTailForLog(),
        snapshot: getAwarenessConnectionSnapshot()
      });
      legacyHomeHistoryUploadHandoffPending = true;
      if (!resetCurrentHistoryReadState()) {
        legacyHomeHistoryUploadHandoffPending = false;
        appendAwarenessDiagnosticLog('legacy-home-history-read-background-finished-stale', {
          protocol,
          reason,
          deviceMac: normalizedHistoryDeviceMac,
          historyReadKey,
          historyScopeKey,
          activeReadKey: legacyHomeHistoryReadActiveKey,
          activeScopeKey: legacyHomeHistoryReadActiveScopeKey,
          snapshot: getAwarenessConnectionSnapshot()
        });
        return;
      }
      if (legacyHistoryReadCompleted && !isAwarenessRwRing()) {
        // 缓存电量只能用于首屏占位，不能代表本轮设备电量。0x36 终帧确认且
        // 历史独占会话释放后，每轮都强制安排一次设备信息读取，让电量命令
        // 紧跟吐包结束执行，不再等用户进入详情页或等 5 分钟 TTL。
        const freshBatteryBarrierId = beginLegacyHomeFreshBatteryBarrier(
          protocol,
          'confirmed-history-terminal'
        );
        scheduleLegacyHomeDeviceInfoRetryAfterHistory(
          protocol,
          hasAwarenessBatteryDisplayValue(),
          'legacy-home-sync-after-history-terminal',
          'confirmed-history-terminal-fresh-battery',
          freshBatteryBarrierId,
          true
        );
      }
      flushLegacyHomeDeviceInfoPendingRetry('legacy-home-history-read-background-finished');
      if (legacyHistoryReadCompleted) {
        const historyReadCompletedAt = Date.now();
        const persistedHistoryReadCompletedAt = setDeviceHistoryReadCompletedAt(
          normalizedHistoryDeviceMac,
          protocol,
          historyReadCompletedAt
        );
        appendAwarenessDiagnosticLog('device-history-read-completed-at-updated', {
          protocol,
          deviceMac: normalizedHistoryDeviceMac,
          historyReadKey,
          historyScopeKey,
          historyReadCompletedAt: persistedHistoryReadCompletedAt,
          source: 'confirmed-0x36-terminal',
          snapshot: getAwarenessConnectionSnapshot()
        });
        const marked = markLegacyHomeHistoryReadCompletedForDevice(
          normalizedHistoryDeviceMac,
          historyDate,
          legacyHistoryReadMaxTimestamp || historySinceTimestamp,
          'legacy-home-history-read-background-complete'
        );
        if (marked) {
          clearLegacyHomeHistoryReadFailureKeys(historyReadKey, historyScopeKey);
          const completedAt = historyReadCompletedAt;
          legacyHomeHistoryReadAttemptAt.set(historyReadKey, completedAt);
          legacyHomeHistoryReadAttemptAt.set(historyScopeKey, completedAt);
          shouldSignalLegacyHistoryTerminalUpload = !legacyHistoryIncrementalNoNewDataTerminal;
        }
      }
      if (legacyHistoryReadCompleted) {
        // BLE 读取完成后立即释放交互锁，但用户可见的“同步中”要无缝交给
        // 后台上传和最终概览刷新。否则会暴露出“已连接 -> 电量 -> 数据刷新”
        // 的中间空档。homeDataRefreshingAfterSync 只是展示/调度栅栏，不会恢复
        // isSending，因此首页、健康、我的和内页仍可正常操作。
        homeDataRefreshingAfterSync.value = true;
        userStore.updateUploadingStatus('2');
        userStore.updateIsSending(false);
        homeDataSyncing.value = false;
        markAwarenessHomeSyncCompleted('legacy-home-history-read-terminal-ui-release');
        appendAwarenessDiagnosticLog('legacy-home-history-read-terminal-ui-released', {
          protocol,
          reason,
          deviceMac: normalizedHistoryDeviceMac,
          historyReadKey,
          historyScopeKey,
          recordCount: legacyHistoryReadRecordCount,
          settleMs: LEGACY_HOME_HISTORY_TERMINAL_UPLOAD_SETTLE_MS,
          snapshot: getAwarenessConnectionSnapshot()
        });
        if (!legacyHistoryIncrementalNoNewDataTerminal) {
          await waitForAwarenessMs(LEGACY_HOME_HISTORY_TERMINAL_UPLOAD_SETTLE_MS);
          // Keep the terminal snapshot built by getLegacyLocalDataStableSnapshot.
          // The upload watcher consumes this exact immutable batch and clears it
          // in its own finally block; rebuilding here was the 63 main-thread gap.
        }
      }
      // An L19 terminal empty read has no new payload. Avoid rebuilding thousands of
      // cached records and do not wake the upload watcher for an empty overlap frame.
      const finishedStableSnapshot = legacyHistoryIncrementalNoNewDataTerminal
        ? null
        : getLegacyLocalDataStableSnapshot();
      if (shouldSignalLegacyHistoryTerminalUpload) {
        // finishedStableSnapshot 已生成并写入终帧稳定缓存；tick 只负责唤醒上传，
        // watcher 会直接复用该快照，不再做第二轮全量归并。
        legacyHomeHistoryReadCompletedTick.value = Date.now();
      }
      const finishedSnapshotBelongsToDevice =
        Boolean(finishedStableSnapshot?.deviceMacNorm) &&
        finishedStableSnapshot?.deviceMacNorm === normalizedHistoryDeviceMac;
      const finishedSnapshotChangedDuringRead =
        finishedSnapshotBelongsToDevice &&
        finishedStableSnapshot?.signature !== historyReadInitialStableSnapshot?.signature;
      const finishedSnapshotHasUploadableRecords =
        Boolean(finishedStableSnapshot) &&
        finishedSnapshotBelongsToDevice &&
        hasLegacyLocalDataUploadableSnapshot(finishedStableSnapshot!);
      const shouldDispatchSnapshotUploadAfterRead =
        !isL19IncrementalHistoryRead && finishedSnapshotHasUploadableRecords;
      const shouldDispatchHistoryResultUploadAfterRead =
        legacyHistoryReadSucceeded && legacyHomeHistoryReadHasUploadableRecords && legacyHistoryReadRecordCount > 0;
      const shouldDispatchUploadAfterRead =
        shouldDispatchSnapshotUploadAfterRead || shouldDispatchHistoryResultUploadAfterRead;

      if (shouldDispatchUploadAfterRead) {
        const uploadDispatchKey = [
          historyReadKey,
          historyScopeKey,
          finishedStableSnapshot?.deviceMacNorm || normalizedHistoryDeviceMac,
          finishedStableSnapshot?.signature || 'unknown-signature',
          finishedStableSnapshot?.recordCount || 0,
          finishedStableSnapshot?.builtSubmitCount || 0,
          finishedStableSnapshot?.rawFrameCount || 0,
          legacyHistoryReadRecordCount,
          legacyHistoryReadMaxTimestamp
        ].join('|');
        const uploadDispatchNow = Date.now();
        if (
          legacyHomeHistoryUploadDispatchKey === uploadDispatchKey &&
          legacyHomeHistoryUploadDispatchAt > 0 &&
          uploadDispatchNow - legacyHomeHistoryUploadDispatchAt < LEGACY_HOME_HISTORY_UPLOAD_DISPATCH_DEDUP_MS
        ) {
          legacyHomeHistoryUploadHandoffPending = false;
          appendAwarenessDiagnosticLog('legacy-home-history-read-upload-dispatch-skip', {
            protocol,
            reason,
            skipReason: 'same-history-snapshot-dispatched-recently',
            elapsedMs: uploadDispatchNow - legacyHomeHistoryUploadDispatchAt,
            dedupMs: LEGACY_HOME_HISTORY_UPLOAD_DISPATCH_DEDUP_MS,
            completed: legacyHistoryReadCompleted,
            status: legacyHistoryReadStatus,
            parsedComplete: legacyHistoryParsedComplete,
            deviceMac: normalizedHistoryDeviceMac,
            historyReadKey,
            historyScopeKey,
            uploadDispatchKey,
            recordCount: legacyHistoryReadRecordCount,
            finishedStableSnapshot,
            snapshot: getAwarenessConnectionSnapshot()
          });
          return;
        }
        legacyHomeHistoryUploadDispatchKey = uploadDispatchKey;
        legacyHomeHistoryUploadDispatchAt = uploadDispatchNow;
        clearLegacyLocalDataIncompleteFlushTimer();
        if (!legacyHistoryReadCompleted) {
          const failedAt = Date.now();
          legacyHomeHistoryReadFailedAt.set(historyReadKey, failedAt);
          legacyHomeHistoryReadFailedAt.set(historyScopeKey, failedAt);
          legacyHomeHistoryReadFailedReason.set(historyReadKey, 'upload-dispatch-incomplete');
          legacyHomeHistoryReadFailedReason.set(historyScopeKey, 'upload-dispatch-incomplete');
        }
        appendAwarenessDiagnosticLog('legacy-home-history-read-upload-dispatch', {
          protocol,
          reason,
          dispatchReason: shouldDispatchSnapshotUploadAfterRead
            ? (finishedSnapshotChangedDuringRead ? 'stable-snapshot-changed-after-read' : 'stable-snapshot-uploadable-after-read')
            : 'history-result-records',
          completed: legacyHistoryReadCompleted,
          status: legacyHistoryReadStatus,
          parsedComplete: legacyHistoryParsedComplete,
          deviceMac: normalizedHistoryDeviceMac,
          historyReadKey,
          historyScopeKey,
          recordCount: legacyHistoryReadRecordCount,
          initialStableSnapshot: historyReadInitialStableSnapshot,
          finishedStableSnapshot,
          maxHistoryTimestamp: legacyHistoryReadMaxTimestamp,
          maxHistoryText: formatUnixTimestampForLog(legacyHistoryReadMaxTimestamp),
          snapshot: getAwarenessConnectionSnapshot()
        });
        const shouldUseCompletedUploadFastPath =
          legacyHistoryReadCompleted && legacyHistoryParsedComplete && finishedStableSnapshot?.completed === true;
        const historyUploadFlushQueued = shouldUseCompletedUploadFastPath
          ? requestOrScheduleLegacyLocalDataIncompleteFlush('legacy-home-history-read-upload-dispatch', protocol)
          : requestLegacyLocalDataTimeoutFlush(
              'legacy-home-history-read-upload-dispatch',
              protocol,
              finishedStableSnapshot || getLegacyLocalDataStableSnapshot()
            );
        appendAwarenessDiagnosticLog('legacy-home-history-read-upload-flush', {
          protocol,
          reason,
          historyUploadFlushQueued,
          flushStrategy: shouldUseCompletedUploadFastPath ? 'completed-fast-path' : 'timeout-flush',
          completed: legacyHistoryReadCompleted,
          status: legacyHistoryReadStatus,
          parsedComplete: legacyHistoryParsedComplete,
          deviceMac: normalizedHistoryDeviceMac,
          historyReadKey,
          historyScopeKey,
          finishedStableSnapshot,
          snapshot: getAwarenessConnectionSnapshot()
        });
        // The queued upload promise/watcher now owns the session boundary.
        legacyHomeHistoryUploadHandoffPending = false;
        if (!historyUploadFlushQueued) {
          legacyHomeHistoryReadCompletedTick.value = Date.now();
          if (legacyHistoryReadCompleted) {
            markAwarenessHomeSyncCompleted('legacy-home-history-read-upload-not-queued-complete');
            scheduleAwarenessAfterDataProcessed('legacy-home-history-read-upload-not-queued-complete');
          }
        }
        if (!historyUploadFlushQueued && !legacyHistoryReadCompleted && !options.longRetry && legacyHistoryReadStatus !== 'failed') {
          scheduleLegacyHomeHistoryLongRetry('legacy-home-history-read-upload-dispatch', protocol, {
            reason,
            historyReadKey,
            historyScopeKey,
            deviceMac: normalizedHistoryDeviceMac,
            sinceTimestamp: historySinceTimestamp
          });
        }
      } else {
        legacyHomeHistoryUploadHandoffPending = false;
      }

      if (!shouldDispatchUploadAfterRead && legacyHistoryReadCompleted && legacyHistoryReadRecordCount === 0) {
        updateAwarenessDeviceHistoryEmptyReadCheckpoint(getLegacyHomeEmptyReadCheckpointTimestamp(historySinceTimestamp), 'legacy-home-history-read-empty-complete', {
          deviceMac: historyDeviceMac,
          protocol
        });
        userStore.updateUploadingStatus('2');
        userStore.updateIsSending(false);
        homeDataSyncing.value = false;
        markAwarenessHomeSyncCompleted('legacy-home-history-read-empty-complete');
        scheduleAwarenessAfterDataProcessed('legacy-home-history-read-empty-complete');
      } else if (!shouldDispatchUploadAfterRead && !legacyHistoryReadCompleted) {
        const isEmptyHistoryReadWithoutRecords =
          legacyHistoryReadSucceeded && legacyHistoryReadStatus === 'empty' && legacyHistoryReadRecordCount === 0;
        if (isEmptyHistoryReadWithoutRecords) {
          clearLegacyHomeHistoryReadFailureKeys(historyReadKey, historyScopeKey);
          appendAwarenessDiagnosticLog('legacy-home-history-read-empty-no-cooldown', {
            protocol,
            reason,
            deviceMac: historyDeviceMac,
            historyReadKey,
            historyScopeKey,
            historySinceTimestamp,
            historySinceText: formatUnixTimestampForLog(historySinceTimestamp),
            elapsedMs: Date.now() - historyStartedAt,
            status: legacyHistoryReadStatus,
            recordCount: legacyHistoryReadRecordCount,
            snapshot: getAwarenessConnectionSnapshot()
          });
        } else {
          const skipLongRetryForTerminalAck = legacyHistoryReadSucceeded && legacyHistoryReadStatus === 'failed';
          // A physical disconnect already hands recovery to the connection
          // owner. Starting a forced history retry 800ms later duplicates the
          // reconnect/discovery path and amplifies one drop into a long UI
          // stall. A successful reconnect will dispatch the normal sync once.
          const skipLongRetryForCommunicationFailure = legacyHistoryReadCommunicationFailed;
          markCurrentHistoryReadFailed('legacy-home-history-read-timeout-cooldown-marked', historyStartedAt, {
            status: legacyHistoryReadStatus,
            skipLongRetry: skipLongRetryForTerminalAck || skipLongRetryForCommunicationFailure,
            skipLongRetryReason: skipLongRetryForTerminalAck
              ? 'terminal-local-data-ack-failed'
              : skipLongRetryForCommunicationFailure
                ? 'physical-disconnect-waits-for-connection-owner'
                : undefined,
            failureReason:
              legacyHistoryReadStatus === 'failed' || legacyHistoryReadCommunicationFailed
                ? 'communication-not-ready'
                : 'history-timeout'
          });
        }
      } else if (!shouldDispatchUploadAfterRead) {
        userStore.updateUploadingStatus('2');
        userStore.updateIsSending(false);
        homeDataSyncing.value = false;
        markAwarenessHomeSyncCompleted('legacy-home-history-read-complete-no-uploadable-snapshot');
        scheduleAwarenessAfterDataProcessed('legacy-home-history-read-complete-no-uploadable-snapshot');
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
      if (!isRwRing) {
        const skipByCloudCoverage = await shouldSkipLegacyHomeHistoryByCloudCoverage(
          protocol,
          'legacy-home-sync-before-ready-gate'
        );
        if (skipByCloudCoverage) {
          userStore.updateUploadingStatus('2');
          userStore.updateIsSending(false);
          homeDataSyncing.value = false;
          finishAwarenessHomeSyncWithoutHistoryCooldown('legacy-home-cloud-coverage-skip');
          scheduleAwarenessAfterDataProcessed('legacy-home-cloud-coverage-skip');
          appendAwarenessDiagnosticLog('legacy-home-sync-result', {
            protocol,
            reason: 'cloud-coverage-skip-before-ready-gate',
            elapsedMs: Date.now() - startedAt,
            hasCachedSnapshot,
            snapshot: getAwarenessConnectionSnapshot()
          });
          return;
        }
      }
      const readyGateSnapshot = getAwarenessConnectionSnapshot();
      const ensureStartedAt = Date.now();
      appendAwarenessDiagnosticLog('legacy-home-ensure-ready-start', {
        protocol,
        reason: 'device-info-readiness-gate',
        snapshot: readyGateSnapshot
      });
      const canUseReadyFastPath =
        readyGateSnapshot.connected === true &&
        readyGateSnapshot.ready === true &&
        Boolean(getAwarenessCanonicalDeviceMac());
      if (canUseReadyFastPath) {
        appendAwarenessDiagnosticLog('legacy-home-ensure-ready-fast-path', {
          protocol,
          reason: 'store-ready-candidate-requires-physical-probe',
          snapshot: readyGateSnapshot
        });
      }
      // Store readiness can be stale after the OS drops the BLE link. The SDK
      // performs a cheap physical-link probe and reuses a healthy recent link,
      // otherwise it reconnects before any device-info/history command is sent.
      const ensureReady = await ensureCommunicationReady();
      appendAwarenessDiagnosticLog('legacy-home-ensure-ready-result', {
        protocol,
        reason: 'device-info-readiness-gate',
        ready: ensureReady,
        elapsedMs: Date.now() - ensureStartedAt,
        snapshot: getAwarenessConnectionSnapshot()
      });
      if (!ensureReady) {
        appendAwarenessDiagnosticLog('legacy-home-sync-stop-before-device-info', {
          protocol,
          reason: 'communication-not-ready-before-device-info',
          elapsedMs: Date.now() - startedAt,
          snapshot: getAwarenessConnectionSnapshot()
        });
        userStore.updateUploadingStatus('2');
        userStore.updateIsSending(false);
        homeDataSyncing.value = false;
        releaseAwarenessHomeSyncSession('legacy-home-sync-communication-not-ready', 'failed', false);
        return;
      }
      if (!validateAwarenessHomeSyncContext('legacy-home-sync-ready-gate', {
        requireReady: true,
        allowMissingCurrent: false
      })) {
        userStore.updateUploadingStatus('2');
        userStore.updateIsSending(false);
        homeDataSyncing.value = false;
        releaseAwarenessHomeSyncSession('legacy-home-sync-ready-gate-failed', 'failed', false);
        return;
      }
      const shouldRefreshDeviceInfo =
        !hasCachedSnapshot ||
        (isRwRing
          ? now - lastAwarenessRefreshAt >= RW_AWARENESS_REFRESH_DEDUP_MS
          : now - lastAwarenessRefreshAt >= LEGACY_HOME_DEVICE_INFO_REFRESH_INTERVAL_MS);
      // Legacy device-info commands can remain queued far beyond their nominal
      // timeout (32s observed on weak links). They must not block the history
      // stream: use cached battery immediately and refill device info after the
      // history/upload session releases the BLE command channel. RW keeps its
      // existing protocol order because its history session depends on it.
      const shouldReadDeviceInfoBeforeHistory = isRwRing && (
        shouldRefreshDeviceInfo || !hasAwarenessFreshBatteryDisplayValue()
      );
      let deviceInfoBeforeHistoryHasBattery = hasAwarenessFreshBatteryDisplayValue();
      if (!isRwRing && !deviceInfoBeforeHistoryHasBattery) {
        scheduleLegacyHomeDeviceInfoRetryAfterHistory(
          protocol,
          hasCachedSnapshot,
          'legacy-home-sync-after-history',
          'history-priority-device-info-deferred'
        );
      }
      if (shouldReadDeviceInfoBeforeHistory) {
        appendAwarenessDiagnosticLog('legacy-home-device-info-before-history-dispatch', {
          protocol,
          reason: 'legacy-home-sync-before-history',
          hasCachedSnapshot,
          hasBatteryBefore: deviceInfoBeforeHistoryHasBattery,
          battery: displayBatteryValue.value,
          snapshot: getAwarenessConnectionSnapshot()
        });
        try {
          deviceInfoBeforeHistoryHasBattery = await refreshLegacyHomeDeviceInfoBeforeHistorySync(
            protocol,
            hasCachedSnapshot,
            'legacy-home-sync-before-history'
          );
        } catch (error) {
          appendAwarenessDiagnosticLog('legacy-home-device-info-before-history-failed-before-read', {
            protocol,
            reason: 'legacy-home-sync-before-history',
            hasCachedSnapshot,
            battery: displayBatteryValue.value,
            error: formatBleErrorMessage(error, 'legacy device info refresh failed'),
            rawError: getAwarenessRawError(error),
            snapshot: getAwarenessConnectionSnapshot()
          });
          deviceInfoBeforeHistoryHasBattery = hasAwarenessFreshBatteryDisplayValue();
        }
        if (!deviceInfoBeforeHistoryHasBattery) {
          appendAwarenessDiagnosticLog('legacy-home-device-info-before-history-degraded', {
            protocol,
            reason: 'battery-not-ready-before-history',
            hasCachedSnapshot,
            battery: displayBatteryValue.value,
            elapsedMs: Date.now() - startedAt,
            snapshot: getAwarenessConnectionSnapshot()
          });
        }
      } else {
        appendAwarenessDiagnosticLog('legacy-home-device-info-skip', {
          protocol,
          reason: 'legacy-home-sync',
          skipReason: isRwRing
            ? 'fresh-cached-device-info-before-history'
            : 'legacy-history-sync-prioritizes-history-read',
          skipDeviceInfoBeforeHistory: !isRwRing,
          hasCachedSnapshot,
          elapsedSinceRefreshMs: Date.now() - lastAwarenessRefreshAt,
          battery: displayBatteryValue.value,
          snapshot: getAwarenessConnectionSnapshot()
        });
      }
      if (!isRwRing) {
        // Device discovery/APP_CONNECT may run beside the backend overview, but
        // history parsing and upload must never compete with the first-screen
        // requests. Release occurs on success or timeout of the overview task.
        await waitForAwarenessInitialOverview('legacy-home-history-before-read');
        appendAwarenessDiagnosticLog('legacy-home-history-read-after-device-info', {
          protocol,
          hasCachedSnapshot,
          shouldReadDeviceInfoBeforeHistory,
          deviceInfoBeforeHistoryHasBattery,
          battery: displayBatteryValue.value,
          snapshot: getAwarenessConnectionSnapshot()
        });
        startLegacyHomeHistoryReadInBackground('legacy-home-sync-device-info-ready', protocol);
      }
      if (!shouldRefreshDeviceInfo) {
        lastAwarenessRefreshAt = Date.now();
      }
      appendAwarenessDiagnosticLog('legacy-home-sync-result', {
        protocol,
        elapsedMs: Date.now() - startedAt,
        hasCachedSnapshot,
        deviceInfoBeforeHistory: shouldReadDeviceInfoBeforeHistory,
        deviceInfoBeforeHistoryHasBattery,
        battery: displayBatteryValue.value,
        snapshot: getAwarenessConnectionSnapshot()
      });
      userStore.updateIsSending(false);
      return;
    } catch (error) {
      const backgroundWorkInProgress = isAwarenessBackgroundDataSyncInProgress();
      appendAwarenessDiagnosticLog('legacy-home-sync-failed', {
        protocol,
        elapsedMs: Date.now() - startedAt,
        backgroundWorkInProgress,
        error: formatBleErrorMessage(error, 'legacy home sync failed'),
        rawError: getAwarenessRawError(error),
        snapshot: getAwarenessConnectionSnapshot()
      });
      // An exception before the history task is handed off used to leave the
      // per-device claim alive for its two-minute stale window.  A later BLE
      // ready event was then "reused/coalesced" instead of starting the real
      // history read.  Release only when no history/upload continuation owns
      // the session; background work keeps its existing lifecycle.
      if (!backgroundWorkInProgress) {
        userStore.updateUploadingStatus('2');
        userStore.updateIsSending(false);
        homeDataSyncing.value = false;
        homeSyncRunningInBackground.value = false;
        homeDataRefreshingAfterSync.value = false;
        lastAwarenessHomeSyncDispatchKey = '';
        lastAwarenessHomeSyncDispatchAt = 0;
        releaseAwarenessHomeSyncSession('legacy-home-sync-exception', 'failed', false);
        appendAwarenessDiagnosticLog('legacy-home-sync-exception-session-released', {
          protocol,
          elapsedMs: Date.now() - startedAt,
          reason: 'no-history-or-upload-continuation',
          snapshot: getAwarenessConnectionSnapshot()
        });
      }
    } finally {
      if (started) {
        clearTimer();
        userStore.updateIsSending(false);
      }
      if (isAwarenessBackgroundDataSyncInProgress()) {
        appendAwarenessDiagnosticLog('legacy-home-sync-state-keep', {
          protocol,
          reason: 'history-or-upload-still-running',
          elapsedMs: Date.now() - startedAt,
          legacyHomeHistoryReadInFlight: legacyHomeHistoryReadInFlight.value,
          hasLegacyHomeHistoryReadPromise: Boolean(legacyHomeHistoryReadPromise),
          hasLegacyLocalDataStablePromise: Boolean(legacyLocalDataStablePromise),
          legacyLocalDataStableUploadScheduled,
          hasLegacyLocalDataUploadPromise: Boolean(legacyLocalDataUploadPromise),
          homeDataRefreshingAfterSync: homeDataRefreshingAfterSync.value,
          snapshot: getAwarenessConnectionSnapshot()
        });
      } else {
        homeDataSyncing.value = false;
      }
      awarenessRefreshPromise = null;
      scheduleAwarenessVisibleSyncReconcile('legacy-home-sync-finally');
    }
  })();
  return awarenessRefreshPromise;
};

const clearTimer = () => {
  if (sendTimer.value) {
    clearTimeout(sendTimer.value);
    sendTimer.value = null;
  }
  clearLegacyLocalDataIncompleteFlushTimer();
  clearLegacyHomeDeviceInfoRetryDeferredTimer();
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

const getLegacyHomeSyncPreflightDecision = (
  trigger: string,
  protocol: string,
  options: { force?: boolean } = {}
) => {
  const deviceMac = getAwarenessCheckpointDeviceMac() || getAwarenessUploadDeviceMac();
  const checkpoint = getDeviceHistoryCheckpointMeta(deviceMac, protocol || 'legacy');
  const readCursor = Number(checkpoint?.readTimestamp || 0);
  return decideDeviceSync({
    trigger,
    checkpoint: checkpoint
      ? {
          ...checkpoint,
          timestamp: readCursor
        }
      : checkpoint,
    force: shouldBypassLegacyHomeHistoryRecentReadGate(trigger, options),
    includeSleep: true,
    normalOverlapSeconds: LEGACY_HISTORY_READ_CHECKPOINT_OVERLAP_SECONDS,
    sleepOverlapSeconds: LEGACY_HISTORY_READ_CHECKPOINT_OVERLAP_SECONDS
  });
};

const dispatchAwarenessHomeSyncWhenReady = (trigger: string, options: { force?: boolean } = {}) => {
  if (!awarenessPageActive.value || !userStore.token) return false;
  if (!hasAwarenessRuntimeCommunicationReady()) {
    appendAwarenessDiagnosticLog('home-sync-ready-dispatch-deferred', {
      trigger,
      reason: 'communication-not-ready',
      snapshot: getAwarenessConnectionSnapshot()
    });
    return false;
  }

  if (isAwarenessRwRing()) {
    appendAwarenessDiagnosticLog('home-sync-communication-ready-dispatch', {
      trigger,
      protocol: 'rw',
      snapshot: getAwarenessConnectionSnapshot()
    });
    void syncRwHomeHistoryAndRefreshOverview(getSelectedDetailDate(), trigger, options);
    return true;
  }

  if (awarenessHomeSyncDispatchPromise) {
    appendAwarenessDiagnosticLog('home-sync-dispatch-reused', {
      trigger,
      reason: 'preflight-or-sync-dispatch-running',
      snapshot: getAwarenessConnectionSnapshot()
    });
    return true;
  }

  const dispatchKey = `${getAwarenessHomeSyncCooldownKey()}:${formatLocalDate(new Date())}`;
  const dispatchNow = Date.now();
  if (
    !options.force &&
    dispatchKey === lastAwarenessHomeSyncDispatchKey &&
    dispatchNow - lastAwarenessHomeSyncDispatchAt < AWARENESS_HOME_SYNC_TRIGGER_COALESCE_MS
  ) {
    appendAwarenessDiagnosticLog('home-sync-dispatch-coalesced', {
      trigger,
      dispatchKey,
      elapsedMs: dispatchNow - lastAwarenessHomeSyncDispatchAt,
      coalesceMs: AWARENESS_HOME_SYNC_TRIGGER_COALESCE_MS,
      snapshot: getAwarenessConnectionSnapshot()
    });
    return true;
  }

  lastAwarenessHomeSyncDispatchKey = dispatchKey;
  lastAwarenessHomeSyncDispatchAt = dispatchNow;
  const dispatchTask = (async () => {
    const protocol = userStore.deviceInfo?.protocol || ringStore.deviceInfo?.protocol || 'legacy';
    const preflightDecision = getLegacyHomeSyncPreflightDecision(trigger, protocol, options);
    if (preflightDecision.action === 'skip') {
      appendAwarenessDiagnosticLog('home-sync-preflight-skip', {
        trigger,
        protocol,
        reason: preflightDecision.reason,
        elapsedSinceSuccessMs: Number.isFinite(preflightDecision.elapsedSinceSuccessMs)
          ? preflightDecision.elapsedSinceSuccessMs
          : undefined,
        snapshot: getAwarenessConnectionSnapshot()
      });
      scheduleAwarenessAfterDataProcessed(`home-sync-preflight-skip:${preflightDecision.reason}`);
      return true;
    }

    const skipByCloudCoverage = await shouldSkipLegacyHomeHistoryByCloudCoverage(
      protocol,
      `legacy-${trigger}-preflight`
    );
    if (skipByCloudCoverage) {
      appendAwarenessDiagnosticLog('home-sync-preflight-skip', {
        trigger,
        protocol,
        reason: 'cloud-coverage-complete',
        snapshot: getAwarenessConnectionSnapshot()
      });
      scheduleAwarenessAfterDataProcessed('home-sync-preflight-cloud-coverage-skip');
      return true;
    }

    if (!awarenessPageActive.value || !hasAwarenessRuntimeCommunicationReady()) return false;
    const sessionTrigger = `legacy-${trigger}`;
    if (!claimAwarenessHomeSyncSession(sessionTrigger, options)) return false;
    appendAwarenessDiagnosticLog('home-sync-communication-ready-dispatch', {
      trigger,
      protocol: 'legacy',
      snapshot: getAwarenessConnectionSnapshot()
    });
    try {
      await executeCommandsSequentially();
      appendAwarenessDiagnosticLog('legacy-home-ready-sync-result', {
        trigger,
        reason: 'overview-refresh-deferred-to-upload-result',
        snapshot: getAwarenessConnectionSnapshot()
      });
      return true;
    } catch (syncError) {
      appendAwarenessDiagnosticLog('legacy-home-ready-sync-failed', {
        trigger,
        error: formatBleErrorMessage(syncError, 'legacy home sync failed'),
        rawError: getAwarenessRawError(syncError),
        snapshot: getAwarenessConnectionSnapshot()
      });
      return false;
    }
  })();
  awarenessHomeSyncDispatchPromise = dispatchTask;
  const clearDispatchTask = () => {
    if (awarenessHomeSyncDispatchPromise === dispatchTask) {
      awarenessHomeSyncDispatchPromise = null;
    }
  };
  void dispatchTask.then(clearDispatchTask, clearDispatchTask);
  return true;
};

watch(
  awarenessCommunicationReadySignal,
  (ready, wasReady) => {
    if (!ready || wasReady) return;
    awarenessPhysicalConnectionGeneration += 1;
    appendAwarenessDiagnosticLog('home-sync-communication-ready-event', {
      connectionGeneration: awarenessPhysicalConnectionGeneration,
      snapshot: getAwarenessConnectionSnapshot()
    });
    if (!awarenessPageActive.value || !userStore.token) return;
    void nextTick(() => {
      dispatchAwarenessHomeSyncWhenReady('communication-ready');
    });
  },
  { flush: 'post' }
);

onLoad(async () => {
  if (!userStore.token) {
    return;
  }
});
onShow(async () => {
  try {
    awarenessPageGeneration += 1;
    reconcileAwarenessSoftTimeouts('page-show');
    awarenessPageActive.value = true;
    // Page timers may be suspended while another tab/detail page is visible.
    // Reconcile against the absolute deadline immediately so a 12s interaction
    // budget can never become a 30s+ wall-clock lock after navigation.
    armAwarenessForegroundInteractionBudget('page-show');
    resetAwarenessNavigationState('page-show');
    if (!userStore.token) {
      return;
    }
    const postBindingRefresh = consumePostBindingRefreshFlag();
    const pageShowTrigger = postBindingRefresh ? 'post-binding-page-show' : 'page-show';
    schedulePendingParsedUploadRetry(pageShowTrigger);
    appendAwarenessDiagnosticLog('page-show', {
      postBindingRefresh,
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
      // Female-health data is backend-only business data. It must not be
      // suppressed by a BLE history read/upload; otherwise every onShow during
      // a long sync skips the request and leaves the card stale indefinitely.
      if (
        claimAwarenessAuxiliaryRefresh(
          'girlHealthBundle',
          today.value,
          forceGirlHealthRefresh ? 0 : AWARENESS_AUXILIARY_REFRESH_TTL_MS
        )
      ) {
        appendAwarenessDiagnosticLog('girl-health-background-load-scheduled', {
          date: girlHealthDate,
          forced: forceGirlHealthRefresh,
          delayMs: AWARENESS_GIRL_HEALTH_BACKGROUND_DELAY_MS,
          snapshot: getAwarenessConnectionSnapshot()
        });
        setTimeout(() => {
          void (async () => {
          const healthData = await requestAwarenessAuxiliary('girlHealth', today.value, () =>
            getGirlHealth({}, getAwarenessAuxiliaryRequestConfig())
          );
          writeLocalGirlHealthProfile(userInfo, healthData);
          let hasPeriodProfile =
            localHasPeriodProfile || Boolean(localGirlHealthProfile) || hasGirlHealthProfilePayload(healthData);
          const backendProfilePhaseSynced = syncHomePeriodCycle(healthData, girlHealthDate);
          let profilePhaseSynced = backendProfilePhaseSynced || localProfilePhaseSynced;
          let detailPhaseSynced = false;
          let detailAdvice = '';

          const detailData = await requestAwarenessAuxiliary('userGirlHealthAll', today.value, () =>
            getUserGirlHealthAll({ date: girlHealthDate }, getAwarenessAuxiliaryRequestConfig())
          );
          if (healthData == null || detailData == null) {
            releaseAwarenessAuxiliaryRefresh('girlHealthBundle', today.value, 'bundle-request-incomplete');
          }
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
          releaseAwarenessAuxiliaryRefresh('girlHealthBundle', today.value, 'bundle-request-failed');
          appendAwarenessDiagnosticLog('girl-health-background-load-failed', {
            error: formatBleErrorMessage(error, 'girl health background load failed')
          });
          });
        }, AWARENESS_GIRL_HEALTH_BACKGROUND_DELAY_MS);
      }
    }


    yesterdayInfo.value = getDateInfo(yesterday.value);
    beforeYesterdayInfo.value = getDateInfo(beforeYesterday.value);
    // await connectReload();
    userStore.fetchUserInfo();
    pullDownProgress.value = 30;

    // First dispatch backend overview requests. BLE readiness/APP_CONNECT is
    // allowed to progress in parallel, while the history stage waits on the
    // explicit gate above.
    const keepPreviousCompleteSnapshot = Boolean(
      activeAwarenessHomeSyncClaim || isAwarenessDataSyncInProgress()
    );
    if (keepPreviousCompleteSnapshot) {
      appendAwarenessDiagnosticLog('business-overview-page-show-stable-snapshot-kept', {
        trigger: pageShowTrigger,
        reason: 'device-sync-active',
        snapshot: getAwarenessConnectionSnapshot()
      });
    } else {
      const initialOverviewGate = beginAwarenessInitialOverviewGate(pageShowTrigger);
      const initialOverviewTask = refreshPageDataAndCharts({
        trigger: postBindingRefresh ? 'post-binding-page-show-data-load' : 'page-show-data-load',
        force: postBindingRefresh,
        allowDuringSync: false
      });
      const releaseInitialOverviewGate = () => {
        if (initialOverviewGate.seq === awarenessInitialOverviewGateSeq) {
          releaseAwarenessInitialOverviewGate?.();
        }
      };
      void initialOverviewTask.then(releaseInitialOverviewGate, releaseInitialOverviewGate);
    }
    dispatchAwarenessHomeSyncWhenReady(pageShowTrigger);
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
  awarenessPageActive.value = false;
  awarenessPageGeneration += 1;
  reconcileAwarenessSoftTimeouts('page-hide', true);
  releaseAwarenessInitialOverviewGate?.();
  // clearTimer();
});
const scrollTop = ref(0);
onPageScroll((e) => {
  scrollTop.value = e.scrollTop;
});
onUnload(() => {
  awarenessPageActive.value = false;
  awarenessPageGeneration += 1;
  reconcileAwarenessSoftTimeouts('page-unload', true);
  releaseAwarenessInitialOverviewGate?.();
  if (homeSyncForegroundBudgetTimer) {
    clearTimeout(homeSyncForegroundBudgetTimer);
    homeSyncForegroundBudgetTimer = null;
  }
  if (awarenessConnectedStatusTimer) {
    clearTimeout(awarenessConnectedStatusTimer);
    awarenessConnectedStatusTimer = null;
  }
  if (homeFreshBatteryBarrierTimer) {
    clearTimeout(homeFreshBatteryBarrierTimer);
    homeFreshBatteryBarrierTimer = null;
  }
  homeFreshBatteryReadingAfterSync.value = false;
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
    if (activeAwarenessHomeSyncClaim || isAwarenessDataSyncInProgress()) {
      appendAwarenessDiagnosticLog('pull-down-stable-snapshot-kept', {
        reason: 'device-sync-active',
        snapshot: getAwarenessConnectionSnapshot()
      });
      pullDownProgress.value = 100;
      return;
    }
    if (isAwarenessRwRing()) {
      pullDownProgress.value = 60;
      await refreshAwarenessBusinessOverview(formatLocalDate(new Date()), {
        trigger: 'pull-down-rw-overview',
        allowDuringSync: true
      });
      pullDownProgress.value = 100;
      void syncRwHomeHistoryAndRefreshOverview(formatLocalDate(new Date()), 'pull-down-refresh-background', { force: true });
      return;
    }
    if (hasAwarenessCommunicationReady()) {
      appendAwarenessDiagnosticLog('legacy-home-pull-down-sync-started', {
        snapshot: getAwarenessConnectionSnapshot()
      });
      pullDownProgress.value = 60;
      pullDownProgress.value = 100;
      dispatchAwarenessHomeSyncWhenReady('pull-down-refresh', { force: true });
      appendAwarenessDiagnosticLog('legacy-home-pull-down-sync-background-started', {
        snapshot: getAwarenessConnectionSnapshot()
      });
      return;
    }
    await refreshAwarenessBusinessOverview(formatLocalDate(new Date()), {
      trigger: 'pull-down',
      allowDuringSync: true
    });
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
              @tap="handleCalendarDayTap(index)"
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
              <view class="fs-20">{{ displayBatteryValue }}</view>
            </view>
          </view> -->
          <view class="flex ai-center jc-center">
            <!-- 调试信息（可选） -->
            <!-- <view v-if="false" style="position: absolute; top: -30rpx; left: 0; background: rgba(0,0,0,0.7); color: white; padding: 5rpx; font-size: 20rpx; z-index: 9999;">
    调试: {{ debugBluetoothInfo }}
  </view> -->

            <!-- 使用计算属性进行条件渲染 -->
            <view v-if="bluetoothStatus.isDisconnected" class="bluetooth-transition bluetooth-disconnected flex fd-c ai-center">
              <uv-image :src="bluetoothStatus.iconPath" width="48rpx" height="48rpx"></uv-image>
              <view class="fs-20"><text>未连接</text></view>
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
      <uni-calendar ref="calendar" :insert="false" @confirm="handleCalendarConfirm" />

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
        @tap="openHomeDetail('exercise')"
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
        @tap="openHomeDetail('relax')"
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
            <uv-icon name="arrow-right" color="#C6C6C6" size="14"></uv-icon>
          </view>
        </view>
        <view class="module-content flex ai-end jc-between">
          <view class="relax-score flex fd-c jc-center">
            <text class="score-label">{{ relaxStressStatus }}</text>
          </view>
          <view v-if="!relaxStressIsEmpty" class="flex ai-center jc-center flex-1 ml-30">
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
            <view class="period-btn flex ai-center" @tap.stop="openPeriodPage('/homeDetail/periodQuestionnaire/periodQuestionnaire')">
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
