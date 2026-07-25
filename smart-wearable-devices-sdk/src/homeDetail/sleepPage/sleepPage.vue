<script setup lang="ts">
// @ts-nocheck
import { computed, ref } from 'vue';
import { onLoad, onPageScroll, onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import sleepTime from '@/homeDetail/sleepPage/components/sleepTime.vue';
import sleepRage from '@/homeDetail/sleepPage/components/sleepRage.vue';
import sleepScore from '@/homeDetail/sleepPage/components/sleepScore.vue';
import sleepNap from '@/homeDetail/sleepPage/components/sleepNap.vue';

import { getDateInfo, getYesterday, getBeforeYesterday, formatLocalDate } from '@/utils/utils.js';
import HeartRate from '@/homeDetail/vitalSigns/components/heartRate.vue';
import oxyGen from '@/homeDetail/vitalSigns/components/oxyGen.vue';
import heartRateVariability from '@/homeDetail/vitalSigns/components/heartRateVariability.vue';
import temperature from '@/homeDetail/vitalSigns/components/temperature.vue';
import eventSummary from '@/homeDetail/sleepPage/components/eventSummary.vue';
import { useRingBusinessHistoryPageSync } from '@/composables/useRingBusinessHistoryPageSync';
import { appendRingDiagnosticLog, RW_DIAGNOSTIC_BUILD_TAG } from '@/composables/useRwForegroundMeasurement';
import { useUserStore } from '@/stores/user';
import { useRingStore } from '@/stores';

import type { sleepOverview, sleepDetail, sleepSegment, heartRateDetail, sleepNapType, sleepSummaryData } from '@/types/api/homeDetail';
import {
  getSleepOverview,
  getSleepDetail,
  getSleepSegment,
  getSleepHeartRateDetail,
  getSleepHrvDetail,
  getSleepBloodOxygenDetail,
  getBodyTemperatureDetail,
  getSleepNap,
  getsleepSummary
} from '@/common/api/homeDetail';

import DetailInfo from '@/components/DetailInfo.vue';
import { usePopupFixer } from '@/hooks/usePopupFixer';

const { isPopupActive, fixedPageStyle } = usePopupFixer();
const ringBleBridge = useRingBusinessHistoryPageSync();
const userStore = useUserStore();
const ringStore = useRingStore();

const scrollTop = ref<number>(0);

const listData = ref<string[]>([
  'sleepScore',
  'sleepInterval',
  'subjectiveSleepScore',
  'heartRate',
  'bloodOxygenSaturation',
  'heartRateVariability',
  'skinTemperature',
  'napRecord',
  'activitySummary'
]);
const getCurrentRingProtocol = () => ringStore.deviceInfo?.protocol || userStore.deviceInfo?.protocol;
const isCurrentRwRing = () => getCurrentRingProtocol() === 'rw';
const visibleListData = computed(() =>
  isCurrentRwRing() ? listData.value.filter((cardId) => cardId !== 'skinTemperature') : listData.value
);
const visibleCards = ref<string[]>([]);
const cardForm = ref({});

const sleepOverviewObj = ref<sleepOverview>();
const sleepDetailObj = ref<sleepDetail>();
const sleepSegmentObj = ref<sleepSegment>();
const heartRateObj = ref<heartRateDetail>();
const hrvObj = ref<heartRateDetail>();
const oxyGenObj = ref<heartRateDetail>();
const temperatureObj = ref<heartRateDetail>();
const sleepNapList = ref<sleepNapType[]>([]);
const sleepSummaryObj = ref<sleepSummaryData>();
const MAX_MAIN_SLEEP_MINUTES = 16 * 60;
const MAIN_SLEEP_OVERVIEW_TOLERANCE_MINUTES = 120;

const toPositiveNumber = (value: unknown) => {
  if (value == null || value === '') return 0;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

const getOverviewSleepDurationMinutes = () => toPositiveNumber(sleepOverviewObj.value?.sleepDuration);

const parseClockMinutes = (value: unknown) => {
  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
};

const formatClockMinutes = (minutes: number) => {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
};

const getSleepSegmentSpanMinutes = (segment?: sleepSegment) => {
  const start = parseClockMinutes(segment?.startTime);
  let end = parseClockMinutes(segment?.endTime);
  if (start == null || end == null) return 0;
  if (end < start) end += 1440;
  return end - start;
};

const normalizeTimelineMinutes = (value: unknown, anchorMinutes: number | null) => {
  let minutes = parseClockMinutes(value);
  if (minutes == null) return null;
  if (anchorMinutes != null && minutes < anchorMinutes - 6 * 60) {
    minutes += 1440;
  }
  return minutes;
};

const normalizeSleepStageText = (value: unknown) => {
  const key = String(value ?? '').trim();
  if (!key) return '';
  return SLEEP_STAGE_NAMES[key] || SLEEP_STAGE_NAMES[key.toLowerCase()] || '';
};

const hasExplicitSleepType = (point: any) =>
  point?.sleepType !== undefined ||
  point?.sleep_type !== undefined ||
  point?.sleepTypeName !== undefined ||
  point?.sleep_type_name !== undefined;

const getExplicitSleepStageValue = (point: any) => {
  const candidates = [
    point?.sleepType,
    point?.sleep_type,
    point?.sleepTypeName,
    point?.sleep_type_name
  ];
  return candidates.find((item) => item !== undefined && item !== null && String(item).trim() !== '');
};

const getSleepStageRawValue = (point: any) => {
  const explicitValue = getExplicitSleepStageValue(point);
  if (explicitValue !== undefined) return String(explicitValue ?? '').trim();

  const candidates = [
    point?.sleepState,
    point?.sleep_state,
    point?.sleepStatus,
    point?.sleep_status,
    point?.sleepStage,
    point?.sleep_stage,
    point?.stageName,
    point?.status,
    point?.state,
    point?.stage,
    point?.type,
    point?.name,
    point?.value
  ];
  const value = candidates.find((item) => item !== undefined && item !== null && String(item).trim() !== '');
  return String(value ?? '').trim();
};

const isSleepStagePoint = (point: any) => {
  const value = getSleepStageRawValue(point);
  return value === '2' || value === '3' || value === '4' || ['深睡', '浅睡', '快速眼动'].includes(value);
};

const SLEEP_STAGE_NAMES: Record<string, string> = {
  '1': '清醒',
  '2': '快速眼动',
  '3': '浅睡',
  '4': '深睡',
  '5': '小睡',
  清醒: '清醒',
  快速眼动: '快速眼动',
  浅睡: '浅睡',
  深睡: '深睡',
  小睡: '小睡'
};
const MAIN_SLEEP_GAP_MINUTES = 90;
const DEFAULT_STAGE_SAMPLE_MINUTES = 10;

Object.assign(SLEEP_STAGE_NAMES, {
  awake: '清醒',
  wake: '清醒',
  rem: '快速眼动',
  REM: '快速眼动',
  light: '浅睡',
  deep: '深睡',
  nap: '小睡'
});

const getSleepStageName = (point: any) => {
  const value = getSleepStageRawValue(point);
  return normalizeSleepStageText(value);
};
const isNapStagePoint = (point: any) => {
  if (hasExplicitSleepType(point)) {
    return normalizeSleepStageText(getExplicitSleepStageValue(point)) === '小睡';
  }
  const value = getSleepStageRawValue(point);
  return value === '5' || value === '小睡';
};

const getMainSleepAnalysis = (detail?: sleepDetail, segment?: sleepSegment) => {
  const chartData = Array.isArray(detail?.chartData) ? detail.chartData : [];
  if (!chartData.length) {
    return { endTime: '', chartData: [], chartDataSection: [] as Point[] };
  }

  const segmentStart = parseClockMinutes(segment?.startTime);
  let segmentEnd = parseClockMinutes(segment?.endTime);
  if (segmentStart != null && segmentEnd != null && segmentEnd < segmentStart) {
    segmentEnd += 1440;
  }

  const points = chartData
    .map((item: any) => ({ item, minute: normalizeTimelineMinutes(item?.time, segmentStart) }))
    .filter((entry: any) => entry.minute != null)
    .sort((a: any, b: any) => a.minute - b.minute);
  if (!points.length) return { endTime: '', chartData: [], chartDataSection: [] as Point[] };

  const ordinaryGaps = points
    .slice(0, -1)
    .map((entry: any, index: number) => points[index + 1].minute - entry.minute)
    .filter((gap: number) => gap > 0 && gap <= 60)
    .sort((a: number, b: number) => a - b);
  const typicalGap = ordinaryGaps.length
    ? ordinaryGaps[Math.floor(ordinaryGaps.length / 2)]
    : DEFAULT_STAGE_SAMPLE_MINUTES;

  let mainEnd = segmentEnd ?? points[points.length - 1].minute + typicalGap;
  let cutoffIndex = points.length;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1];
    if (isNapStagePoint(current.item)) {
      mainEnd = previous ? previous.minute + Math.min(typicalGap, 30) : current.minute;
      cutoffIndex = index;
      break;
    }
    if (previous && current.minute - previous.minute > MAIN_SLEEP_GAP_MINUTES) {
      mainEnd = previous.minute + Math.min(typicalGap, 30);
      cutoffIndex = index;
      break;
    }
  }
  if (segmentEnd != null) mainEnd = Math.min(mainEnd, segmentEnd);

  const mainPoints = points.slice(0, cutoffIndex).filter((entry: any) => !isNapStagePoint(entry.item));
  const mainStagePoints = mainPoints.filter((entry: any) => Boolean(getSleepStageName(entry.item)));
  if (!mainStagePoints.length) {
    const sourceSection = Array.isArray(segment?.chartDataSection) ? segment.chartDataSection : [];
    const chartDataSection = ['清醒', '快速眼动', '浅睡', '深睡'].map((time) => {
      const source = sourceSection.find((item: any) => item?.time === time);
      return { time, value: String(Math.max(0, toPositiveNumber(source?.value))) };
    });
    const asleepMinutes = chartDataSection
      .filter((item) => item.time !== '清醒')
      .reduce((total, item) => total + toPositiveNumber(item.value), 0);
    const fallbackEnd = segmentStart != null && asleepMinutes > 0 ? segmentStart + asleepMinutes : mainEnd;
    return {
      endTime: fallbackEnd > (segmentStart ?? -1) ? formatClockMinutes(fallbackEnd) : '',
      chartData: [],
      chartDataSection
    };
  }
  const stageMinutes: Record<string, number> = { 清醒: 0, 快速眼动: 0, 浅睡: 0, 深睡: 0 };
  mainStagePoints.forEach((entry: any, index: number) => {
    const stageName = getSleepStageName(entry.item);
    if (!stageName) return;
    const nextMinute = mainStagePoints[index + 1]?.minute ?? mainEnd;
    const duration = Math.max(0, Math.min(nextMinute, mainEnd) - entry.minute);
    stageMinutes[stageName] += duration;
  });

  const chartDataSection = ['清醒', '快速眼动', '浅睡', '深睡'].map((time) => ({
    time,
    value: String(Math.round(stageMinutes[time]))
  }));
  return {
    endTime: mainEnd > (segmentStart ?? -1) ? formatClockMinutes(mainEnd) : '',
    chartData: mainStagePoints.map((entry: any) => entry.item),
    chartDataSection
  };
};

