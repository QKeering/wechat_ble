<script setup lang="ts">
// @ts-nocheck
import { ref, computed, watch } from 'vue';
import { sleepTimeOption2 as sleepTimeOption } from '@/homeDetail/sleepPage/echartOptions';
import type { sleepDetail, sleepSegment, Point } from '@/types/api/homeDetail';
import { cloneDeep } from 'lodash-es';

const echarts = require('../../../static/echarts.min.js');

// ECharts 实例类型（简化）
interface EChartsInstance {
  setOption: (option: any) => void;
  dispose: () => void;
}

// l-echart 组件类型
interface LEchartComponent {
  init: (echarts: any) => Promise<EChartsInstance>;
}

const props = defineProps({
  sleepDetailObj: {
    type: Object as () => sleepDetail,
    default: () => ({})
  },
  sleepSegmentObj: {
    type: Object as () => sleepSegment,
    default: () => ({})
  }
});

const chartRef = ref<LEchartComponent | null>(null);
const chartInstance = ref<EChartsInstance | null>(null);

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

// 睡眠状态到系列索引的映射
const stageSeriesMap: Record<string, number> = {
  快速眼动: 0,
  深睡: 1,
  浅睡: 2,
  清醒: 3
};

// 从 chartDataSection 获取各睡眠阶段的时长（分钟）
const getStageDuration = (stageName: string): number => {
  const chartDataSection = props.sleepSegmentObj?.chartDataSection;
  if (!chartDataSection || !Array.isArray(chartDataSection)) return 0;
  const stage = chartDataSection.find((item: Point) => item.time === stageName);
  return stage ? parseInt(String(stage.value || '0'), 10) : 0;
};

// 解析时间字符串 "HH:MM:SS" 为从00:00:00开始的分钟数
const parseTimeToMinutes = (timeStr: string): number => {
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);
  return hours * 60 + minutes + Math.floor(seconds / 60);
};

// 处理数据，生成时间段
// 规则：chartData 的每个成员项表示当前睡眠类型的开始时间
// 当前睡眠类型的结束时间是下一个成员项的时间（下一个睡眠类型的开始时间）
// 最后一个睡眠类型的结束时间是 sleepSegmentObj.endTime
const processTimeSegments = (): Array<{ start: number; duration: number; type: string }> => {
  const chartData = props.sleepDetailObj?.chartData;
  if (!chartData || !Array.isArray(chartData) || chartData.length === 0) {
    // 没有时间序列数据，使用累计时长简单展示
    const segments: Array<{ start: number; duration: number; type: string }> = [];
    let currentStart = 0;

    const stages = ['快速眼动', '深睡', '浅睡', '清醒'];
    stages.forEach((stage) => {
      const duration = getStageDuration(stage);
      if (duration > 0) {
        segments.push({
          start: currentStart,
          duration: duration,
          type: stage
        });
        currentStart += duration;
      }
    });

    return segments;
  }

  // 处理时间点序列数据
  const segments: Array<{ start: number; duration: number; type: string }> = [];

  // 睡眠状态映射
  const stateMap: Record<number, string> = {
    2: '浅睡',
    3: '深睡',
    4: '快速眼动'
  };

  // 获取睡眠结束时间
  const endTimeStr = props.sleepSegmentObj?.endTime || '';
  const endTime = parseTimeToMinutes(endTimeStr);

  // 遍历每个数据点
  for (let i = 0; i < chartData.length; i++) {
    const item = chartData[i];
    const timeStr = item.time || '';
    const value = item.value || '';

    // 解析当前时间点（睡眠类型的开始时间）
    const startTime = parseTimeToMinutes(timeStr);
    if (endTime > 0 && startTime >= endTime) {
      continue;
    }

    // 计算结束时间
    // 如果是最后一个数据点，使用 sleepSegmentObj.endTime
    // 否则使用下一个数据点的时间
    let endTimeMinutes = 0;
    if (i === chartData.length - 1) {
      endTimeMinutes = endTime;
    } else {
      const nextItem = chartData[i + 1];
      endTimeMinutes = parseTimeToMinutes(nextItem.time || '');
    }
    if (endTime > 0 && endTimeMinutes > endTime) {
      endTimeMinutes = endTime;
    }

    // 计算持续时间（分钟）
    const duration = endTimeMinutes - startTime;

    // 根据数值映射到睡眠状态
    const numValue = parseInt(String(value), 10);
    const type = stateMap[numValue] || '清醒';

    // 添加时间段
    if (duration > 0) {
      segments.push({
        start: startTime,
        duration: duration,
        type: type
      });
    }
  }

  return segments;
};

