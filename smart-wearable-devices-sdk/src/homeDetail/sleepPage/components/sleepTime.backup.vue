<script setup lang="ts">
// @ts-nocheck
import { ref, computed, watch } from 'vue';
import { sleepTimeOption } from '@/homeDetail/sleepPage/echartOptions';
import type { sleepDetail, Point } from '@/types/api/homeDetail';
import { cloneDeep } from 'lodash-es';
const echarts = require('../../../static/echarts.min.js');
const chartRef = ref<any>(null);
const chartData = ref<Point[]>([]);
const props = defineProps({
  sleepDetailObj: {
    type: Object as () => sleepDetail,
    default: () => ({})
  }
});
// 计算属性：将分钟数拆分为小时和分钟
const sleepDurationHours = computed(() => {
  if (!props.sleepDetailObj?.sleepDuration) return 0;
  return Math.floor(props.sleepDetailObj.sleepDuration / 60);
});

const sleepDurationMinutes = computed(() => {
  if (!props.sleepDetailObj?.sleepDuration) return 0;
  return props.sleepDetailObj.sleepDuration % 60;
});
const formattedMinutes = computed(() => {
  return sleepDurationMinutes.value.toString().padStart(2, '0');
});
// 添加watch监听props变化
watch(
  () => props.sleepDetailObj,
  async (newVal, oldVal) => {
    if (newVal !== oldVal) {
      // 当sleepDetailObj变化时，重新初始化图表
      await initChart();
    }
  },
  { deep: true }
);
const getProcessedOption = () => {
  // 深拷贝原option
  const newOption = cloneDeep(sleepTimeOption);

  // 确保chartData有数据，否则使用默认数据
  const hasChartData = props.sleepDetailObj?.chartData && props.sleepDetailObj?.chartData.length > 0;
  const generateMockData = () => {
    const mockXData = ['00:00', '01:00', '02:00', '03:00']; // 时间标签
    const mockSeriesData = [1, 2, 3, 4]; // 数值为1-4
    return { mockXData, mockSeriesData };
  };
  const fullXData = hasChartData
    ? props.sleepDetailObj?.chartData?.map((item: Point) => {
        // 处理时间格式，去除秒部分
        const timeStr = item.time?.toString() || '00:00';
        // 如果时间包含秒（格式为 HH:mm:ss），则只取前5个字符（HH:mm）
        if (timeStr.includes(':') && timeStr.split(':').length === 3) {
          return timeStr.substring(0, 5); // 取前5个字符，如 "18:00"
        }
        // 如果已经是 HH:mm 格式，直接返回
        return timeStr;
      })
    : [];
  const fullSeriesData = hasChartData
    ? props.sleepDetailObj?.chartData?.map((item: Point) => Number(item.value) || 0)
    : // 默认13小时数据
      [];
  // 3. 替换xAxis.data和series.data为完整数据
  newOption.xAxis.data = fullXData || [];
  newOption.series[0].data = fullSeriesData || [];
  // 4. 控制x轴只显示指定刻度
  newOption.xAxis.axisLabel = {
    ...newOption.xAxis.axisLabel,
    interval: 0,
    formatter: (value: string, index: number) => {
      const dataLength = newOption.xAxis.data.length;
      // 如果数据长度为24，则只显示指定刻度
      if (dataLength === 24) {
        // return [0, 6, 12, 18, 23].includes(index);
        return [0, 6, 12, 18, 23].includes(index) ? value : '';
      } else {
        // 数据长度不为24时，显示两端和部分中间刻度
        const firstIndex = 0;
        const lastIndex = dataLength - 1;

        // 总是显示第一个和最后一个刻度
        if (index === firstIndex || index === lastIndex) {
          return value;
        }
        // 根据数据长度决定中间显示几个刻度
        if (dataLength <= 5) {
          // 数据很少时，显示所有刻度
          return value;
        } else if (dataLength <= 10) {
          // 中等长度数据，显示中间1个刻度
          const midIndex = Math.floor(dataLength / 2);
          return index === midIndex ? value : '';
        } else {
          // 较长数据，显示中间2个刻度（四等分点）
          const midIndex = Math.floor(dataLength / 2);
          const quarter1 = Math.floor(dataLength / 4);
          const quarter3 = Math.floor((dataLength * 3) / 4);
          return index === quarter1 || index === quarter3 || index === midIndex ? value : '';
        }
      }
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
    console.error('图表初始化失败:', error);
  }
};
</script>
<template>
  <view class="mt-30 mb-30 r-50 bg-white p-10">
    <view class="p-20 r-50" style="background-color: #f8f8fe">
      <view class="ta-c">
        <text class="fs-72">{{ sleepDurationHours || '00' }}</text>
        <text class="fs-24">小时</text>
        <text class="fs-72">{{ formattedMinutes || '00' }}</text>
        <text class="fs-24">分钟</text>
      </view>
      <view class="ta-c fs-28">
        睡眠时间
        <slot></slot>
      </view>
      <view class="flex ai-center jc-center">
        <l-echart ref="chartRef" @finished="initChart" style="width: 100%; height: 424rpx; margin: 0"></l-echart>
      </view>
    </view>
  </view>
</template>

<style></style>
