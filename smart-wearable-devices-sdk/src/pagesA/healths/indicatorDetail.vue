<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import {
  getActivityIntensityDetail,
  getActivityRegularityDetail,
  getSittingRiskDetail,
  getSleepActivationDetail,
  getSleepPreparationDetail,
  getSleepRecoveryDetail,
  getSleepRhythmDetail
} from '@/common/api/heatlthSummary';
import { formatBleErrorMessage } from '@/utils/bleError';
import { normalizeHealthText } from '@/utils/healthText';

type IndicatorType =
  | 'sleepPrep'
  | 'sleepRhythm'
  | 'sleepRecovery'
  | 'wakeUpBoost'
  | 'sedentaryRisk'
  | 'activityIntensity'
  | 'exerciseRegularity';

type DetailConfig = {
  title: string;
  subtitle: string;
  fetcher: () => Promise<Record<string, any>>;
  summary: (data: Record<string, any>) => Array<{ label: string; value: unknown }>;
  chartKey?: string;
  chartValueKey?: string;
};

const detailType = ref<IndicatorType>('sleepPrep');
const pageTitle = ref('健康详情');
const loading = ref(false);
const detailData = ref<Record<string, any> | null>(null);

const normalizeType = (type?: string): IndicatorType => {
  const knownTypes: IndicatorType[] = [
    'sleepPrep',
    'sleepRhythm',
    'sleepRecovery',
    'wakeUpBoost',
    'sedentaryRisk',
    'activityIntensity',
    'exerciseRegularity'
  ];
  return knownTypes.includes(type as IndicatorType) ? (type as IndicatorType) : 'sleepPrep';
};

const detailConfigs: Record<IndicatorType, DetailConfig> = {
  sleepPrep: {
    title: '睡前准备',
    subtitle: '结合睡前心率、HRV 和放松状态评估入睡准备情况',
    fetcher: () => getSleepPreparationDetail(),
    chartKey: 'trendChart',
    chartValueKey: 'value',
    summary: (data) => [
      { label: '心率变化', value: formatChange(data.heartRateChange) },
      { label: 'HRV变化', value: formatChange(data.hrvChange) }
    ]
  },
  sleepRhythm: {
    title: '睡眠节律',
    subtitle: '观察近期入睡规律和睡眠节奏是否稳定',
    fetcher: () => getSleepRhythmDetail(),
    chartKey: 'regularityChart',
    chartValueKey: 'avgSleepTime',
    summary: (data) => [{ label: '趋势', value: data.overview?.trend }]
  },
  sleepRecovery: {
    title: '睡眠过程恢复',
    subtitle: '结合睡眠时长与恢复性睡眠占比评估夜间恢复',
    fetcher: () => getSleepRecoveryDetail(),
    chartKey: 'durationChart',
    chartValueKey: 'hours',
    summary: (data) => [
      { label: '平均睡眠时长', value: data.avgDuration },
      { label: '睡眠时长等级', value: data.durationLevel },
      { label: '恢复性睡眠占比', value: formatPercent(data.recoveryRatio) }
    ]
  },
  wakeUpBoost: {
    title: '睡眠激活',
    subtitle: '评估醒后状态与清晨激活情况',
    fetcher: () => getSleepActivationDetail(),
    chartKey: 'trendChart',
    chartValueKey: 'score',
    summary: (data) => [{ label: '趋势', value: data.overview?.trend }]
  },
  sedentaryRisk: {
    title: '久坐风险',
    subtitle: '结合步数、活动时长和站立时长评估久坐风险',
    fetcher: () => getSittingRiskDetail(),
    chartKey: 'stepChart',
    chartValueKey: 'steps',
    summary: (data) => [
      { label: '平均步数', value: data.avgSteps },
      { label: '步数等级', value: data.stepsLevel },
      { label: '活动水平', value: data.activityLevel },
      { label: '活动时长', value: formatMinute(data.activeMinutes) },
      { label: '站立时长', value: formatHour(data.standingHours) }
    ]
  },
  activityIntensity: {
    title: '活动强度',
    subtitle: '查看本周中高强度活动总量与负荷状态',
    fetcher: () => getActivityIntensityDetail(),
    chartKey: 'durationChart',
    chartValueKey: 'minutes',
    summary: (data) => [
      { label: '中高强度总时长', value: formatMinute(data.totalMinutes) },
      { label: '活动强度等级', value: data.intensityLevel }
    ]
  },
  exerciseRegularity: {
    title: '运动规律性',
    subtitle: '观察运动负荷是否稳定、每周活跃天数是否达标',
    fetcher: () => getActivityRegularityDetail(),
    chartKey: 'balanceChart',
    chartValueKey: 'index',
    summary: (data) => [
      { label: '负荷平均指数', value: data.balanceIndex },
      { label: '负荷等级', value: data.balanceLevel },
      { label: '中高强度活动天数', value: formatDay(data.midHighDays) }
    ]
  }
};

