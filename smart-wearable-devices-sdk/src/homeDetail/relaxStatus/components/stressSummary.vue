<script setup lang="ts">
// @ts-nocheck
import { computed, ref, watch } from 'vue';
const echarts = require('../../../static/echarts.min.js');
import { lastWeekOption, todayOption } from '@/homeDetail/relaxStatus/echartOptions';
import type { Point, stressSummaryType } from '@/types/api/homeDetail';
import { getSleepDurationHours, getSleepDurationMinutes } from '@/utils/utils.js';
import { cloneDeep } from 'lodash-es';

const props = defineProps({
  stressSummaryObj: {
    type: Object as () => stressSummaryType,
    default: () => ({})
  }
});

watch(
  () => props.stressSummaryObj,
  async (newVal, oldVal) => {
    if (newVal !== oldVal) {
      await initTodayChart();
      await initLastWeekChart();
    }
  },
  { deep: true }
);

const todayRef = ref<any>(null);
const lastWeekRef = ref<any>(null);

const todayScore = computed(() => props.stressSummaryObj?.todayStressScore ?? 0);
const weekScore = computed(() => props.stressSummaryObj?.weekAvgStressScore ?? 0);
const stressDifference = computed(() => todayScore.value - weekScore.value);
const stressDifferenceAbs = computed(() => Math.abs(stressDifference.value));

const getMaxTime = (timeArray: string[] = []): string => {
  if (!timeArray || timeArray.length === 0) return '00:00';

  const timeToMinutes = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + (minutes || 0);
  };

  return timeArray.reduce((max, current) => (timeToMinutes(current) > timeToMinutes(max) ? current : max), '00:00');
};