const shouldPreferOverviewSleepDuration = (detailMinutes = 0) => {
  const overviewMinutes = getOverviewSleepDurationMinutes();
  if (!overviewMinutes) return false;
  if (!detailMinutes) return true;
  return detailMinutes > MAX_MAIN_SLEEP_MINUTES || detailMinutes > overviewMinutes + MAIN_SLEEP_OVERVIEW_TOLERANCE_MINUTES;
};

const mainSleepAnalysis = computed(() => getMainSleepAnalysis(sleepDetailObj.value, sleepSegmentObj.value));

const displaySleepDetailObj = computed(() => {
  const detail = sleepDetailObj.value || {};
  const analysis = mainSleepAnalysis.value;
  const detailMinutes = toPositiveNumber(detail.sleepDuration);
  if (!shouldPreferOverviewSleepDuration(detailMinutes)) {
    return {
      ...detail,
      chartData: Array.isArray(detail.chartData) ? analysis.chartData : detail.chartData
    };
  }
  return {
    ...detail,
    sleepDuration: getOverviewSleepDurationMinutes(),
    chartData: Array.isArray(detail.chartData) ? analysis.chartData : detail.chartData
  };
});

const displaySleepSegmentObj = computed(() => {
  const segment = sleepSegmentObj.value || {};
  const analysis = mainSleepAnalysis.value;
  return {
    ...segment,
    endTime: analysis.endTime || segment.endTime,
    chartData: analysis.chartDataSection.length ? analysis.chartDataSection : segment.chartData,
    chartDataSection: analysis.chartDataSection.length ? analysis.chartDataSection : segment.chartDataSection
  };
});

