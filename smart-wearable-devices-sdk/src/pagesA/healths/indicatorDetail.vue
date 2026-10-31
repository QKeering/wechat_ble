<script setup lang="ts">
import '@/pagesA/healths/i18n/pack';
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import { useI18n } from '@/i18n';
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
  summary: (data: Record<string, any>) => Array<{ label: string; value: unknown; trend?: string }>;
  chartKey?: string;
  chartValueKey?: string;
};

const { t } = useI18n();

const detailType = ref<IndicatorType>('sleepPrep');
const pageTitle = ref('');
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

// 配置在 computed 内随语言重建，保证切换语言后标题、说明、指标名立即刷新。
const getDetailConfig = (type: IndicatorType): DetailConfig => {
  const configs: Record<IndicatorType, DetailConfig> = {
    sleepPrep: {
      title: t('睡前准备'),
      subtitle: t('结合睡前心率、HRV 和放松状态评估入睡准备情况'),
      fetcher: () => getSleepPreparationDetail(),
      chartKey: 'trendChart',
      chartValueKey: 'value',
      summary: (data) => [
        {
          label: t('心率'),
          value: formatCurrentAndAverage(data.heartRateChange, '次/分钟'),
          trend: formatCurrentAverageTrend(data.heartRateChange, '次/分钟')
        },
        {
          label: t('HRV'),
          value: formatCurrentAndAverage(data.hrvChange, '毫秒'),
          trend: formatCurrentAverageTrend(data.hrvChange, '毫秒')
        }
      ]
    },
    sleepRhythm: {
      title: t('睡眠节律'),
      subtitle: t('观察近期入睡规律和睡眠节奏是否稳定'),
      fetcher: () => getSleepRhythmDetail(),
      chartKey: 'regularityChart',
      chartValueKey: 'avgSleepTime',
      summary: (data) => [{ label: t('趋势'), value: data.overview?.trend }]
    },
    sleepRecovery: {
      title: t('睡眠过程恢复'),
      subtitle: t('结合睡眠时长与恢复性睡眠占比评估夜间恢复'),
      fetcher: () => getSleepRecoveryDetail(),
      chartKey: 'durationChart',
      chartValueKey: 'hours',
      summary: (data) => [
        { label: t('平均睡眠时长'), value: data.avgDuration },
        { label: t('睡眠时长等级'), value: data.durationLevel },
        { label: t('恢复性睡眠占比'), value: formatPercent(data.recoveryRatio) }
      ]
    },
    wakeUpBoost: {
      title: t('睡眠激活'),
      subtitle: t('评估醒后状态与清晨激活情况'),
      fetcher: () => getSleepActivationDetail(),
      chartKey: 'trendChart',
      chartValueKey: 'score',
      summary: (data) => [{ label: t('趋势'), value: data.overview?.trend }]
    },
    sedentaryRisk: {
      title: t('久坐风险'),
      subtitle: t('结合步数和活动时长评估久坐风险'),
      fetcher: () => getSittingRiskDetail(),
      chartKey: 'stepChart',
      chartValueKey: 'steps',
      summary: (data) => [
        { label: t('平均步数'), value: data.avgSteps },
        { label: t('步数等级'), value: data.stepsLevel },
        { label: t('活动水平'), value: data.activityLevel },
        { label: t('活动时长'), value: formatMinute(data.activeMinutes) }
      ]
    },
    activityIntensity: {
      title: t('活动强度'),
      subtitle: t('查看本周中高强度活动总量与负荷状态'),
      fetcher: () => getActivityIntensityDetail(),
      chartKey: 'durationChart',
      chartValueKey: 'minutes',
      summary: (data) => [
        { label: t('中高强度总时长'), value: formatMinute(data.totalMinutes) },
        { label: t('活动强度等级'), value: data.intensityLevel }
      ]
    },
    exerciseRegularity: {
      title: t('运动规律性'),
      subtitle: t('观察运动负荷是否稳定、每周活跃天数是否达标'),
      fetcher: () => getActivityRegularityDetail(),
      chartKey: 'balanceChart',
      chartValueKey: 'index',
      summary: (data) => [
        {
          label: t('负荷平衡指数'),
          value: formatBalanceIndex(data.balanceIndex),
          trend: formatBalanceIndexExplanation(data.balanceIndex)
        },
        { label: t('负荷等级'), value: data.balanceLevel },
        { label: t('中高强度活动天数'), value: formatDay(data.midHighDays) }
      ]
    }
  };
  return configs[type];
};