const getLastWeekDateRange = (): string => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const dayOfWeek = yesterday.getDay();
  const monday = new Date(yesterday);
  monday.setDate(yesterday.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const formatDate = (date: Date): string => {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}月${day}日`;
  };

  return `${formatDate(monday)}-${formatDate(sunday)}`;
};

const formatTimeData = (data: Point[] = []): { xData: string[]; seriesData: number[] } => {
  const xData = data.map((item: Point) => {
    if (!item.time) return '00:00';
    return item.time.includes(':') ? item.time : `${item.time.toString().padStart(2, '0')}:00`;
  });
  const seriesData = data.map((item: Point) => Number(item.value) || 0);
  return { xData, seriesData };
};

const configureChartOptions = (newOption: any, xData: string[], seriesData: number[], titleText: string) => {
  const yAxisMax = 100;
  const yAxisMid = yAxisMax / 2;

  newOption.xAxis.data = xData;
  newOption.series[0].data = seriesData;
  newOption.title = {
    ...newOption.title,
    text: titleText
  };
  newOption.yAxis = {
    ...newOption.yAxis,
    min: 0,
    max: yAxisMax,
    axisLabel: {
      ...newOption.yAxis.axisLabel,
      formatter: (value: number) => {
        if (value === 0 || value === yAxisMid || value === yAxisMax) return value.toString();
        return '';
      }
    }
  };
  newOption.xAxis.axisLabel = {
    ...newOption.xAxis.axisLabel,
    interval: 0,
    formatter: (value: string, index: number) => {
      const dataLength = newOption.xAxis.data.length;
      if (dataLength === 24) {
        return [0, 6, 12, 18, 23].includes(index) ? value : '';
      }

      const firstIndex = 0;
      const lastIndex = dataLength - 1;
      if (index === firstIndex || index === lastIndex) return value;
      if (dataLength <= 5) return value;
      if (dataLength <= 10) return index === Math.floor(dataLength / 2) ? value : '';

      const quarter1 = Math.floor(dataLength / 4);
      const quarter3 = Math.floor((dataLength * 3) / 4);
      return index === quarter1 || index === quarter3 ? value : '';
    }
  };

  return newOption;
};

const getFirstOption = () => {
  const newOption = cloneDeep(todayOption);
  const data = props.stressSummaryObj?.todayStressChart || [];
  const { xData, seriesData } = formatTimeData(data);
  return configureChartOptions(newOption, xData, seriesData, `今天：${getMaxTime(xData)}`);
};

const getSecondOption = () => {
  const newOption = cloneDeep(lastWeekOption);
  const data = props.stressSummaryObj?.weekStressChart || [];
  const { xData, seriesData } = formatTimeData(data);
  return configureChartOptions(newOption, xData, seriesData, `${getLastWeekDateRange()}：${getMaxTime(xData)}`);
};

const initTodayChart = async () => {
  if (!todayRef.value) return;
  try {
    const pie = await todayRef.value.init(echarts);
    pie.setOption(getFirstOption());
  } catch (error) {
    console.error('今日压力图表初始化失败', error);
  }
};

const initLastWeekChart = async () => {
  if (!lastWeekRef.value) return;
  try {
    const pie = await lastWeekRef.value.init(echarts);
    pie.setOption(getSecondOption());
  } catch (error) {
    console.error('上周压力图表初始化失败', error);
  }
};
</script>

<template>
  <view class="bg-white r-50 mb-30 p-30">
    <view class="flex jc-start">
      <view class="fs-36">压力总结</view>
    </view>
    <view class="fs-28 mt-30">
      截至当前，您的压力值较上周平均{{ stressDifference >= 0 ? '增加了' : '减少了' }}
      <text style="color: #2e70fc">{{ stressDifferenceAbs || '00' }}</text>
      <text>分。</text>
    </view>
    <view class="flex jc-between ai-center mt-50">
      <view class="itemBox p-40 flex fd-c jc-center ai-center">
        <view class="flex ai-center">
          <text class="fs-28">今天</text>
          <view :class="stressDifference > 0 ? 'arrow-up' : ''">
            <view class="trend-arrow"></view>
          </view>
        </view>
        <view>
          <text class="fs-36">{{ todayScore }}</text>
          <text class="fs-24">分</text>
        </view>
      </view>
      <view class="flex ai-center jc-center chartBox">
        <l-echart ref="todayRef" @finished="initTodayChart" style="width: 100%; height: 220rpx; margin: 0"></l-echart>
      </view>
    </view>
    <view class="flex jc-between ai-center mt-30">
      <view class="itemBox p-40 flex fd-c jc-center ai-center">
        <view class="flex ai-center">
          <text class="fs-28">上周</text>
        </view>
        <view>
          <text class="fs-36">{{ weekScore }}</text>
          <text class="fs-24">分</text>
        </view>
      </view>
      <view class="flex ai-center jc-center chartBox">
        <l-echart ref="lastWeekRef" @finished="initLastWeekChart" style="width: 100%; height: 220rpx; margin: 0"></l-echart>
      </view>
    </view>
    <view class="flex jc-between ai-center mt-50">
      <view class="itemBottomBox r-50 flex fd-c jc-center ai-start mr-30 pl-45">
        <view class="flex ai-center">
          <text class="fs-28">放松</text>
        </view>
        <view>
          <text class="fs-36">{{ getSleepDurationHours(stressSummaryObj?.relaxDuration) || '00' }}</text>
          <text class="fs-24">小时</text>
          <text class="fs-36">{{ getSleepDurationMinutes(stressSummaryObj?.relaxDuration) || '00' }}</text>
          <text class="fs-24">分钟</text>
        </view>
      </view>
      <view class="itemBottomBox r-50 flex fd-c jc-center ai-start pl-45">
        <view class="flex ai-center">
          <text class="fs-28">正常</text>
        </view>
        <view>
          <text class="fs-36">{{ getSleepDurationHours(stressSummaryObj?.normalDuration) || '00' }}</text>
          <text class="fs-24">小时</text>
          <text class="fs-36">{{ getSleepDurationMinutes(stressSummaryObj?.normalDuration) || '00' }}</text>
          <text class="fs-24">分钟</text>
        </view>
      </view>
    </view>
    <view class="flex jc-between ai-center mt-30">
      <view class="itemBottomBox r-50 flex fd-c jc-center ai-start mr-30 pl-45">
        <view class="flex ai-center">
          <text class="fs-28">中等</text>
        </view>
        <view>
          <text class="fs-36">{{ getSleepDurationHours(stressSummaryObj?.moderateStressDuration) || '00' }}</text>
          <text class="fs-24">小时</text>
          <text class="fs-36">{{ getSleepDurationMinutes(stressSummaryObj?.moderateStressDuration) || '00' }}</text>
          <text class="fs-24">分钟</text>
        </view>
      </view>
      <view class="itemBottomBox r-50 flex fd-c jc-center ai-start pl-45">
        <view class="flex ai-center">
          <text class="fs-28">偏高</text>
        </view>
        <view>
          <text class="fs-36">{{ getSleepDurationHours(stressSummaryObj?.highStressDuration) || '00' }}</text>
          <text class="fs-24">小时</text>
          <text class="fs-36">{{ getSleepDurationMinutes(stressSummaryObj?.highStressDuration) || '00' }}</text>
          <text class="fs-24">分钟</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.itemBox {
  width: 160rpx;
  box-sizing: border-box;
  border-radius: 50rpx;
  background: #f7f7f7;
}
.itemBottomBox {
  width: 100%;
  height: 160rpx;
  background: #f7f7f7;
}
.chartBox {
  flex: 1;
}
.arrow-up {
  transform: rotate(180deg);
  transition: transform 0.3s ease;
}
.trend-arrow {
  width: 0;
  height: 0;
  margin-left: 8rpx;
  border-left: 10rpx solid transparent;
  border-right: 10rpx solid transparent;
  border-top: 16rpx solid #2ecf7c;
}
</style>