const currentConfig = computed(() => detailConfigs[detailType.value]);
const overview = computed(() => detailData.value?.overview || {});
const summaryItems = computed(() => currentConfig.value.summary(detailData.value || {}).filter((item) => hasValue(item.value)));
const chartItems = computed(() => {
  const key = currentConfig.value.chartKey;
  if (!key || !Array.isArray(detailData.value?.[key])) return [];
  return detailData.value[key].map((item: Record<string, any>) => ({
    label: item.weekLabel || item.label || item.date || '--',
    value: item[currentConfig.value.chartValueKey || 'score'] ?? item.score ?? item.value ?? item.level ?? '--',
    level: normalizeHealthText(item.level, '')
  }));
});

const displayTitle = computed(() => pageTitle.value || currentConfig.value.title);

const hasValue = (value: unknown) => value !== undefined && value !== null && value !== '';
const formatValue = (value: unknown) => normalizeHealthText(value, '--');
const isNumericText = (value: unknown) => /^[-+]?\d+(?:\.\d+)?$/.test(String(value).trim());
const formatValueWithUnit = (value: unknown, unit: string, unitPattern: RegExp) => {
  if (!hasValue(value)) return '--';
  const text = String(value).trim();
  if (unitPattern.test(text)) return text;
  if (isNumericText(text)) return `${text}${unit}`;
  return normalizeHealthText(text, '--');
};
const formatPercent = (value: unknown) => {
  return formatValueWithUnit(value, '%', /%/);
};
const formatMinute = (value: unknown) => {
  return formatValueWithUnit(value, '分钟', /分钟/);
};
const formatHour = (value: unknown) => {
  return formatValueWithUnit(value, '小时', /小时/);
};
const formatDay = (value: unknown) => {
  return formatValueWithUnit(value, '天', /天/);
};
const formatDirection = (value: unknown) => {
  if (!hasValue(value)) return '';
  const text = String(value).trim();
  if (/^[+\-↑↓]/.test(text)) return text;
  return normalizeHealthText(text, '');
};
const formatChange = (value: any) => {
  if (!value || typeof value !== 'object') return '--';
  const current = hasValue(value.currentValue) ? `${formatDirection(value.currentDirection)}${value.currentValue}` : '';
  const avg = hasValue(value.avgValue) ? `近均${formatDirection(value.avgDirection)}${value.avgValue}` : '';
  return [current, avg].filter(Boolean).join(' / ') || '--';
};