const getDisplayMetricNumber = (value: unknown) => {
  if (value == null || value === '') return null;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const formatIntegerDisplayMetric = (value: unknown, fallback = '00') => {
  const numeric = getDisplayMetricNumber(value);
  return numeric ? String(Math.round(numeric)) : fallback;
};

const formatIntegerRangeDisplayMetric = (value: unknown, fallback = '00') => {
  if (value == null || value === '') return fallback;
  const text = String(value);
  if (!/\d/.test(text)) return fallback;
  return text.replace(/-?\d+(?:\.\d+)?/g, (matched) => {
    const numeric = Number(matched);
    return Number.isFinite(numeric) ? String(Math.round(numeric)) : matched;
  });
};

const formatTemperatureDisplayMetric = (value: unknown, fallback = '00') => {
  const numeric = getDisplayMetricNumber(value);
  return numeric ? `${numeric.toFixed(1)}°C` : fallback;
};

const displayHeartRateObj = computed(() => ({
  ...(heartRateObj.value || {}),
  avgValue: formatIntegerDisplayMetric((heartRateObj.value as any)?.avgValue),
  maxValue: formatIntegerDisplayMetric((heartRateObj.value as any)?.maxValue)
} as heartRateDetail));

const displayOxyGenObj = computed(() => ({
  ...(oxyGenObj.value || {}),
  avgValue: formatIntegerDisplayMetric((oxyGenObj.value as any)?.avgValue),
  avgValueRange: formatIntegerRangeDisplayMetric((oxyGenObj.value as any)?.avgValueRange)
} as heartRateDetail));

const displayHrvObj = computed(() => ({
  ...(hrvObj.value || {}),
  avgValue: formatIntegerDisplayMetric((hrvObj.value as any)?.avgValue)
} as heartRateDetail));

const displayTemperatureObj = computed(() => ({
  ...(temperatureObj.value || {}),
  avgValue: formatTemperatureDisplayMetric((temperatureObj.value as any)?.avgValue),
  baseValue: getDisplayMetricNumber((temperatureObj.value as any)?.baseValue)
    ? formatTemperatureDisplayMetric((temperatureObj.value as any)?.baseValue)
    : (temperatureObj.value as any)?.baseValue,
  diffValue: getDisplayMetricNumber((temperatureObj.value as any)?.diffValue)
    ? formatTemperatureDisplayMetric((temperatureObj.value as any)?.diffValue)
    : (temperatureObj.value as any)?.diffValue
} as heartRateDetail));

const getSleepPayloadObject = (response: unknown) => {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const root = response as Record<string, any>;
  const payload = root.data ?? root.result ?? root;
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, any>) : root;
};