// 获取处理的图表配置
const getProcessedOption = () => {
  const newOption = cloneDeep(sleepTimeOption);

  // 定义系列数据项类型
  interface SeriesDataItem {
    value: [number, number]; // [center位置, y索引]
    startTime: number;
    duration: number;
    startOffset: number; // 用于定位（负值表示向左偏移）
  }

  // 初始化四个系列的数据数组
  const seriesData: SeriesDataItem[][] = [[], [], [], []];

  // 处理时间段数据
  const segments = processTimeSegments();

  segments.forEach((segment) => {
    const seriesIndex = stageSeriesMap[segment.type];
    if (seriesIndex !== undefined) {
      // 数据格式：{ value: [center, duration], startTime, duration, yIndex }
      // center: 柱子中心位置（用于 scatter）
      const center = segment.start + segment.duration / 2;
      seriesData[seriesIndex].push({
        value: [center, seriesIndex], // x=中心位置, y=系列索引
        startTime: segment.start,
        duration: segment.duration,
        startOffset: -segment.duration / 2  // 用于 symbolOffset
      });
    }
  });

  // 计算时间范围
  let minTime = 0;
  let maxTime = 0;

  // 优先使用 sleepSegmentObj 的开始和结束时间
  if (props.sleepSegmentObj?.startTime && props.sleepSegmentObj?.endTime) {
    minTime = parseTimeToMinutes(props.sleepSegmentObj.startTime);
    maxTime = parseTimeToMinutes(props.sleepSegmentObj.endTime);
  } else {
    // 回退到使用 chartData 的第一个和最后一个时间点
    const chartData = props.sleepDetailObj?.chartData;
    if (chartData && chartData.length > 0) {
      const firstTime = parseTimeToMinutes(chartData[0].time || '');
      const lastTime = parseTimeToMinutes(chartData[chartData.length - 1].time || '');
      minTime = firstTime;
      maxTime = lastTime;
    }
  }

  // 更新系列数据
  if (newOption.series) {
    newOption.series.forEach((seriesItem: any, index: number) => {
      seriesItem.data = seriesData[index] || [];
      // 移除 stack 属性
      delete seriesItem.stack;
      // 保持 scatter 类型
      seriesItem.type = 'scatter';
      // 设置 symbolSize 来模拟柱状图的横向长度
      seriesItem.symbolSize = function (data: any): [number, number] {
        // data 格式：{ value: [center, yIndex], duration, startOffset }
        let duration = 0;
        if (data && typeof data === 'object') {
          duration = data.duration || 0;
        }
        // 将分钟数转换为像素宽度
        const width = Math.max(10, duration * 2); // 调整缩放因子
        const height = 30; // 柱子高度
        return [width, height];
      };
      // 设置符号为矩形
      seriesItem.symbol = 'rect';
      // 设置颜色
      const itemStyleColor = {
        快速眼动: '#a78bfa',
        深睡: '#4f46e5',
        浅睡: '#818cf8',
        清醒: '#fb923c'
      } as unknown as any;
      seriesItem.itemStyle = {
        color: itemStyleColor[seriesItem.name as string] || '#818cf8',
        borderRadius: [6, 6, 6, 6]
      };
      // 正确配置 encode（scatter 使用 x/y 而非 xAxis/yAxis）
      seriesItem.encode = {
        x: 0,  // value[0] = center 位置
        y: 1   // value[1] = y 索引
      };
    });
  }

  if (newOption.xAxis) {
    // 设置 xAxis 的范围：从睡眠开始时间到睡眠结束时间
    (newOption.xAxis as any).min = minTime;
    (newOption.xAxis as any).max = maxTime;

    // 强制显示首尾标签，中间标签自动间隔
    (newOption.xAxis as any).axisLabel = {
      fontSize: 12,
      color: '#9ca3af',
      interval: 'auto',
      showMinLabel: true,
      showMaxLabel: true,
      formatter: function (value: number) {
        const hours = Math.floor(value / 60) % 24;
        const minutes = Math.floor(value % 60);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      }
    };
  }

  // 更新Y轴标签的颜色
  if (newOption.yAxis && newOption.yAxis.axisLabel) {
    (newOption.yAxis.axisLabel as any).color = ['#a78bfa', '#4f46e5', '#818cf8', '#fb923c'];
  }

  // 禁用 tooltip
  if (newOption.tooltip) {
    (newOption.tooltip as any).show = false;
  }

  return newOption;
};

// 初始化图表
const initChart = async () => {
  if (!chartRef.value) return;
  // 检查是否有有效数据
  if (!props.sleepDetailObj?.chartData || props.sleepDetailObj.chartData.length === 0) {
    return;
  }
  try {
    // 等待一小段时间确保 canvas 完全准备好
    await new Promise((resolve) => setTimeout(resolve, 50));
    const option = getProcessedOption();
    const chart = await chartRef.value.init(echarts);
    chartInstance.value = chart;
    chart.setOption(option);
  } catch (error) {
    console.error('[sleepTime] 图表初始化失败:', error);
  }
};

// 监听数据变化
watch(
  () => props.sleepDetailObj,
  async () => {
    // 检查是否有有效数据
    if (props.sleepDetailObj?.chartData && props.sleepDetailObj.chartData.length > 0) {
      await initChart();
    }
  },
  { deep: true }
);
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
        <l-echart ref="chartRef" @finished="initChart" :beforeDelay="100" style="width: 100%; height: 424rpx; margin: 0"></l-echart>
      </view>
    </view>
  </view>
</template>

<style></style>
