<script setup lang="ts">
// @ts-nocheck
import { computed, ref, watch } from 'vue';
const echarts = require('../../../static/echarts.min.js');
import { baseOption } from '@/homeDetail/relaxStatus/echartOptions';
import type { Point, stressDetail } from '@/types/api/homeDetail';
import { cloneDeep } from 'lodash-es';

const props = defineProps({
  stressDetail: {
    type: Object as () => stressDetail,
    default: () => ({})
  }
});

watch(
  () => props.stressDetail,
  async (newVal, oldVal) => {
    if (newVal !== oldVal) {
      await initChart();
    }
  },
  { deep: true }
);

const chartRef = ref<any>(null);

const stressValue = computed(() => {
  const detail = props.stressDetail || {};
  const value = detail.stressValue ?? detail.avgStressValue ?? detail.stress ?? detail.value;
  return value === null || value === undefined || value === '' ? '00' : value;
});

const stressLevel = computed(() => props.stressDetail?.stressLevel || '压力');
const formatIntegerMetric = (value: unknown, fallback = '00') => {
  if (value == null || value === '') return fallback;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? String(Math.round(numeric)) : fallback;
};
const latestHrvValue = computed(() => formatIntegerMetric(props.stressDetail?.latestHrvValue ?? props.stressDetail?.hrv));
const dailyAvgHrvValue = computed(() => formatIntegerMetric(props.stressDetail?.dailyAvgHrvValue ?? props.stressDetail?.avgHrvValue));

const getProcessedOption = () => {
  const newOption = cloneDeep(baseOption);
  const chart = Array.isArray(props.stressDetail?.stressChart) ? props.stressDetail.stressChart : [];
  const xData = chart.map((item: Point) => item.time?.toString() || '00:00');
  const seriesData = chart.map((item: Point) => Number(item.value) || 0);

  newOption.xAxis.data = xData;
  newOption.series[0].data = seriesData;

  const maxValue = Math.max(...seriesData, 0);
  newOption.yAxis = {
    ...newOption.yAxis,
    max: maxValue > 50 ? 100 : 50,
    interval: maxValue > 50 ? 20 : 10
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

      const midIndex = Math.floor(dataLength / 2);
      const quarter1 = Math.floor(dataLength / 4);
      const quarter3 = Math.floor((dataLength * 3) / 4);
      return index === quarter1 || index === quarter3 || index === midIndex ? value : '';
    }
  };

  return newOption;
};

const initChart = async () => {
  if (!chartRef.value) return;
  try {
    const pie = await chartRef.value.init(echarts);
    pie.setOption(getProcessedOption());
  } catch (error) {
    console.error('压力图表初始化失败', error);
  }
};
</script>

<template>
  <view class="mt-30 mb-30 r-50 bg-white p-10">
    <view class="p-20 r-50" style="background-color: #f5fdfb">
      <view class="ta-c">
        <text class="fs-72">{{ stressValue }}</text>
        <text class="fs-28">{{ stressLevel }}</text>
      </view>
      <view class="ta-c fs-28">压力值<slot></slot></view>
      <view class="flex ai-center jc-center">
        <l-echart ref="chartRef" @finished="initChart" style="width: 100%; height: 424rpx; margin: 0"></l-echart>
      </view>
      <view class="pl-65 pr-65 mt-50">
        <view class="flex jc-between">
          <text class="t-979797 fs-28">最新 HRV</text>
          <text class="t-979797 fs-28">当日平均 HRV</text>
        </view>
        <view class="flex jc-between mt-20">
          <view>
            <text class="fs-48">{{ latestHrvValue }}</text>
            <text class="t-979797 fs-24">毫秒</text>
          </view>
          <view>
            <text class="fs-48">{{ dailyAvgHrvValue }}</text>
            <text class="t-979797 fs-24">毫秒</text>
          </view>
        </view>
        <view class="t-979797 fs-24 mt-30">通常来说，较高 HRV（心率变异性）代表较好的状态</view>
      </view>
    </view>
  </view>
</template>

<style></style>