const summarizeSleepPageResponse = (response: unknown) => {
  const payload = getSleepPayloadObject(response);
  const payloadArray = Array.isArray(response)
    ? response
    : Array.isArray(payload?.list)
      ? payload.list
      : Array.isArray(payload?.records)
        ? payload.records
        : Array.isArray(payload?.data)
          ? payload.data
          : null;
  return {
    hasResponse: response !== null && response !== undefined,
    rootType: Array.isArray(response) ? 'array' : typeof response,
    payloadKeys: payload ? Object.keys(payload).slice(0, 18) : [],
    itemCount: payloadArray?.length,
    duration: payload?.sleepDuration ?? payload?.duration ?? payload?.sleepMinutes ?? payload?.sleepTime,
    score: payload?.sleepScore ?? payload?.healthScore,
    startTime: payload?.startTime,
    endTime: payload?.endTime,
    chartDataCount: Array.isArray(payload?.chartData) ? payload.chartData.length : undefined,
    chartDataHead: Array.isArray(payload?.chartData) ? payload.chartData.slice(0, 5) : undefined,
    chartDataTail: Array.isArray(payload?.chartData) ? payload.chartData.slice(-8) : undefined,
    chartDataSection: Array.isArray(payload?.chartDataSection) ? payload.chartDataSection.slice(0, 8) : undefined,
    sample: payloadArray?.slice(0, 2)
  };
};