const currentConfig = computed(() => getDetailConfig(detailType.value));
const overview = computed(() => detailData.value?.overview || {});
const summaryItems = computed(() => currentConfig.value.summary(detailData.value || {}).filter((item) => hasValue(item.value)));
const chartItems = computed(() => {
  const key = currentConfig.value.chartKey;
  if (!key || !Array.isArray(detailData.value?.[key])) return [];
  return detailData.value[key].map((item: Record<string, any>) => {
    const rawValue = item[currentConfig.value.chartValueKey || 'score'] ?? item.score ?? item.value ?? item.level ?? '--';
    return {
      label: item.weekLabel || item.label || item.date || '--',
      value:
        detailType.value === 'activityIntensity'
          ? formatActivityTrendMinutes(rawValue)
          : detailType.value === 'exerciseRegularity'
            ? formatBalanceIndex(rawValue)
            : rawValue,
      level: normalizeHealthText(item.level, '')
    };
  });
});

const displayTitle = computed(() => (pageTitle.value ? t(pageTitle.value) : currentConfig.value.title));
const overviewTrendLabel = computed(() => (detailType.value === 'activityIntensity' ? t('活动评分较上期') : t('趋势')));
const overviewTrendValue = computed(() => {
  if (detailType.value !== 'activityIntensity') return t(formatValue(overview.value.trend));
  return formatActivityScoreChange(overview.value.trendValue, true);
});
const overviewChangeLabel = computed(() => (detailType.value === 'activityIntensity' ? t('评分变化') : t('变化值')));
const overviewChangeValue = computed(() => {
  if (detailType.value !== 'activityIntensity') return formatValue(overview.value.trendValue);
  return formatActivityScoreChange(overview.value.trendValue, false);
});
const chartSectionTitle = computed(() => {
  if (detailType.value === 'activityIntensity') return t('近5周中高强度活动时长');
  if (detailType.value === 'exerciseRegularity') return t('近5周负荷平衡指数');
  return t('近期趋势');
});

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
const formatUnitValue = (value: unknown, unitPattern: RegExp, key: string) => {
  if (!hasValue(value)) return '--';
  const text = String(value).trim().replace(unitPattern, '').trim();
  if (isNumericText(text)) return t(key, { value: text });
  return normalizeHealthText(String(value).trim(), '--');
};
const formatMinute = (value: unknown) => {
  return formatUnitValue(value, /分钟/g, '{value}分钟');
};
const formatDay = (value: unknown) => {
  return formatUnitValue(value, /天/g, '{value}天');
};
const toFiniteNumber = (value: unknown) => {
  const numberValue = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(numberValue) ? numberValue : null;
};
const formatMetricNumber = (value: number) => {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
};
const formatActivityScoreChange = (value: unknown, signed: boolean) => {
  const score = toFiniteNumber(value);
  if (score === null) return '--';
  const displayScore = signed ? score : Math.abs(score);
  const prefix = signed && displayScore > 0 ? '+' : '';
  return t('{value}分', { value: `${prefix}${formatMetricNumber(displayScore)}` });
};
const formatActivityTrendMinutes = (value: unknown) => {
  const minutes = toFiniteNumber(value);
  if (minutes === null || minutes <= 0) return '--';
  return t('{value}分钟', { value: formatMetricNumber(minutes) });
};
const formatBalanceIndex = (value: unknown) => {
  const index = toFiniteNumber(value);
  if (index === null || index <= 0) return '--';
  return formatMetricNumber(index);
};
const formatBalanceIndexExplanation = (value: unknown) => {
  const index = toFiniteNumber(value);
  if (index === null || index <= 0) return '';
  const percent = Math.round(index * 100);
  return t('{index} 代表本周单个活跃日的中高强度活动量约为建议基准的 {percent}%', {
    index: formatMetricNumber(index),
    percent
  });
};
const formatCurrentAndAverage = (value: any, unit: string) => {
  if (!value || typeof value !== 'object') return '--';
  const current = toFiniteNumber(value.currentValue);
  const average = toFiniteNumber(value.avgValue);
  if (current === null && average === null) return '--';
  const localizedUnit = t(unit);
  const currentText = current === null ? t('本周 --') : t('本周 {value} {unit}', { value: formatMetricNumber(current), unit: localizedUnit });
  const averageText =
    average === null ? t('近期均值 --') : t('近期均值 {value} {unit}', { value: formatMetricNumber(average), unit: localizedUnit });
  return `${currentText}｜${averageText}`;
};
const formatCurrentAverageTrend = (value: any, unit: string) => {
  if (!value || typeof value !== 'object') return '';
  const current = toFiniteNumber(value.currentValue);
  const average = toFiniteNumber(value.avgValue);
  if (current === null || average === null) return '';
  const difference = Number((current - average).toFixed(2));
  if (difference === 0) return t('较近期均值保持稳定');
  const direction = t(difference > 0 ? '上升' : '下降');
  return t('较近期均值{direction} {value} {unit}', {
    direction,
    value: formatMetricNumber(Math.abs(difference)),
    unit: t(unit)
  });
};

