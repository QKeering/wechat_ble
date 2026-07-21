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

const isSleepStagePoint = (point: any) => {
  const value = String(point?.value ?? '').trim();
  return value === '2' || value === '3' || value === '4' || ['深睡', '浅睡', '快速眼动'].includes(value);
};

const getMainSleepEndTimeFromDetail = (detail?: sleepDetail, segment?: sleepSegment) => {
  const chartData = Array.isArray(detail?.chartData) ? detail.chartData : [];
  if (!chartData.length) return '';

  const segmentStart = parseClockMinutes(segment?.startTime);
  let segmentEnd = parseClockMinutes(segment?.endTime);
  if (segmentStart != null && segmentEnd != null && segmentEnd < segmentStart) {
    segmentEnd += 1440;
  }

  let latestSleepEnd = 0;
  chartData.forEach((item: any, index: number) => {
    if (!isSleepStagePoint(item)) return;
    const start = normalizeTimelineMinutes(item?.time, segmentStart);
    if (start == null) return;
    const nextStart = normalizeTimelineMinutes(chartData[index + 1]?.time, segmentStart);
    let end = nextStart ?? segmentEnd ?? start;
    if (segmentEnd != null && end > segmentEnd) end = segmentEnd;
    if (end > start) latestSleepEnd = Math.max(latestSleepEnd, end);
  });

  if (!latestSleepEnd || (segmentStart != null && latestSleepEnd <= segmentStart)) return '';
  return formatClockMinutes(latestSleepEnd);
};

const shouldPreferOverviewSleepDuration = (detailMinutes = 0) => {
  const overviewMinutes = getOverviewSleepDurationMinutes();
  if (!overviewMinutes) return false;
  if (!detailMinutes) return true;
  return detailMinutes > MAX_MAIN_SLEEP_MINUTES || detailMinutes > overviewMinutes + MAIN_SLEEP_OVERVIEW_TOLERANCE_MINUTES;
};

const displaySleepDetailObj = computed(() => {
  const detail = sleepDetailObj.value || {};
  const detailMinutes = toPositiveNumber(detail.sleepDuration);
  if (!shouldPreferOverviewSleepDuration(detailMinutes)) return detail;
  return {
    ...detail,
    sleepDuration: getOverviewSleepDurationMinutes()
  };
});

const displaySleepSegmentObj = computed(() => {
  const segment = sleepSegmentObj.value || {};
  const overviewMinutes = getOverviewSleepDurationMinutes();
  const spanMinutes = getSleepSegmentSpanMinutes(segment);
  const startMinutes = parseClockMinutes(segment.startTime);
  const detailEndTime = getMainSleepEndTimeFromDetail(sleepDetailObj.value, segment);
  if (!overviewMinutes || startMinutes == null || !spanMinutes || spanMinutes <= overviewMinutes + MAIN_SLEEP_OVERVIEW_TOLERANCE_MINUTES) {
    return segment;
  }
  if (detailEndTime) {
    return {
      ...segment,
      endTime: detailEndTime
    };
  }
  return {
    ...segment
  };
});

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

// 点击日期处理函数
const handleDateClick = async (index: number) => {
  selectedDayIndex.value = index;
  const currentDate = dateList.value[index].date;
  try {
    await getSleepDetailInfo(currentDate);
    await getSleepSegmentInfo(currentDate);
    await getSleepOverviewData(currentDate);
    await getRatDetail(currentDate);
    await getHrvDetailData(currentDate);
    await getOxyGenDetail(currentDate);
    await getTemperatureDetail(currentDate);
    await getSleepNapList(currentDate);
    await getsleepSummaryData(currentDate);
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
const getSleepDetailInfo = async (currentDate = new Date()) => {
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
  if (res) {
    sleepDetailObj.value = res;
  }
};
// 睡眠区间
const getSleepSegmentInfo = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-segment', currentDate, (requestConfig) => getSleepSegment({ date: isoDate }, requestConfig));
  appendSleepPageDiagnosticLog('sleep-page-query-result', {
    endpoint: 'sleep-segment',
    date: isoDate,
    response: summarizeSleepPageResponse(res)
  });
  if (res) {
    sleepSegmentObj.value = res;
  }
};
// 睡眠总览-睡眠评分
const getSleepOverviewData = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-overview', currentDate, (requestConfig) => getSleepOverview({ date: isoDate }, requestConfig));
  appendSleepPageDiagnosticLog('sleep-page-query-result', {
    endpoint: 'sleep-overview',
    date: isoDate,
    response: summarizeSleepPageResponse(res)
  });
  if (res) {
    sleepOverviewObj.value = res;
  }
};
// 获取心率详情
const getRatDetail = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-heart-rate', currentDate, (requestConfig) => getSleepHeartRateDetail({
    date: isoDate
  }, requestConfig));
  if (res) {
    heartRateObj.value = res;
  }
};
// 获取心率变异性详情
const getHrvDetailData = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-hrv', currentDate, (requestConfig) => getSleepHrvDetail({
    date: isoDate
  }, requestConfig));
  if (res) {
    hrvObj.value = res;
  }
};
// 获取血氧详情
const getOxyGenDetail = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-blood-oxygen', currentDate, (requestConfig) => getSleepBloodOxygenDetail({
    date: isoDate
  }, requestConfig));
  if (res) {
    oxyGenObj.value = res;
  }
};