const getObjectValueByKeys = (source: Record<string, any> | null | undefined, keys: string[]) => {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const getFirstArrayByKeys = (source: any, keys: string[]) => {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
};

const getSleepMetricChartArray = (response: unknown) => {
  if (Array.isArray(response)) return response;
  const root = response as Record<string, any>;
  const payload = getSleepPayloadObject(response);
  const candidates = [
    root,
    root?.data,
    root?.result,
    payload,
    payload?.data,
    payload?.result
  ];
  for (const candidate of candidates) {
    const chartData = getFirstArrayByKeys(candidate, ['chartData', 'list', 'records', 'items', 'points', 'data']);
    if (chartData) return chartData;
  }
  return [];
};

const normalizeSleepMetricPoint = (item: any, index: number, valueKeys: string[]) => {
  if (!item || typeof item !== 'object') {
    return { time: `${index}`, value: item };
  }
  const time = getObjectValueByKeys(item, [
    'time',
    'recordTime',
    'record_time',
    'collectTime',
    'collect_time',
    'createTime',
    'create_time',
    'dateTime',
    'datetime',
    'timestamp',
    'x',
    'name'
  ]);
  const value = getObjectValueByKeys(item, valueKeys.concat(['value', 'y', 'data']));
  return {
    ...item,
    time: time ?? item.time ?? '',
    value: value ?? item.value ?? ''
  };
};

const normalizeSleepMetricDetail = (response: unknown, valueKeys: string[]) => {
  const payload = getSleepPayloadObject(response) || {};
  const chartData = getSleepMetricChartArray(response).map((item, index) => normalizeSleepMetricPoint(item, index, valueKeys));
  return {
    ...(payload as Record<string, any>),
    chartData
  } as heartRateDetail;
};

const appendSleepPageDiagnosticLog = (event: string, details: Record<string, unknown>) => {
  appendRingDiagnosticLog('SLEEP PAGE', event, {
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    ...details
  });
};

const today = ref(new Date());
const yesterday = ref(getYesterday(today.value));
const beforeYesterday = ref(getBeforeYesterday(today.value));

// 计算日期信息（星期+日）
const yesterdayInfo = ref(getDateInfo(yesterday.value));
const beforeYesterdayInfo = ref(getDateInfo(beforeYesterday.value));

// 日期列表数据
const dateList = ref([
  { date: beforeYesterday.value, info: beforeYesterdayInfo.value, label: 'beforeYesterday' },
  { date: yesterday.value, info: yesterdayInfo.value, label: 'yesterday' },
  { date: today.value, info: { week: '今天', day: '' }, label: 'today' }
]);

const calendar = ref<any>(null);
// 添加是否已选择日期的状态
const hasSelectedDate = ref(false);
// 修改选择的日期信息结构，添加monthDay字段
const selectedDateInfo = ref({
  year: today.value.getFullYear().toString(),
  monthDay: `${(today.value.getMonth() + 1).toString().padStart(2, '0')}-${today.value.getDate().toString().padStart(2, '0')}`
});

// 当前选中的日期索引（0:前天，1:昨天，2:今天）
const selectedDayIndex = ref(2);
const getCurrentHistoryDate = (currentDate = new Date()) => formatLocalDate(currentDate);
const querySleepPage = <T>(endpoint: string, currentDate: Date, query: () => Promise<T>) =>
  ringBleBridge.queryHistoryPage({
    page: 'sleepPage',
    date: getCurrentHistoryDate(currentDate),
    endpoint,
    query
  });

let sleepPageLoadId = 0;
const isCurrentSleepPageLoad = (loadId?: number) => loadId == null || loadId === sleepPageLoadId;

const runSleepLoadTask = async (endpoint: string, currentDate: Date, task: () => Promise<unknown>) => {
  const startedAt = Date.now();
  appendSleepPageDiagnosticLog('sleep-page-endpoint-start', {
    endpoint,
    date: formatLocalDate(currentDate)
  });
  try {
    await task();
    appendSleepPageDiagnosticLog('sleep-page-endpoint-timing', {
      endpoint,
      date: formatLocalDate(currentDate),
      elapsedMs: Date.now() - startedAt,
      ok: true
    });
  } catch (error) {
    appendSleepPageDiagnosticLog('sleep-page-endpoint-timing', {
      endpoint,
      date: formatLocalDate(currentDate),
      elapsedMs: Date.now() - startedAt,
      ok: false,
      error: String((error as any)?.message || (error as any)?.errMsg || error || '')
    });
    throw error;
  }
};

const settleSleepTasks = async (
  tasks: Array<{ endpoint: string; run: () => Promise<unknown> }>,
  currentDate: Date,
  phase: 'critical' | 'secondary'
) => {
  const startedAt = Date.now();
  const results = await Promise.allSettled(tasks.map((task) => runSleepLoadTask(task.endpoint, currentDate, task.run)));
  const failed = results
    .map((result, index) =>
      result.status === 'rejected'
        ? {
            endpoint: tasks[index].endpoint,
            error: String((result.reason as any)?.message || (result.reason as any)?.errMsg || result.reason || '')
          }
        : null
    )
    .filter(Boolean);

  appendSleepPageDiagnosticLog('sleep-page-load-phase-done', {
    date: formatLocalDate(currentDate),
    phase,
    elapsedMs: Date.now() - startedAt,
    endpointCount: tasks.length,
    failedCount: failed.length,
    failed
  });

  if (failed.length > 0) {
    appendSleepPageDiagnosticLog('sleep-page-load-partial-failed', {
      date: formatLocalDate(currentDate),
      phase,
      failed
    });
  }
};

const loadSleepPageData = async (currentDate = new Date(), options: { waitSecondary?: boolean; trigger?: string } = {}) => {
  const loadId = ++sleepPageLoadId;
  const startedAt = Date.now();
  const date = formatLocalDate(currentDate);
  appendSleepPageDiagnosticLog('sleep-page-load-start', {
    date,
    trigger: options.trigger || 'unknown',
    loadId
  });

  const criticalTasks = [
    { endpoint: 'sleep-detail', run: () => getSleepDetailInfo(currentDate, loadId) },
    { endpoint: 'sleep-segment', run: () => getSleepSegmentInfo(currentDate, loadId) },
    { endpoint: 'sleep-overview', run: () => getSleepOverviewData(currentDate, loadId) }
  ];
  const secondaryTasks = [
    { endpoint: 'sleep-heart-rate', run: () => getRatDetail(currentDate, loadId) },
    { endpoint: 'sleep-hrv', run: () => getHrvDetailData(currentDate, loadId) },
    { endpoint: 'sleep-blood-oxygen', run: () => getOxyGenDetail(currentDate, loadId) },
    { endpoint: 'sleep-nap', run: () => getSleepNapList(currentDate, loadId) },
    { endpoint: 'sleep-summary', run: () => getsleepSummaryData(currentDate, loadId) }
  ];
  if (!isCurrentRwRing()) {
    secondaryTasks.splice(3, 0, { endpoint: 'sleep-temperature', run: () => getTemperatureDetail(currentDate, loadId) });
  } else {
    temperatureObj.value = undefined;
    appendSleepPageDiagnosticLog('sleep-page-temperature-skip', {
      reason: 'rw-device-no-temperature',
      date
    });
  }

  await settleSleepTasks(criticalTasks, currentDate, 'critical');

  const secondaryRun = settleSleepTasks(secondaryTasks, currentDate, 'secondary').finally(() => {
    appendSleepPageDiagnosticLog('sleep-page-load-done', {
      date,
      trigger: options.trigger || 'unknown',
      loadId,
      waitSecondary: Boolean(options.waitSecondary),
      elapsedMs: Date.now() - startedAt
    });
  });

  if (options.waitSecondary) {
    await secondaryRun;
  } else {
    void secondaryRun;
  }
};

// 点击日期处理函数
const handleDateClick = async (index: number) => {
  selectedDayIndex.value = index;
  const currentDate = dateList.value[index].date;
  try {
    await loadSleepPageData(currentDate, { trigger: 'date-click' });
  } catch (error) {
    appendSleepPageDiagnosticLog('sleep-page-load-failed', {
      date: formatLocalDate(currentDate),
      error: String((error as any)?.message || (error as any)?.errMsg || error || '')
    });
  }
};

const receiveCardConfig = (config: { listDatal: string[]; visibleCards: string[]; form: any }) => {
  listData.value = config.listDatal;
  visibleCards.value = config.visibleCards;
  cardForm.value = config.form;
};
// 睡眠详情
const getSleepDetailInfo = async (currentDate = new Date(), loadId?: number) => {
  const isoDate = formatLocalDate(currentDate);
  // 计算offset：如果是自定义日期（selectedDayIndex为3），计算与今天的差值
  let offset = 0;
  if (selectedDayIndex.value === 3) {
    const today = new Date();
    // 今天减去选择日期，得到正的天数差值
    const diffTime = today.getTime() - currentDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    offset = -diffDays;
  } else {
    offset = selectedDayIndex.value - 2;
  }
  // const index = selectedDayIndex.value - 2;
  const res = await querySleepPage('sleep-detail', currentDate, (requestConfig) => getSleepDetail({
    date: isoDate,
    type: 'day',
    offset
  }, requestConfig));
  appendSleepPageDiagnosticLog('sleep-page-query-result', {
    endpoint: 'sleep-detail',
    date: isoDate,
    response: summarizeSleepPageResponse(res)
  });
  if (res && isCurrentSleepPageLoad(loadId)) {
    sleepDetailObj.value = res;
  }
};
// 睡眠区间
const getSleepSegmentInfo = async (currentDate = new Date(), loadId?: number) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-segment', currentDate, (requestConfig) => getSleepSegment({ date: isoDate }, requestConfig));
  appendSleepPageDiagnosticLog('sleep-page-query-result', {
    endpoint: 'sleep-segment',
    date: isoDate,
    response: summarizeSleepPageResponse(res)
  });
  if (res && isCurrentSleepPageLoad(loadId)) {
    sleepSegmentObj.value = res;
  }
};
// 睡眠总览-睡眠评分
const getSleepOverviewData = async (currentDate = new Date(), loadId?: number) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-overview', currentDate, (requestConfig) => getSleepOverview({ date: isoDate }, requestConfig));
  appendSleepPageDiagnosticLog('sleep-page-query-result', {
    endpoint: 'sleep-overview',
    date: isoDate,
    response: summarizeSleepPageResponse(res)
  });
  if (res && isCurrentSleepPageLoad(loadId)) {
    sleepOverviewObj.value = res;
  }
};
// 获取心率详情
const getRatDetail = async (currentDate = new Date(), loadId?: number) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-heart-rate', currentDate, (requestConfig) => getSleepHeartRateDetail({
    date: isoDate
  }, requestConfig));
  const normalized = normalizeSleepMetricDetail(res, ['heartRate', 'heart_rate', 'heartRateValue', 'heart_rate_value', 'bpm']);
  appendSleepPageDiagnosticLog('sleep-page-query-result', {
    endpoint: 'sleep-heart-rate',
    date: isoDate,
    response: summarizeSleepPageResponse(res),
    normalizedChartDataCount: normalized.chartData?.length,
    normalizedChartDataHead: normalized.chartData?.slice?.(0, 5)
  });
  if (res && isCurrentSleepPageLoad(loadId)) {
    heartRateObj.value = normalized;
  }
};
// 获取心率变异性详情
const getHrvDetailData = async (currentDate = new Date(), loadId?: number) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-hrv', currentDate, (requestConfig) => getSleepHrvDetail({
    date: isoDate
  }, requestConfig));
  const normalized = normalizeSleepMetricDetail(res, ['hrv', 'hrvValue', 'hrv_value', 'heartRateVariability', 'heart_rate_variability']);
  appendSleepPageDiagnosticLog('sleep-page-query-result', {
    endpoint: 'sleep-hrv',
    date: isoDate,
    response: summarizeSleepPageResponse(res),
    normalizedChartDataCount: normalized.chartData?.length,
    normalizedChartDataHead: normalized.chartData?.slice?.(0, 5)
  });
  if (res && isCurrentSleepPageLoad(loadId)) {
    hrvObj.value = normalized;
  }
};
// 获取血氧详情
const getOxyGenDetail = async (currentDate = new Date(), loadId?: number) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-blood-oxygen', currentDate, (requestConfig) => getSleepBloodOxygenDetail({
    date: isoDate
  }, requestConfig));
  const normalized = normalizeSleepMetricDetail(res, ['bloodOxygen', 'blood_oxygen', 'bloodOxygenValue', 'blood_oxygen_value', 'oxygen', 'spo2', 'SpO2']);
  appendSleepPageDiagnosticLog('sleep-page-query-result', {
    endpoint: 'sleep-blood-oxygen',
    date: isoDate,
    response: summarizeSleepPageResponse(res),
    normalizedChartDataCount: normalized.chartData?.length,
    normalizedChartDataHead: normalized.chartData?.slice?.(0, 5)
  });
  if (res && isCurrentSleepPageLoad(loadId)) {
    oxyGenObj.value = normalized;
  }
};

