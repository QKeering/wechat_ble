<script setup lang="ts">
// @ts-nocheck
import { ref, watch } from 'vue';
const echarts = require('../../../static/echarts.min.js');
import { pressureOption } from '@/homeDetail/relaxStatus/echartOptions';
import type { Point, stressProportion } from '@/types/api/homeDetail';
import { cloneDeep } from 'lodash-es';

const props = defineProps({
  stressProportion: {
    type: Object as () => stressProportion,
    default: () => {}
  }
});

watch(
  () => props.stressProportion,
  async (newVal, oldVal) => {
    if (newVal !== oldVal) {
      await initChart();
    }
  },
  { deep: true }
);

const chartRef = ref<any>(null);

const formatMinutesToTime = (minutes: number): string => {
  if (isNaN(minutes) || minutes < 0) {
    return '0小时00分钟';
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}小时${remainingMinutes.toString().padStart(2, '0')}分钟`;
};

const areAllValuesZero = (dataArray: any[] = []): boolean => {
  if (!dataArray || dataArray.length === 0) return false;
  return dataArray.every((item) => item.value === '0' || item.value === 0);
};

const colorMap = {
  放松: '#e6f7f3',
  正常: '#66e6cc',
  中等: '#00cc99',
  偏高: '#009966'
};

const emptyChartData = {
  stressDuration: [
    { time: '偏高', value: '60' },
    { time: '正常', value: '30' },
    { time: '放松', value: '10' }
  ],
  stressProportionChart: [
    { time: '放松', value: '0' },
    { time: '正常', value: '0' },
    { time: '偏高', value: '0' }
  ]
};

const getSecoundOption = () => {
  const newOption = cloneDeep(pressureOption);
  if (!props.stressProportion?.stressDuration) return newOption;

  const { stressDuration, stressProportionChart } = props.stressProportion;

  const updateLegendConfig = (dataArray: Point[] = []) => {
    if (!dataArray || dataArray.length === 0) return;

    const timeMap: Record<string, string> = {};
    dataArray.forEach((item) => {
      if (item.time && item.value !== undefined) {
        timeMap[item.time] = formatMinutesToTime(Number(item.value));
      }
    });

    const percentMap: Record<string, string> = {};
    (stressProportionChart || []).forEach((item) => {
      if (item.time && item.value !== undefined) {
        percentMap[item.time] = `${item.value}%`;
      }
    });

    if (newOption.legend) {
      newOption.legend.data = dataArray.map((item) => ({
        name: item.time || '',
        icon: 'circle'
      }));
      newOption.legend.top = dataArray.length === 5 ? '10%' : dataArray.length > 5 ? '0%' : '20%';
      newOption.legend.formatter = function (name: string) {
        const time = timeMap[name] || '0小时00分钟';
        const percent = percentMap[name] || '0%';
        return `{nameStyle|${name}}{space|    }{percentStyle|${percent}}{space|    }{timeStyle|${time}}`;
      };
    }
  };

  if ((stressDuration && stressDuration.length === 0) || areAllValuesZero(stressDuration)) {
    if (newOption.series && newOption.series[0]) {
      newOption.series[0].data = emptyChartData.stressDuration.map((item) => ({
        value: item.value || 0,
        itemStyle: {
          color: '#cdf9ec',
          borderWidth: 1,
          borderColor: '#cdf9ec'
        },
        name: item.time || ''
      }));
    }
    updateLegendConfig(emptyChartData.stressProportionChart);
    return newOption;
  }

  if (stressDuration && stressDuration.length > 0) {
    const pieData = stressDuration.map((item) => ({
      name: item.time || '',
      value: item.value || 0,
      itemStyle: {
        color: colorMap[item.time as keyof typeof colorMap] || '#e6e5fc',
        borderWidth: 1,
        borderColor: '#ffffff'
      }
    }));

    if (newOption.series && newOption.series[0]) {
      newOption.series[0].data = pieData;
    }

    updateLegendConfig(stressProportionChart);
  }

  return newOption;
};

const initChart = async () => {
  if (!chartRef.value) return;
  try {
    const pie = await chartRef.value.init(echarts);
    pie.setOption(getSecoundOption());
  } catch (error) {
    console.error('压力比例图表初始化失败', error);
  }
};
</script>

<template>
  <view class="bg-white r-50 mb-30 p-30">
    <view>
      <view class="score-title fs-36">压力比例</view>
    </view>
    <view class="flex ai-center jc-center">
      <l-echart ref="chartRef" @finished="initChart" style="width: 100%; height: 320rpx; margin: 0"></l-echart>
    </view>
  </view>
</template>

<style></style>