const loadDetail = async () => {
  loading.value = true;
  try {
    detailData.value = await currentConfig.value.fetcher();
  } catch (error) {
    detailData.value = null;
    uni.showToast({
      title: formatBleErrorMessage(error, '详情加载失败，请稍后重试'),
      icon: 'none'
    });
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
};

const leftClick = () => {
  uni.navigateBack();
};

onLoad((options = {}) => {
  detailType.value = normalizeType(String(options.type || ''));
  pageTitle.value = String(options.title || detailConfigs[detailType.value].title);
  void loadDetail();
});

onPullDownRefresh(() => {
  void loadDetail();
});
</script>

<template>
  <view class="page">
    <uv-navbar placeholder leftIcon="arrow-left" :title="displayTitle" bgColor="#f1f3f6" @leftClick="leftClick"></uv-navbar>

    <view class="content">
      <view class="hero">
        <view>
          <view class="hero-title">{{ currentConfig.title }}</view>
          <view class="hero-subtitle">{{ currentConfig.subtitle }}</view>
        </view>
        <view class="level">{{ formatValue(overview.level) }}</view>
      </view>

      <view class="overview">
        <view class="overview-item">
          <text class="label">日期范围</text>
          <text class="value">{{ formatValue(overview.dateRange) }}</text>
        </view>
        <view class="overview-item">
          <text class="label">趋势</text>
          <text class="value">{{ formatValue(overview.trend) }}</text>
        </view>
        <view class="overview-item">
          <text class="label">变化值</text>
          <text class="value">{{ formatValue(overview.trendValue) }}</text>
        </view>
      </view>

      <view class="section" v-if="summaryItems.length > 0">
        <view class="section-title">关键指标</view>
        <view class="metric-list">
          <view class="metric-row" v-for="item in summaryItems" :key="item.label">
            <text class="metric-label">{{ item.label }}</text>
            <text class="metric-value">{{ formatValue(item.value) }}</text>
          </view>
        </view>
      </view>

      <view class="section" v-if="chartItems.length > 0">
        <view class="section-title">近期趋势</view>
        <view class="trend-list">
          <view class="trend-row" v-for="item in chartItems" :key="item.label">
            <text class="trend-label">{{ item.label }}</text>
            <text class="trend-value">{{ formatValue(item.value) }}</text>
            <text class="trend-level" v-if="item.level">{{ item.level }}</text>
          </view>
        </view>
      </view>

      <view v-if="!loading && !detailData" class="empty">暂无详情数据</view>
      <view v-if="loading" class="empty">加载中...</view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f1f3f6;
}

.content {
  padding: 28rpx;
  box-sizing: border-box;
}

.hero,
.overview,
.section,
.empty {
  border-radius: 8rpx;
  background: #ffffff;
}

.hero {
  display: flex;
  justify-content: space-between;
  gap: 24rpx;
  padding: 34rpx;
}

.hero-title {
  color: #1d2939;
  font-size: 40rpx;
  font-weight: 800;
}

.hero-subtitle {
  margin-top: 14rpx;
  color: #667085;
  font-size: 26rpx;
  line-height: 1.5;
}

.level {
  flex: 0 0 auto;
  align-self: flex-start;
  padding: 12rpx 20rpx;
  border-radius: 999rpx;
  background: #eef4ff;
  color: #2e70fc;
  font-size: 24rpx;
  font-weight: 700;
}

.overview,
.section,
.empty {
  margin-top: 22rpx;
  padding: 28rpx;
}

.overview-item,
.metric-row,
.trend-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  min-height: 72rpx;
  border-bottom: 1rpx solid #eef2f6;
}

.overview-item:last-child,
.metric-row:last-child,
.trend-row:last-child {
  border-bottom: 0;
}

.label,
.metric-label,
.trend-label,
.trend-level {
  color: #667085;
  font-size: 26rpx;
}

.value,
.metric-value,
.trend-value {
  color: #1d2939;
  font-size: 28rpx;
  font-weight: 700;
  text-align: right;
}

.section-title {
  margin-bottom: 12rpx;
  color: #1d2939;
  font-size: 32rpx;
  font-weight: 800;
}

.trend-level {
  flex: 0 0 auto;
}

.empty {
  color: #98a2b3;
  font-size: 28rpx;
  text-align: center;
}
</style>