// 获取温度详情
const getTemperatureDetail = async (currentDate = new Date(), loadId?: number) => {
  if (isCurrentRwRing()) {
    if (isCurrentSleepPageLoad(loadId)) temperatureObj.value = undefined;
    appendSleepPageDiagnosticLog('sleep-page-temperature-skip', {
      reason: 'rw-device-no-temperature',
      date: formatLocalDate(currentDate)
    });
    return;
  }
  const isoDate = formatLocalDate(currentDate);
  let offset = 0;
  if (selectedDayIndex.value === 3) {
    const today = new Date();
    // 今天减去选择日期，得到正的天数差值
    const diffTime = today.getTime() - currentDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    offset = -diffDays;
  } else {
    offset = selectedDayIndex.value - 2;
  }
  // const index = selectedDayIndex.value - 2;
  const res = await querySleepPage('sleep-temperature', currentDate, (requestConfig) => getBodyTemperatureDetail({
    date: isoDate,
    type: 'day',
    offset
  }, requestConfig));
  if (res && isCurrentSleepPageLoad(loadId)) {
    temperatureObj.value = res;
  }
};
// 获取小睡列表
const getSleepNapList = async (currentDate = new Date(), loadId?: number) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-nap', currentDate, (requestConfig) => getSleepNap({
    date: isoDate
  }, requestConfig));
  appendSleepPageDiagnosticLog('sleep-page-query-result', {
    endpoint: 'sleep-nap',
    date: isoDate,
    response: summarizeSleepPageResponse(res)
  });
  if (res && isCurrentSleepPageLoad(loadId)) {
    sleepNapList.value = res;
  }
};
// 获取睡眠活动总结
const getsleepSummaryData = async (currentDate = new Date(), loadId?: number) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-summary', currentDate, (requestConfig) => getsleepSummary({
    date: isoDate
  }, requestConfig));
  appendSleepPageDiagnosticLog('sleep-page-query-result', {
    endpoint: 'sleep-summary',
    date: isoDate,
    response: summarizeSleepPageResponse(res)
  });
  if (res && isCurrentSleepPageLoad(loadId)) {
    sleepSummaryObj.value = res;
  }
};
const openTimePicker = () => {
  calendar.value.open();
};
const confirm = async (date: any) => {
  // 处理选择的日期，date可能是数组或单个日期对象
  let selectedDate;
  selectedDate = new Date(date.fulldate);
  // 更新选择的日期信息，使用月-日格式
  const month = (selectedDate.getMonth() + 1).toString().padStart(2, '0');
  const day = selectedDate.getDate().toString().padStart(2, '0');

  selectedDateInfo.value = {
    year: selectedDate.getFullYear().toString(),
    monthDay: `${month}-${day}`
  };

  // 标记为已选择日期
  hasSelectedDate.value = true;
  selectedDayIndex.value = 3;
  const currentDate = selectedDate;

  try {
    await loadSleepPageData(currentDate, { trigger: 'calendar-confirm' });
  } catch (error) {
    appendSleepPageDiagnosticLog('sleep-page-load-failed', {
      date: formatLocalDate(currentDate),
      error: String((error as any)?.message || (error as any)?.errMsg || error || '')
    });
  }
};
const jumpEdit = () => {
  uni.$uv.route('/homeDetail/sleepPageEdit/sleepPageEdit', { cardForm: JSON.stringify(cardForm.value), visibleCards: JSON.stringify(visibleCards.value) });
};
const leftClick = (): void => {
  uni.navigateBack();
};
onLoad(async (options) => {
  // 统一转换为数字并设置默认值，普通入口无参数时默认加载今天。
  const rawDayIndex = options?.selectedDayIndex;
  const parsedDayIndex = rawDayIndex !== undefined && rawDayIndex !== '' ? Number(rawDayIndex) : 2;
  const dayIndex = Number.isFinite(parsedDayIndex) ? parsedDayIndex : 2;
  selectedDayIndex.value = dayIndex;

  if (dayIndex !== 3) {
    await handleDateClick(selectedDayIndex.value);
  } else {
    // 核心修改：仅当 selectedDate 存在时才调用 confirm
    if (options?.selectedDate) {
      // 进一步确保格式化后的日期有效（可选，增强健壮性）
      const formattedDate = uni.$uv.timeFormat(options.selectedDate, 'yyyy-mm-dd');
      if (formattedDate && formattedDate !== 'NaN-NaN-NaN') {
        await confirm({ fulldate: formattedDate });
        return;
      }
    }
    selectedDayIndex.value = 2;
    await handleDateClick(2);
  }
});
onShow(async () => {});
// 下拉刷新事件处理器
onPullDownRefresh(async () => {
  try {
    const currentDate = selectedDayIndex.value === 3 ? new Date(selectedDateInfo.value.year + '-' + selectedDateInfo.value.monthDay) : dateList.value[selectedDayIndex.value].date;
    await loadSleepPageData(currentDate, { waitSecondary: true, trigger: 'pull-down-refresh' });
  } catch (error) {
    appendSleepPageDiagnosticLog('sleep-page-refresh-failed', {
      error: String((error as any)?.message || (error as any)?.errMsg || error || '')
    });
  } finally {
    uni.stopPullDownRefresh();
  }
});
onPageScroll((e) => {
  scrollTop.value = e.scrollTop;
});
defineExpose({
  receiveCardConfig
});
</script>
<template>
  <page-meta :page-style="fixedPageStyle"></page-meta>

  <view class="relative p-30" style="box-sizing: border-box">
    <uv-navbar @leftClick="leftClick" placeholder leftIcon="arrow-left" title="睡眠" :bgColor="scrollTop > 0 ? '#ffffff' : 'rgba(255, 255, 255, 0)'"></uv-navbar>
    <view class="bgcWrapper"></view>
    <view class="pt-30 pr-30 pl-30 relative mb-30" style="z-index: 1; box-sizing: border-box">
      <view class="calendar-week flex">
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
    </view>
    <uni-calendar ref="calendar" :insert="false" @confirm="confirm" />
    <view v-for="cardId in visibleListData" :key="cardId">
      <sleepTime v-if="cardId === 'subjectiveSleepScore'" :sleepDetailObj="displaySleepDetailObj" :sleepSegmentObj="displaySleepSegmentObj">
        <DetailInfo id="sleep_duration" v-model:isPopupActive="isPopupActive" size="small" style="margin-left: 6rpx"></DetailInfo>
      </sleepTime>
      <sleepRage v-else-if="cardId === 'sleepInterval'" :sleepSegmentObj="displaySleepSegmentObj">
        <DetailInfo id="sleep_stages" v-model:isPopupActive="isPopupActive" style="margin-left: 2rpx"></DetailInfo>
      </sleepRage>
      <sleepScore v-else-if="cardId === 'sleepScore'" :sleepOverviewObj="sleepOverviewObj" :sleepSegmentObj="displaySleepSegmentObj">
        <DetailInfo id="sleep_score" v-model:isPopupActive="isPopupActive" style="margin-left: 2rpx"></DetailInfo>
      </sleepScore>
      <HeartRate v-else-if="cardId === 'heartRate'" :heartRateData="displayHeartRateObj" :isHeartTate="false" :sleepSegmentObj="displaySleepSegmentObj">
        <DetailInfo id="heart_rate" v-model:isPopupActive="isPopupActive" style="margin-left: 6rpx"></DetailInfo>
      </HeartRate>
      <oxyGen v-else-if="cardId === 'bloodOxygenSaturation'" :oxyGenData="displayOxyGenObj" :isHeartTate="false" :sleepSegmentObj="displaySleepSegmentObj">
        <DetailInfo id="blood_oxygen_saturation" v-model:isPopupActive="isPopupActive" style="margin-left: 6rpx"></DetailInfo>
      </oxyGen>
      <heartRateVariability v-else-if="cardId === 'heartRateVariability'" :hrvData="displayHrvObj" :isHeartTate="false" :sleepSegmentObj="displaySleepSegmentObj">
        <DetailInfo id="heart_rate_variability" v-model:isPopupActive="isPopupActive" style="margin-left: 6rpx"></DetailInfo>
      </heartRateVariability>
      <temperature v-else-if="cardId === 'skinTemperature'" :temperatureData="displayTemperatureObj" :isHeartTate="false" />
      <sleepNap v-else-if="cardId === 'napRecord'" @refresh="getSleepNapList" :sleepNapList="sleepNapList" />
      <eventSummary v-else-if="cardId === 'activitySummary'" :sleepSummaryObj="sleepSummaryObj" />
    </view>
    <view @tap="jumpEdit" class="bg-white r-50 flex ai-center jc-center p-30">
      <view class="flex ai-center jc-center">
        <uv-image src="/static/images/homeDetail/editCardIcon.png" width="40rpx" height="40rpx"></uv-image>
        <text class="ml-10 fs-36">编辑卡片</text>
      </view>
    </view>
    <uv-safe-bottom></uv-safe-bottom>
  </view>
</template>
<style lang="scss" scoped>
.bgcWrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 30vh;
  background: linear-gradient(to bottom, #aeaaf5, #f1f3f6);
  z-index: -1;
}
.calendar-day {
  width: 128rpx;
  height: 128rpx;
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
</style>