// 获取温度详情
const getTemperatureDetail = async (currentDate = new Date()) => {
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
  if (res) {
    temperatureObj.value = res;
  }
};
// 获取小睡列表
const getSleepNapList = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-nap', currentDate, (requestConfig) => getSleepNap({
    date: isoDate
  }, requestConfig));
  appendSleepPageDiagnosticLog('sleep-page-query-result', {
    endpoint: 'sleep-nap',
    date: isoDate,
    response: summarizeSleepPageResponse(res)
  });
  if (res) {
    sleepNapList.value = res;
  }
};
// 获取睡眠活动总结
const getsleepSummaryData = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await querySleepPage('sleep-summary', currentDate, (requestConfig) => getsleepSummary({
    date: isoDate
  }, requestConfig));
  appendSleepPageDiagnosticLog('sleep-page-query-result', {
    endpoint: 'sleep-summary',
    date: isoDate,
    response: summarizeSleepPageResponse(res)
  });
  if (res) {
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
    await getSleepDetailInfo(currentDate);
    await getSleepSegmentInfo(currentDate);
    await getSleepOverviewData(currentDate);
    await getRatDetail(currentDate);
    await getHrvDetailData(currentDate);
    await getOxyGenDetail(currentDate);
    await getTemperatureDetail(currentDate);
    await getSleepNapList(currentDate);
    await getsleepSummaryData(currentDate);
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
    await handleDateClick(selectedDayIndex.value);
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
    <view v-for="cardId in listData" :key="cardId">
      <sleepTime v-if="cardId === 'subjectiveSleepScore'" :sleepDetailObj="sleepDetailObj" :sleepSegmentObj="sleepSegmentObj">
        <DetailInfo id="sleep_duration" v-model:isPopupActive="isPopupActive" size="small" style="margin-left: 6rpx"></DetailInfo>
      </sleepTime>
      <sleepRage v-else-if="cardId === 'sleepInterval'" :sleepSegmentObj="sleepSegmentObj">
        <DetailInfo id="sleep_stages" v-model:isPopupActive="isPopupActive" style="margin-left: 2rpx"></DetailInfo>
      </sleepRage>
      <sleepScore v-else-if="cardId === 'sleepScore'" :sleepOverviewObj="sleepOverviewObj" :sleepSegmentObj="sleepSegmentObj">
        <DetailInfo id="sleep_score" v-model:isPopupActive="isPopupActive" style="margin-left: 2rpx"></DetailInfo>
      </sleepScore>
      <HeartRate v-else-if="cardId === 'heartRate'" :heartRateData="heartRateObj" :isHeartTate="false">
        <DetailInfo id="heart_rate" v-model:isPopupActive="isPopupActive" style="margin-left: 6rpx"></DetailInfo>
      </HeartRate>
      <oxyGen v-else-if="cardId === 'bloodOxygenSaturation'" :oxyGenData="oxyGenObj" :isHeartTate="false">
        <DetailInfo id="blood_oxygen_saturation" v-model:isPopupActive="isPopupActive" style="margin-left: 6rpx"></DetailInfo>
      </oxyGen>
      <heartRateVariability v-else-if="cardId === 'heartRateVariability'" :hrvData="hrvObj" :isHeartTate="false">
        <DetailInfo id="heart_rate_variability" v-model:isPopupActive="isPopupActive" style="margin-left: 6rpx"></DetailInfo>
      </heartRateVariability>
      <temperature v-else-if="cardId === 'skinTemperature'" :temperatureData="temperatureObj" :isHeartTate="false" />
      <sleepNap v-else-if="cardId === 'napRecord'" @refresh="refreshSleepNapForSelectedDate" :sleepNapList="sleepNapList" />
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
