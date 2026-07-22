<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { cloneDeep } from 'lodash-es';
import { sleepRageOption } from '@/homeDetail/sleepPage/echartOptions';
import type { sleepSegment, Point } from '@/types/api/homeDetail';

const echarts = require('../../../static/echarts.min.js');

const props = defineProps({
  sleepSegmentObj: {
    type: Object as () => sleepSegment,
    default: () => ({})
  }
});

type SleepStageName = '深睡' | '浅睡' | '快速眼动' | '清醒' | '小睡';

const SLEEP_ORDER: SleepStageName[] = ['深睡', '浅睡', '快速眼动', '清醒', '小睡'];
const SLEEP_COLORS: Record<SleepStageName, string> = {
  深睡: '#5f57ec',
  浅睡: '#c5c2f9',
  快速眼动: '#9994f4',
  清醒: '#e2e1fd',
  小睡: '#feba8a'
};

const STAGE_NAME_MAP: Record<string, SleepStageName> = {
  '1': '清醒',
  awake: '清醒',
  清醒: '清醒',
  '2': '快速眼动',
  rem: '快速眼动',
  REM: '快速眼动',
  快速眼动: '快速眼动',
  '3': '浅睡',
  light: '浅睡',
  浅睡: '浅睡',
  '4': '深睡',
  deep: '深睡',
  深睡: '深睡',
  '5': '小睡',
  nap: '小睡',
  小睡: '小睡'
};

const chartRef = ref<any>(null);

const normalizeStageName = (value: unknown): SleepStageName | '' => {
  const key = String(value ?? '').trim();
  return STAGE_NAME_MAP[key] || '';
};

const normalizeMinutes = (value: unknown) => {
  if (value == null || value === '') return 0;
  const minutes = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0;
};

const formatMinutesToTime = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0小时00分钟';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}小时${remainingMinutes.toString().padStart(2, '0')}分钟`;
};

const collectStageTotals = (data: Point[] = []) => {
  const totals = SLEEP_ORDER.reduce(
    (result, stage) => {
      result[stage] = 0;
      return result;
    },
    {} as Record<SleepStageName, number>
  );

  data.forEach((item) => {
    const stageName = normalizeStageName(item?.time);
    if (!stageName) return;
    totals[stageName] += normalizeMinutes(item?.value);
  });

  return totals;
};

const stageTotals = computed(() => {
  const section = Array.isArray(props.sleepSegmentObj?.chartDataSection) ? props.sleepSegmentObj.chartDataSection : [];
  const sectionTotals = collectStageTotals(section);
  const hasSectionData = SLEEP_ORDER.some((stage) => sectionTotals[stage] > 0);
  if (hasSectionData) return sectionTotals;

  const chartData = Array.isArray(props.sleepSegmentObj?.chartData) ? props.sleepSegmentObj.chartData : [];
  return collectStageTotals(chartData);
});

const stageStats = computed(() => {
  const values = SLEEP_ORDER.map((name) => ({
    name,
    minutes: stageTotals.value[name] || 0,
    color: SLEEP_COLORS[name]
  }));
  const total = values.reduce((sum, item) => sum + item.minutes, 0);
  return values.map((item) => ({
    ...item,
    duration: formatMinutesToTime(item.minutes),
    percent: total > 0 ? `${((item.minutes / total) * 100).toFixed(1)}%` : '0.0%'
  }));
});

const pieData = computed(() => {
  const values = stageStats.value.filter((item) => item.minutes > 0);
  if (!values.length) {
    return [
      {
        name: '暂无数据',
        value: 1,
        itemStyle: {
          color: '#e9e8ff',
          borderWidth: 2,
          borderColor: '#ffffff'
        }
      }
    ];
  }

  return values.map((item) => ({
    name: item.name,
    value: item.minutes,
    itemStyle: {
      color: item.color,
      borderWidth: 2,
      borderColor: '#ffffff'
    }
  }));
});

const getProcessedOption = () => {
  const option = cloneDeep(sleepRageOption);

  if (option.legend) option.legend.show = false;
  if (option.title) {
    option.title.subtext = '睡眠\n比例';
    option.title.left = '50%';
    option.title.top = '45%';
  }
  if (option.series?.[0]) {
    option.series[0].radius = ['46%', '66%'];
    option.series[0].center = ['50%', '50%'];
    option.series[0].data = pieData.value;
    option.series[0].label = { show: false };
    option.series[0].labelLine = { show: false };
  }

  return option;
};

const initChart = async () => {
  if (!chartRef.value) return;
  try {
    const pie = await chartRef.value.init(echarts);
    pie.setOption(getProcessedOption(), true);
  } catch (error) {
    console.error('睡眠区间图表初始化失败', error);
  }
};

watch(
  () => props.sleepSegmentObj,
  async () => {
    await nextTick();
    await initChart();
  },
  { deep: true, immediate: true }
);
</script>

<template>
  <view class="bg-white r-50 mb-30 p-30">
    <view>
      <view class="score-title fs-36">
        睡眠区间
        <slot></slot>
      </view>
    </view>
    <view class="mt-20">
      <view class="ta-l fs-48">
        <text>{{ sleepSegmentObj.startTime || '00:00' }}</text>
        <text>-</text>
        <text>{{ sleepSegmentObj.endTime || '00:00' }}</text>
      </view>
    </view>
    <view class="sleep-range-content">
      <view class="sleep-range-chart">
        <l-echart ref="chartRef" @finished="initChart" style="width: 100%; height: 320rpx; margin: 0"></l-echart>
      </view>
      <view class="sleep-stage-stats">
        <view v-for="item in stageStats" :key="item.name" class="sleep-stage-row">
          <view class="sleep-stage-name">
            <view class="sleep-stage-dot" :style="{ backgroundColor: item.color }"></view>
            <text>{{ item.name }}</text>
          </view>
          <view class="sleep-stage-value">
            <text>{{ item.duration }}</text>
            <text class="sleep-stage-percent">{{ item.percent }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.sleep-range-content {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 340rpx;
  margin-top: 18rpx;
}

.sleep-range-chart {
  width: 300rpx;
  flex: 0 0 300rpx;
}

.sleep-stage-stats {
  flex: 1;
  min-width: 0;
  padding-left: 18rpx;
}

.sleep-stage-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52rpx;
  font-size: 24rpx;
}

.sleep-stage-name,
.sleep-stage-value {
  display: flex;
  align-items: center;
}

.sleep-stage-name {
  color: #010101;
}

.sleep-stage-dot {
  width: 18rpx;
  height: 18rpx;
  margin-right: 12rpx;
  border-radius: 4rpx;
}

.sleep-stage-value {
  color: #010101;
  white-space: nowrap;
}

.sleep-stage-percent {
  width: 78rpx;
  margin-left: 12rpx;
  color: #979797;
  text-align: right;
}
</style>