const loadDetail = async () => {
  loading.value = true;
  try {
    detailData.value = await currentConfig.value.fetcher();
  } catch (error) {
    detailData.value = null;
    uni.showToast({
      title: t(formatBleErrorMessage(error, '详情加载失败，请稍后重试')),
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
  pageTitle.value = String(options.title || '');
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
        <view class="level">{{ t(formatValue(overview.level)) }}</view>
      </view>

      <view class="overview">
        <view class="overview-item">
          <text class="label">{{ t('日期范围') }}</text>
          <text class="value">{{ formatValue(overview.dateRange) }}</text>
        </view>
        <view class="overview-item">
          <text class="label">{{ overviewTrendLabel }}</text>
          <text class="value">{{ overviewTrendValue }}</text>
        </view>
        <view class="overview-item">
          <text class="label">{{ overviewChangeLabel }}</text>
          <text class="value">{{ overviewChangeValue }}</text>
        </view>
      </view>

      <view class="section" v-if="summaryItems.length > 0">
        <view class="section-title">{{ t('关键指标') }}</view>
        <view class="metric-list">
          <view class="metric-row" v-for="item in summaryItems" :key="item.label">
            <text class="metric-label">{{ item.label }}</text>
            <view class="metric-content">
              <text class="metric-value">{{ t(formatValue(item.value)) }}</text>
              <text v-if="item.trend" class="metric-trend">{{ item.trend }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="section" v-if="chartItems.length > 0">
        <view class="section-title">{{ chartSectionTitle }}</view>
        <view class="trend-list">
          <view class="trend-row" v-for="item in chartItems" :key="item.label">
            <text class="trend-label">{{ item.label }}</text>
            <text class="trend-value">{{ t(formatValue(item.value)) }}</text>
            <text class="trend-level" v-if="item.level">{{ t(item.level) }}</text>
          </view>
        </view>
      </view>

      <view v-if="!loading && !detailData" class="empty">{{ t('暂无详情数据') }}</view>
      <view v-if="loading" class="empty">{{ t('加载中...') }}</view>
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

.metric-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-end;
  padding: 16rpx 0;
}

.metric-value {
  line-height: 1.45;
}

.metric-trend {
  margin-top: 6rpx;
  color: #667085;
  font-size: 24rpx;
  line-height: 1.4;
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
